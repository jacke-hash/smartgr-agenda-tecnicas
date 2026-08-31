import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { formatarDataBR } from '../utils/date-options.js';

const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ALTURA_HORA_PX = 48;

// Mesmo padrão de aritmética de data em string ISO (sem Date com fuso do
// navegador) já usado em workers/calendar/src/index.js (diaDaSemana/
// diaAnteriorISO) — dia da semana é propriedade da data civil, não do
// instante, então dá pra calcular direto em UTC sem risco de virar de dia.
function diaDaSemanaISO(dataISO) {
  return new Date(`${dataISO}T00:00:00Z`).getUTCDay();
}

function somarDiasISO(dataISO, dias) {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function hojeBrasiliaISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function domingoDaSemanaISO(dataISO) {
  return somarDiasISO(dataISO, -diaDaSemanaISO(dataISO));
}

function minutosDoHorario(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatarEventoConflitante(evento) {
  if (!evento?.summary) return '';
  return `"${evento.summary}"`;
}

export function renderEscalaTecnicas(container, navigate, user) {
  container.innerHTML = `<div class="loading-state">Carregando...</div>`;

  let tecnicas = [];
  let inicioSemana = domingoDaSemanaISO(hojeBrasiliaISO());
  let modo = 'semana';
  let diaSelecionado = null;
  let escalas = [];
  let eventosReaisPorTecnica = {};
  let modalAberto = null;
  let avisoSincronizacao = null;

  async function carregarTecnicas() {
    const snap = await getDocs(query(collection(db, 'tecnicas'), where('ativo', '==', true)));
    tecnicas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function carregarEscalasSemana() {
    const fimSemana = somarDiasISO(inicioSemana, 6);
    const snap = await getDocs(query(collection(db, 'escalas'), where('data', '>=', inicioSemana), where('data', '<=', fimSemana)));
    escalas = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  }

  // Mostra na grade o que já está na agenda real da técnica (Beauty Fair,
  // Folga, treinamento lançado manualmente etc), além dos itens criados por
  // este painel — só leitura, nunca vira doc em `escalas` (decisão: sempre
  // refletir a agenda de verdade em vez de importar/duplicar).
  async function carregarEventosReaisSemana() {
    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;
    eventosReaisPorTecnica = {};
    if (!calendarWorkerUrl) return;

    const fimSemana = somarDiasISO(inicioSemana, 6);
    await Promise.all(
      tecnicas.map(async (t) => {
        if (!t.refreshTokenEncrypted) return;
        try {
          const resp = await fetch(`${calendarWorkerUrl}/escala/eventos-tecnica`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tecnicaId: t.id, dataInicio: inicioSemana, dataFim: fimSemana })
          });
          if (!resp.ok) return;
          eventosReaisPorTecnica[t.email] = (await resp.json()).eventos || [];
        } catch (err) {
          console.error(`Falha ao carregar eventos reais de ${t.email}:`, err);
        }
      })
    );
  }

  // Todo evento real cujo id já é o google_event_id de algum item de escala
  // desta semana já aparece como item "confirmado/sincronizado" — mostrar
  // de novo aqui seria duplicar o mesmo compromisso na tela.
  function idsJaMostradosComoEscala() {
    const set = new Set();
    escalas.forEach((e) => Object.values(e.google_event_ids || {}).forEach((id) => id && set.add(id)));
    return set;
  }

  // Google devolve end.date EXCLUSIVO em evento de dia inteiro (ex: 31/08 a
  // 05/09 cobre até o dia 04) — normaliza pra um range [diaInicio, diaFim]
  // inclusivo, igual o resto do código já trabalha com datas.
  function eventoRealParaItemVisual(evento) {
    const diaInicio = evento.start.date || evento.start.dateTime.slice(0, 10);
    const diaFim = evento.end.date ? somarDiasISO(evento.end.date, -1) : evento.end.dateTime.slice(0, 10);
    return {
      id: evento.id,
      diaInicio,
      diaFim,
      diaInteiro: Boolean(evento.start.date),
      horario_inicio: evento.start.dateTime ? evento.start.dateTime.slice(11, 16) : null,
      horario_fim: evento.end.dateTime ? evento.end.dateTime.slice(11, 16) : null,
      evento: evento.summary,
      local: evento.location
    };
  }

  function eventosReaisDaTecnicaNoDia(tecnicaEmail, diaISO) {
    const idsEscala = idsJaMostradosComoEscala();
    return (eventosReaisPorTecnica[tecnicaEmail] || [])
      .filter((ev) => !idsEscala.has(ev.id))
      .map(eventoRealParaItemVisual)
      .filter((item) => item.diaInicio <= diaISO && diaISO <= item.diaFim);
  }

  function escalasDoDia(diaISO) {
    return escalas.filter((e) => e.data === diaISO).sort((a, b) => a.horario_inicio.localeCompare(b.horario_inicio));
  }

  // Google não avisa a gente quando a técnica apaga um evento direto na
  // agenda dela — sem webhook configurado (over-engineering pro tamanho
  // desse time), a checagem roda toda vez que a semana é carregada. Se o
  // evento sumiu de verdade, tira a técnica do item (ou apaga o item
  // inteiro se ela era a única) — sem isso, o painel continuaria mostrando
  // como "sincronizado" um evento que não existe mais na agenda real.
  async function reconciliarEventosApagadosManualmente() {
    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;
    if (!calendarWorkerUrl) return;

    const itensParaChecar = [];
    escalas.forEach((e) => {
      Object.entries(e.google_event_ids || {}).forEach(([email, eventId]) => {
        const tecnicaId = tecnicas.find((t) => t.email === email)?.id;
        if (tecnicaId && eventId) itensParaChecar.push({ escalaId: e._id, email, tecnicaId, eventId });
      });
    });
    if (itensParaChecar.length === 0) return;

    let resultados;
    try {
      const resp = await fetch(`${calendarWorkerUrl}/escala/verificar-eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens: itensParaChecar.map(({ tecnicaId, eventId }) => ({ tecnicaId, eventId })) })
      });
      if (!resp.ok) return;
      resultados = (await resp.json()).resultados || [];
    } catch (err) {
      console.error('Falha ao reconciliar eventos apagados manualmente:', err);
      return;
    }

    const emailsRemovidosPorEscala = {};
    itensParaChecar.forEach((item, idx) => {
      if (resultados[idx] && !resultados[idx].existe) {
        (emailsRemovidosPorEscala[item.escalaId] = emailsRemovidosPorEscala[item.escalaId] || []).push(item.email);
      }
    });
    if (Object.keys(emailsRemovidosPorEscala).length === 0) return;

    for (const [escalaId, emailsRemovidos] of Object.entries(emailsRemovidosPorEscala)) {
      const escala = escalas.find((e) => e._id === escalaId);
      if (!escala) continue;
      const tecnicasRestantes = (escala.tecnicas || []).filter((email) => !emailsRemovidos.includes(email));
      const eventIdsRestantes = { ...(escala.google_event_ids || {}) };
      emailsRemovidos.forEach((email) => delete eventIdsRestantes[email]);

      try {
        if (tecnicasRestantes.length === 0) {
          await deleteDoc(doc(db, 'escalas', escalaId));
        } else {
          await updateDoc(doc(db, 'escalas', escalaId), { tecnicas: tecnicasRestantes, google_event_ids: eventIdsRestantes });
        }
      } catch (err) {
        console.error(`Falha ao atualizar escala ${escalaId} após reconciliação:`, err);
      }
    }

    await carregarEscalasSemana();
  }

  function escalasDaTecnicaNoDia(tecnicaEmail, diaISO) {
    return escalasDoDia(diaISO).filter((e) => (e.tecnicas || []).includes(tecnicaEmail));
  }

  function renderLegenda() {
    return `
      <div class="escala-legenda">
        <span><span class="escala-dot confirmado"></span> Confirmado</span>
        <span><span class="escala-dot sincronizado"></span> Sincronizado com Google Agenda</span>
        <span><span class="escala-dot real"></span> Já está na agenda dela (não editável aqui)</span>
      </div>
    `;
  }

  function renderChip(item, tecnicaEmail) {
    const sincronizado = Boolean(item.google_event_ids?.[tecnicaEmail]);
    return `
      <div class="escala-chip ${sincronizado ? 'sincronizado' : 'confirmado'}">
        <div class="h">${item.horario_inicio}–${item.horario_fim}</div>
        <div class="e">${item.evento}</div>
        ${item.local ? `<div class="l">${item.local}</div>` : ''}
      </div>
    `;
  }

  function renderChipReal(item) {
    return `
      <div class="escala-chip real" title="Já está na agenda do Google dela — edite direto lá.">
        <div class="h">${item.diaInteiro ? 'Dia inteiro' : `${item.horario_inicio}–${item.horario_fim}`}</div>
        <div class="e">${item.evento}</div>
        ${item.local ? `<div class="l">${item.local}</div>` : ''}
      </div>
    `;
  }

  function templateSemana() {
    const dias = Array.from({ length: 7 }, (_, i) => somarDiasISO(inicioSemana, i));
    return `
      <div class="page-head">
        <h1>Escala Geral</h1>
        <p>Grade semanal das técnicas — clique num dia pra ver o detalhe por horário.</p>
      </div>
      <div class="escala-nav">
        <button id="semana-anterior">← Semana anterior</button>
        <strong>${formatarDataBR(dias[0])} a ${formatarDataBR(dias[6])}</strong>
        <button id="semana-proxima">Próxima semana →</button>
      </div>
      <div class="escala-semana-wrap">
        <table class="escala-grid">
          <thead>
            <tr>
              <th>Técnica</th>
              ${dias.map((d) => `<th class="escala-dia-header" data-dia="${d}">${DIAS_LABEL[diaDaSemanaISO(d)]}<br>${formatarDataBR(d)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${tecnicas
              .map(
                (t) => `
              <tr>
                <td class="escala-tecnica-nome">${t.nome}</td>
                ${dias
                  .map(
                    (d) => `
                  <td class="escala-celula">
                    ${escalasDaTecnicaNoDia(t.email, d).map((it) => renderChip(it, t.email)).join('')}
                    ${eventosReaisDaTecnicaNoDia(t.email, d).map(renderChipReal).join('')}
                  </td>
                `
                  )
                  .join('')}
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${tecnicas.length === 0 ? `<div class="empty-state">Nenhuma técnica ativa cadastrada.</div>` : ''}
      ${renderLegenda()}
    `;
  }

  // Eixo padrão 08h–20h, mas estende automaticamente se algum item daquele
  // dia cair fora desse range — nunca esconde um evento por causa de um
  // eixo fixo curto demais.
  function limitesHorarioDoDia(diaISO) {
    let min = 8;
    let max = 20;
    const itensComHorario = [
      ...escalasDoDia(diaISO),
      ...tecnicas.flatMap((t) => eventosReaisDaTecnicaNoDia(t.email, diaISO)).filter((it) => !it.diaInteiro)
    ];
    itensComHorario.forEach((item) => {
      const inicioH = Math.floor(minutosDoHorario(item.horario_inicio) / 60);
      const fimH = Math.ceil(minutosDoHorario(item.horario_fim) / 60);
      if (inicioH < min) min = inicioH;
      if (fimH > max) max = fimH;
    });
    return { min, max };
  }

  function templateDia() {
    const { min: horaMin, max: horaMax } = limitesHorarioDoDia(diaSelecionado);
    const totalHoras = horaMax - horaMin;
    const horas = Array.from({ length: totalHoras + 1 }, (_, i) => horaMin + i);
    const alturaTotalPx = totalHoras * ALTURA_HORA_PX;

    return `
      <div class="page-head">
        <h1>Escala Geral</h1>
        <button class="back-link" id="voltar-semana">← Voltar pra semana</button>
      </div>
      <div class="section-title"><h3>${DIAS_LABEL[diaDaSemanaISO(diaSelecionado)]}, ${formatarDataBR(diaSelecionado)}</h3></div>
      <div class="escala-dia-wrap">
        <div class="escala-dia-grid" style="grid-template-columns: 60px repeat(${Math.max(tecnicas.length, 1)}, 1fr);">
          <div class="escala-dia-cabecalho escala-dia-eixo-cabecalho"></div>
          ${tecnicas
            .map(
              (t) => `
            <div class="escala-dia-cabecalho">
              <div class="nome">${t.nome}</div>
              <button class="escala-add-btn" data-add-tecnica="${t.email}">+ Adicionar</button>
            </div>
          `
            )
            .join('')}

          <div class="escala-dia-inteiro-eixo"></div>
          ${tecnicas
            .map((t) => {
              const diaInteiroReais = eventosReaisDaTecnicaNoDia(t.email, diaSelecionado).filter((ev) => ev.diaInteiro);
              return `<div class="escala-dia-inteiro-faixa">${diaInteiroReais.map((ev) => `<span class="escala-chip real">${ev.evento}</span>`).join('')}</div>`;
            })
            .join('')}

          <div class="escala-dia-eixo" style="height:${alturaTotalPx}px;">
            ${horas.map((h) => `<div class="escala-hora-label" style="top:${(h - horaMin) * ALTURA_HORA_PX}px;">${String(h).padStart(2, '0')}:00</div>`).join('')}
          </div>
          ${tecnicas
            .map((t) => {
              const itens = escalasDaTecnicaNoDia(t.email, diaSelecionado);
              const timedReais = eventosReaisDaTecnicaNoDia(t.email, diaSelecionado).filter((ev) => !ev.diaInteiro);
              return `
              <div class="escala-dia-coluna" style="height:${alturaTotalPx}px;">
                ${horas.map((h) => `<div class="escala-hora-linha" style="top:${(h - horaMin) * ALTURA_HORA_PX}px;"></div>`).join('')}
                ${itens
                  .map((item) => {
                    const topPx = ((minutosDoHorario(item.horario_inicio) - horaMin * 60) / 60) * ALTURA_HORA_PX;
                    const alturaPx = Math.max(24, ((minutosDoHorario(item.horario_fim) - minutosDoHorario(item.horario_inicio)) / 60) * ALTURA_HORA_PX);
                    const sincronizado = Boolean(item.google_event_ids?.[t.email]);
                    return `
                    <div class="escala-bloco ${sincronizado ? 'sincronizado' : 'confirmado'}" style="top:${topPx}px;height:${alturaPx}px;" data-editar="${item._id}">
                      <div class="h">${item.horario_inicio}–${item.horario_fim}</div>
                      <div class="e">${item.evento}</div>
                      ${item.local ? `<div class="l">${item.local}</div>` : ''}
                    </div>
                  `;
                  })
                  .join('')}
                ${timedReais
                  .map((item) => {
                    const topPx = ((minutosDoHorario(item.horario_inicio) - horaMin * 60) / 60) * ALTURA_HORA_PX;
                    const alturaPx = Math.max(24, ((minutosDoHorario(item.horario_fim) - minutosDoHorario(item.horario_inicio)) / 60) * ALTURA_HORA_PX);
                    return `
                    <div class="escala-bloco real" style="top:${topPx}px;height:${alturaPx}px;" title="Já está na agenda do Google dela — edite direto lá.">
                      <div class="h">${item.horario_inicio}–${item.horario_fim}</div>
                      <div class="e">${item.evento}</div>
                      ${item.local ? `<div class="l">${item.local}</div>` : ''}
                    </div>
                  `;
                  })
                  .join('')}
              </div>
            `;
            })
            .join('')}
        </div>
      </div>
      ${renderLegenda()}
      ${modalAberto ? renderModal() : ''}
    `;
  }

  function renderModal() {
    const editando = Boolean(modalAberto.escala);
    const item = modalAberto.escala || {};
    const tecnicasSelecionadas = item.tecnicas || (modalAberto.tecnicaEmailPreSelecionada ? [modalAberto.tecnicaEmailPreSelecionada] : []);
    return `
      <div class="modal-overlay" id="escala-modal-overlay">
        <div class="modal-card">
          <h3>${editando ? 'Editar item de escala' : 'Novo item de escala'}</h3>
          <div id="escala-modal-error"></div>
          <div class="field-row">
            <div class="field">
              <label>Data</label>
              <input type="date" id="modal-data" value="${item.data || modalAberto.diaPreSelecionado || ''}" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Horário início</label>
              <input type="time" id="modal-horario-inicio" value="${item.horario_inicio || ''}" />
            </div>
            <div class="field">
              <label>Horário fim</label>
              <input type="time" id="modal-horario-fim" value="${item.horario_fim || ''}" />
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Evento/Treinamento</label>
              <input type="text" id="modal-evento" value="${item.evento || ''}" placeholder="Ex: Beauty Fair" />
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Local</label>
              <input type="text" id="modal-local" value="${item.local || ''}" placeholder="Ex: Centro de Convenções" />
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Técnica(s)</label>
              <div class="escala-tecnicas-checklist">
                ${tecnicas
                  .map(
                    (t) => `
                  <label class="escala-tecnica-check">
                    <input type="checkbox" value="${t.email}" ${tecnicasSelecionadas.includes(t.email) ? 'checked' : ''} />
                    ${t.nome}
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
          <div class="action-row">
            <button class="btn btn-approve" id="modal-salvar">Salvar</button>
            ${editando ? `<button class="btn btn-decline" id="modal-excluir">Excluir</button>` : ''}
            <button class="btn btn-secondary" id="modal-cancelar">Cancelar</button>
          </div>
        </div>
      </div>
    `;
  }

  async function salvarItem() {
    const errorEl = container.querySelector('#escala-modal-error');
    errorEl.innerHTML = '';

    const data = container.querySelector('#modal-data').value;
    const horarioInicio = container.querySelector('#modal-horario-inicio').value;
    const horarioFim = container.querySelector('#modal-horario-fim').value;
    const evento = container.querySelector('#modal-evento').value.trim();
    const local = container.querySelector('#modal-local').value.trim();
    const tecnicasSelecionadas = Array.from(container.querySelectorAll('.escala-tecnica-check input:checked')).map((el) => el.value);

    if (!data || !horarioInicio || !horarioFim || !evento || tecnicasSelecionadas.length === 0) {
      errorEl.innerHTML = `<div class="error-note">Preencha data, horário, evento e selecione pelo menos uma técnica.</div>`;
      return;
    }
    if (horarioFim <= horarioInicio) {
      errorEl.innerHTML = `<div class="error-note">O horário de término precisa ser depois do início.</div>`;
      return;
    }

    const escalaAtual = modalAberto.escala || null;
    const idsSelecionados = tecnicasSelecionadas.map((email) => tecnicas.find((t) => t.email === email)?.id).filter(Boolean);
    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;

    let conflitos = {};
    if (calendarWorkerUrl && idsSelecionados.length > 0) {
      try {
        const resp = await fetch(`${calendarWorkerUrl}/verificar-conflitos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tecnicaIds: idsSelecionados,
            tipoReserva: 'unico',
            opcoesData: [{ data, horaInicio: horarioInicio, horaTermino: horarioFim }]
          })
        });
        const resultado = await resp.json();
        conflitos = resp.ok ? resultado.conflitos || {} : {};
      } catch (err) {
        console.error('Falha ao verificar conflitos da escala:', err);
      }
    }

    // Autoconflito: se a técnica já tem o próprio evento desse item exatamente
    // nessa janela (editando sem mudar data/horário), o evento encontrado é
    // ELA MESMA — não conta como conflito real.
    const conflitosReais = [];
    for (const t of tecnicas) {
      if (!tecnicasSelecionadas.includes(t.email)) continue;
      const status = conflitos[t.id]?.[0];
      if (!status) continue;
      const eventoProprioId = escalaAtual?.google_event_ids?.[t.email];
      const ehAutoconflito = Boolean(status.eventoConflitante?.id) && status.eventoConflitante.id === eventoProprioId;
      if ((status.conflito || status.folga) && !ehAutoconflito) {
        conflitosReais.push({ tecnica: t.nome, status });
      }
    }

    if (conflitosReais.length > 0) {
      errorEl.innerHTML = conflitosReais
        .map((c) => {
          const detalhe = c.status.eventoConflitante ? ` — bate com ${formatarEventoConflitante(c.status.eventoConflitante)}` : '';
          return `<div class="error-note">${c.status.folga ? '😴' : '⚠️'} ${c.tecnica}: ${c.status.folga ? 'de folga (trabalhou no domingo anterior)' : 'conflito de agenda'}${detalhe}.</div>`;
        })
        .join('');
      return;
    }

    const btnSalvar = container.querySelector('#modal-salvar');
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando...';

    try {
      const tecnicasAntigas = escalaAtual?.tecnicas || [];
      const googleEventIdsAntigos = escalaAtual?.google_event_ids || {};
      const googleEventIdsNovos = {};
      const falhasSincronizacao = [];

      const removidas = tecnicasAntigas.filter((email) => !tecnicasSelecionadas.includes(email));
      const mantidas = tecnicasAntigas.filter((email) => tecnicasSelecionadas.includes(email));
      const adicionadas = tecnicasSelecionadas.filter((email) => !tecnicasAntigas.includes(email));

      await Promise.all(
        removidas.map(async (email) => {
          const eventId = googleEventIdsAntigos[email];
          const tecnicaId = tecnicas.find((t) => t.email === email)?.id;
          if (!eventId || !tecnicaId || !calendarWorkerUrl) return;
          try {
            await fetch(`${calendarWorkerUrl}/escala/excluir-evento`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tecnicaId, eventId })
            });
          } catch (err) {
            console.error(`Falha ao excluir evento da escala pra ${email}:`, err);
          }
        })
      );

      await Promise.all(
        [...mantidas, ...adicionadas].map(async (email) => {
          const tecnicaId = tecnicas.find((t) => t.email === email)?.id;
          const nomeTecnica = tecnicas.find((t) => t.email === email)?.nome || email;
          if (!tecnicaId || !calendarWorkerUrl) {
            falhasSincronizacao.push(nomeTecnica);
            return;
          }
          const eventIdExistente = googleEventIdsAntigos[email];
          try {
            const resp = await fetch(`${calendarWorkerUrl}/escala/${eventIdExistente ? 'atualizar-evento' : 'criar-evento'}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tecnicaId, eventId: eventIdExistente, evento, local, data, horarioInicio, horarioFim })
            });
            const resultado = await resp.json();
            if (resp.ok) {
              googleEventIdsNovos[email] = resultado.eventId;
            } else {
              falhasSincronizacao.push(nomeTecnica);
            }
          } catch (err) {
            console.error(`Falha ao sincronizar evento da escala pra ${email}:`, err);
            falhasSincronizacao.push(nomeTecnica);
          }
        })
      );

      const payload = {
        data,
        horario_inicio: horarioInicio,
        horario_fim: horarioFim,
        evento,
        tecnicas: tecnicasSelecionadas,
        local,
        google_event_ids: googleEventIdsNovos,
        atualizado_em: serverTimestamp()
      };

      if (escalaAtual) {
        await updateDoc(doc(db, 'escalas', escalaAtual._id), payload);
      } else {
        await addDoc(collection(db, 'escalas'), { ...payload, criado_por: user.email, criado_em: serverTimestamp() });
      }

      avisoSincronizacao =
        falhasSincronizacao.length > 0
          ? `Item salvo, mas não sincronizou com a agenda de: ${falhasSincronizacao.join(', ')}. Verifique se ela(s) já conectaram a agenda.`
          : null;
      modalAberto = null;
      await carregarEscalasSemana();
      render();
    } catch (err) {
      errorEl.innerHTML = `<div class="error-note">Erro ao salvar: ${err.message}</div>`;
      btnSalvar.disabled = false;
      btnSalvar.textContent = 'Salvar';
    }
  }

  async function excluirItem() {
    const escalaAtual = modalAberto?.escala;
    if (!escalaAtual) return;
    if (!window.confirm('Excluir este item de escala? Isso remove o evento da agenda das técnicas envolvidas.')) return;

    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;
    const googleEventIds = escalaAtual.google_event_ids || {};

    await Promise.all(
      Object.entries(googleEventIds).map(async ([email, eventId]) => {
        const tecnicaId = tecnicas.find((t) => t.email === email)?.id;
        if (!tecnicaId || !calendarWorkerUrl) return;
        try {
          await fetch(`${calendarWorkerUrl}/escala/excluir-evento`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tecnicaId, eventId })
          });
        } catch (err) {
          console.error(`Falha ao excluir evento da escala pra ${email}:`, err);
        }
      })
    );

    await deleteDoc(doc(db, 'escalas', escalaAtual._id));
    modalAberto = null;
    avisoSincronizacao = null;
    await carregarEscalasSemana();
    render();
  }

  async function carregarSemanaEReconciliar() {
    await carregarEscalasSemana();
    await Promise.all([reconciliarEventosApagadosManualmente(), carregarEventosReaisSemana()]);
    render();
  }

  function attachHandlers() {
    container.querySelector('#semana-anterior')?.addEventListener('click', () => {
      inicioSemana = somarDiasISO(inicioSemana, -7);
      carregarSemanaEReconciliar();
    });
    container.querySelector('#semana-proxima')?.addEventListener('click', () => {
      inicioSemana = somarDiasISO(inicioSemana, 7);
      carregarSemanaEReconciliar();
    });
    container.querySelectorAll('.escala-dia-header[data-dia]').forEach((th) => {
      th.addEventListener('click', () => {
        modo = 'dia';
        diaSelecionado = th.dataset.dia;
        render();
      });
    });
    container.querySelector('#voltar-semana')?.addEventListener('click', () => {
      modo = 'semana';
      render();
    });
    container.querySelectorAll('[data-add-tecnica]').forEach((btn) => {
      btn.addEventListener('click', () => {
        modalAberto = { tecnicaEmailPreSelecionada: btn.dataset.addTecnica, diaPreSelecionado: diaSelecionado };
        render();
      });
    });
    container.querySelectorAll('[data-editar]').forEach((bloco) => {
      bloco.addEventListener('click', () => {
        const item = escalas.find((e) => e._id === bloco.dataset.editar);
        if (item) {
          modalAberto = { escala: item };
          render();
        }
      });
    });
    container.querySelector('#modal-cancelar')?.addEventListener('click', () => {
      modalAberto = null;
      render();
    });
    container.querySelector('#modal-salvar')?.addEventListener('click', salvarItem);
    container.querySelector('#modal-excluir')?.addEventListener('click', excluirItem);
  }

  function render() {
    const aviso = avisoSincronizacao ? `<div class="error-note" style="margin-bottom:14px;">${avisoSincronizacao}</div>` : '';
    container.innerHTML = aviso + (modo === 'dia' ? templateDia() : templateSemana());
    attachHandlers();
  }

  async function iniciar() {
    await carregarTecnicas();
    await carregarSemanaEReconciliar();
  }

  iniciar();
}
