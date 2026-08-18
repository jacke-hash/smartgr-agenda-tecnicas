import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { notificarAprovacao } from '../utils/notificar.js';

const COLECOES = ['solicitacoes_consumidor_final', 'solicitacoes_revenda', 'solicitacoes_workshop'];

const TAG_TIPO = {
  consumidor_final: { label: 'Consumidor Final', cls: 'consumidor_final' },
  revenda: { label: 'Revenda', cls: 'revenda' },
  workshop: { label: 'Workshop', cls: 'workshop' }
};

function formatDataHora(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(slaExpiraEm) {
  if (!slaExpiraEm) return { texto: 'sem SLA', classe: '' };
  const alvo = slaExpiraEm.toDate ? slaExpiraEm.toDate() : new Date(slaExpiraEm);
  const diffMs = alvo.getTime() - Date.now();

  if (diffMs <= 0) {
    return { texto: 'SLA expirado', classe: 'expirado' };
  }

  const horas = Math.floor(diffMs / (1000 * 60 * 60));
  const minutos = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const texto = horas > 0 ? `${horas}h ${minutos}min restantes` : `${minutos}min restantes`;
  const classe = horas < 4 ? 'urgent' : '';
  return { texto, classe };
}

function renderTagsSolicitacao(item) {
  const tags = [];
  const tipoInfo = TAG_TIPO[item.tipo];
  if (tipoInfo) tags.push(`<span class="tag ${tipoInfo.cls}">${tipoInfo.label}</span>`);
  if (item.modalidade) tags.push(`<span class="tag ${item.modalidade}">${item.modalidade === 'online' ? 'Online' : 'Presencial'}</span>`);
  if (item.tipoTreinamento) tags.push(`<span class="tag ${item.tipoTreinamento}">${item.tipoTreinamento === 'interno' ? 'Interno' : 'Externo'}</span>`);
  return `<div class="tags">${tags.join('')}</div>`;
}

function renderInfoConsumidorFinal(item) {
  return `
    <div class="info-grid">
      <div class="info-item"><span>Vendedor</span><strong>${item.vendedor || '—'}</strong></div>
      <div class="info-item"><span>Perfil profissional</span><strong>${item.perfilProfissional || '—'}</strong></div>
      <div class="info-item"><span>Contato</span><strong>${item.contato || '—'}</strong></div>
      <div class="info-item"><span>Equipamento</span><strong>${item.equipamentoComprado || '—'}</strong></div>
      <div class="info-item"><span>Nº de série</span><strong>${item.numeroSerie || '—'}</strong></div>
      <div class="info-item"><span>Insumos</span><strong>${item.insumosAdquiridos || '—'}</strong></div>
      ${item.unidade ? `<div class="info-item"><span>Unidade</span><strong>${item.unidade}</strong></div>` : ''}
      ${item.endereco ? `<div class="info-item wide"><span>Endereço</span><strong>${item.endereco.rua}, ${item.endereco.numero} — ${item.endereco.bairro}, ${item.endereco.cidade}/${item.endereco.uf}</strong></div>` : ''}
      ${item.observacao ? `<div class="info-item wide"><span>Observação</span><strong>${item.observacao}</strong></div>` : ''}
    </div>
    <div class="subhead">Participantes</div>
    <div class="participants-list">
      ${(item.participantes || []).map((p) => `<span class="participant-chip"><b>${p.nome}</b> — <small>${p.profissao}</small></span>`).join('')}
    </div>
  `;
}

function renderInfoRevenda(item) {
  return `
    <div class="info-grid">
      <div class="info-item"><span>Revenda</span><strong>${item.nomeRevenda || '—'}</strong></div>
      <div class="info-item"><span>Vendedor</span><strong>${item.vendedor || '—'}</strong></div>
      <div class="info-item"><span>Destino</span><strong>${item.destinoTreinamento === 'propria_revenda' ? 'Equipe própria' : 'Cliente da revenda'}</strong></div>
      <div class="info-item"><span>Tema</span><strong>${item.tema || '—'}</strong></div>
      <div class="info-item"><span>Marcas</span><strong>${item.marcasQueTrabalha || '—'}</strong></div>
      <div class="info-item"><span>Linha completa SmartGR</span><strong>${item.trabalhaLinhaCompletaSmartGR ? 'Sim' : 'Não'}</strong></div>
      <div class="info-item"><span>Sala de cursos</span><strong>${item.temSalaCursos ? `Sim (${item.capacidadeSala || '?'} pessoas)` : 'Não'}</strong></div>
      <div class="info-item"><span>Espaço de prática</span><strong>${item.possuiEspacoPratica ? `Sim (${item.tipoPratica || '—'})` : 'Não'}</strong></div>
      <div class="info-item"><span>Transporte</span><strong>${item.precisaTransporte ? `${item.transporte?.meio} — paga: ${item.transporte?.quemPaga}` : 'Não precisa'}</strong></div>
      ${item.endereco ? `<div class="info-item wide"><span>Endereço</span><strong>${item.endereco.rua}, ${item.endereco.numero} — ${item.endereco.bairro}, ${item.endereco.cidade}/${item.endereco.uf}</strong></div>` : ''}
    </div>
  `;
}

function renderInfoWorkshop(item) {
  return `
    <div class="info-grid">
      <div class="info-item"><span>Instituição</span><strong>${item.localInstituicao || '—'}</strong></div>
      <div class="info-item"><span>Vendedor</span><strong>${item.vendedorAcompanha || '—'}</strong></div>
      <div class="info-item"><span>Tema</span><strong>${item.tema || '—'}</strong></div>
      <div class="info-item"><span>Público</span><strong>${item.publico || '—'}</strong></div>
      <div class="info-item"><span>Participantes estimados</span><strong>${item.participantesEstimados ?? '—'}</strong></div>
      <div class="info-item"><span>Demonstração prática</span><strong>${item.teraDemonstracaoPratica ? 'Sim' : 'Não'}</strong></div>
      ${item.qualEquipamento ? `<div class="info-item"><span>Equipamento</span><strong>${item.qualEquipamento}</strong></div>` : ''}
      <div class="info-item"><span>Responsável local</span><strong>${item.responsavelLocal?.nome || '—'} (${item.responsavelLocal?.contato || '—'})</strong></div>
      <div class="info-item wide"><span>Endereço</span><strong>${item.endereco?.rua}, ${item.endereco?.numero} — ${item.endereco?.bairro}, ${item.endereco?.cidade}/${item.endereco?.uf}</strong></div>
      <div class="info-item wide"><span>Data e horário</span><strong>${item.data} · ${item.horaInicio} às ${item.horaTermino}</strong></div>
    </div>
  `;
}

export function renderPainelJulia(container) {
  container.innerHTML = `
    <div class="page-head">
      <h1>Painel — Julia</h1>
      <p>Fila única de solicitações pendentes das 3 origens, ordenadas por data de criação.</p>
    </div>
    <div class="queue" id="queue"><div class="loading-state">Carregando solicitações...</div></div>
  `;

  const queueEl = container.querySelector('#queue');

  let tecnicas = [];
  let porColecao = {};
  const estadoUi = {};
  let unsubscribes = [];
  let intervaloCountdown = null;

  async function carregarTecnicas() {
    const snap = await getDocs(query(collection(db, 'tecnicas'), where('ativo', '==', true)));
    tecnicas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  function todasSolicitacoesPendentes() {
    return COLECOES.flatMap((colecaoNome) => porColecao[colecaoNome] || [])
      .filter((item) => item.status === 'pendente')
      .sort((a, b) => {
        const da = a.criadoEm?.toMillis ? a.criadoEm.toMillis() : 0;
        const dbb = b.criadoEm?.toMillis ? b.criadoEm.toMillis() : 0;
        return da - dbb;
      });
  }

  function garantirEstado(item) {
    if (!estadoUi[item._id]) {
      estadoUi[item._id] = { dataEscolhidaIdx: null, tecnicaId: '' };
    }
    return estadoUi[item._id];
  }

  function renderConteudoPorTipo(item) {
    if (item.tipo === 'consumidor_final') return renderInfoConsumidorFinal(item);
    if (item.tipo === 'revenda') return renderInfoRevenda(item);
    if (item.tipo === 'workshop') return renderInfoWorkshop(item);
    return '';
  }

  function renderEscolhaData(item) {
    if (item.tipo === 'workshop') {
      return `<div class="subhead">Data solicitada</div><p><strong>${item.data} · ${item.horaInicio} às ${item.horaTermino}</strong></p>`;
    }
    const estado = garantirEstado(item);
    return `
      <div class="subhead">Escolha a data</div>
      <div class="date-pick-grid" data-escolha-data="${item._id}">
        ${(item.opcoesData || [])
          .map(
            (opt, idx) => `
          <div class="date-pick ${estado.dataEscolhidaIdx === idx ? 'chosen' : ''}" data-idx="${idx}">
            <div class="d">${opt.data}</div>
            <div class="t">${opt.horaInicio} - ${opt.horaTermino}</div>
            <div class="check">✓ escolhida</div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderCard(item) {
    const countdown = formatCountdown(item.slaExpiraEm);
    const tipoLabel = TAG_TIPO[item.tipo]?.label || item.tipo;
    const nomeSolicitante = item.vendedor || item.vendedorAcompanha || '—';

    return `
      <div class="request-card" data-item-id="${item._id}">
        <div class="request-head">
          <div class="who">
            <strong>${tipoLabel} — ${item.tema || item.perfilProfissional || item.localInstituicao || ''}</strong>
            <span>Solicitado por ${nomeSolicitante} em ${formatDataHora(item.criadoEm)}</span>
            ${renderTagsSolicitacao(item)}
          </div>
          <div class="countdown ${countdown.classe}">⏱ ${countdown.texto}</div>
        </div>
        <div class="request-body">
          ${renderConteudoPorTipo(item)}
          ${renderEscolhaData(item)}
          <div class="subhead">Atribuir técnica</div>
          <div class="assign-row">
            <div class="field">
              <label>Técnica responsável</label>
              <select data-select-tecnica="${item._id}">
                <option value="">Selecione...</option>
                ${tecnicas.map((t) => `<option value="${t.id}" ${garantirEstado(item).tecnicaId === t.id ? 'selected' : ''}>${t.nome}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="action-row">
            <button class="btn btn-approve" data-aprovar="${item._id}">Aprovar e atribuir</button>
            <button class="btn btn-decline" data-recusar="${item._id}">Recusar</button>
          </div>
          <div id="msg-${item._id}"></div>
        </div>
      </div>
    `;
  }

  async function aprovar(item) {
    const estado = garantirEstado(item);
    const msgEl = container.querySelector(`#msg-${item._id}`);
    msgEl.innerHTML = '';

    if (!estado.tecnicaId) {
      msgEl.innerHTML = `<div class="error-note">Selecione uma técnica antes de aprovar.</div>`;
      return;
    }
    if (item.tipo !== 'workshop' && estado.dataEscolhidaIdx === null) {
      msgEl.innerHTML = `<div class="error-note">Escolha uma das datas propostas antes de aprovar.</div>`;
      return;
    }

    const dataHora =
      item.tipo === 'workshop'
        ? { data: item.data, horaInicio: item.horaInicio, horaTermino: item.horaTermino }
        : item.opcoesData[estado.dataEscolhidaIdx];

    const payload = {
      status: 'aprovado',
      tecnicaAtribuida: estado.tecnicaId,
      aprovadoEm: serverTimestamp()
    };

    if (item.tipo !== 'workshop') {
      payload.dataEscolhida = dataHora;
    }

    await updateDoc(doc(db, item._colecao, item._id), payload);

    const tecnica = tecnicas.find((t) => t.id === estado.tecnicaId);
    const nomeSolicitante = item.vendedor || item.vendedorAcompanha || '—';
    const modalidade = item.tipo === 'workshop' ? 'presencial' : item.modalidade;
    const endereco = item.endereco || null;

    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;
    if (calendarWorkerUrl) {
      try {
        const resp = await fetch(`${calendarWorkerUrl}/criar-evento`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tecnicaId: estado.tecnicaId,
            tipo: item.tipo,
            tipoTreinamento: item.tipoTreinamento || null,
            modalidade,
            endereco,
            nomeSolicitante,
            dataHora
          })
        });
        const resultado = await resp.json();
        if (resp.ok) {
          await updateDoc(doc(db, item._colecao, item._id), {
            googleEventId: resultado.eventId,
            googleEventLink: resultado.htmlLink
          });
        } else {
          msgEl.innerHTML = `<div class="error-note">Aprovado, mas falha ao criar evento no Google Calendar: ${resultado.message || 'erro desconhecido'}</div>`;
        }
      } catch (err) {
        msgEl.innerHTML = `<div class="error-note">Aprovado, mas falha ao criar evento no Google Calendar: ${err.message}</div>`;
      }
    }

    if (item.vendedorEmail) {
      notificarAprovacao({
        vendedorEmail: item.vendedorEmail,
        vendedorNome: nomeSolicitante,
        tipo: item.tipo,
        tipoTreinamento: item.tipoTreinamento || null,
        modalidade,
        tecnicaNome: tecnica?.nome || '—',
        dataHora,
        endereco
      });
    }
  }

  async function recusar(item) {
    await updateDoc(doc(db, item._colecao, item._id), {
      status: 'recusado',
      aprovadoEm: serverTimestamp()
    });
  }

  function renderFila() {
    const pendentes = todasSolicitacoesPendentes();

    if (pendentes.length === 0) {
      queueEl.innerHTML = `<div class="empty-state">Nenhuma solicitação pendente. 🎉</div>`;
      return;
    }

    queueEl.innerHTML = pendentes.map((item) => renderCard(item)).join('');

    queueEl.querySelectorAll('[data-escolha-data]').forEach((grid) => {
      const itemId = grid.dataset.escolhaData;
      const item = pendentes.find((p) => p._id === itemId);
      grid.querySelectorAll('.date-pick').forEach((pick) => {
        pick.addEventListener('click', () => {
          garantirEstado(item).dataEscolhidaIdx = Number(pick.dataset.idx);
          renderFila();
        });
      });
    });

    queueEl.querySelectorAll('[data-select-tecnica]').forEach((select) => {
      const itemId = select.dataset.selectTecnica;
      const item = pendentes.find((p) => p._id === itemId);
      select.addEventListener('change', () => {
        garantirEstado(item).tecnicaId = select.value;
      });
    });

    queueEl.querySelectorAll('[data-aprovar]').forEach((btn) => {
      const item = pendentes.find((p) => p._id === btn.dataset.aprovar);
      btn.addEventListener('click', () => aprovar(item));
    });

    queueEl.querySelectorAll('[data-recusar]').forEach((btn) => {
      const item = pendentes.find((p) => p._id === btn.dataset.recusar);
      btn.addEventListener('click', () => recusar(item));
    });
  }

  async function iniciar() {
    await carregarTecnicas();

    COLECOES.forEach((colecaoNome) => {
      const q = query(collection(db, colecaoNome), where('status', '==', 'pendente'));
      const unsub = onSnapshot(q, (snap) => {
        porColecao[colecaoNome] = snap.docs.map((d) => ({ _id: d.id, _colecao: colecaoNome, ...d.data() }));
        renderFila();
      });
      unsubscribes.push(unsub);
    });

    intervaloCountdown = setInterval(renderFila, 30000);
  }

  iniciar();

  return () => {
    unsubscribes.forEach((u) => u());
    if (intervaloCountdown) clearInterval(intervaloCountdown);
  };
}
