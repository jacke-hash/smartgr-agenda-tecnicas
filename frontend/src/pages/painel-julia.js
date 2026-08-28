import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { notificarAprovacao, notificarRecusa } from '../utils/notificar.js';
import { formatarDataBR } from '../utils/date-options.js';

const COLECOES = ['solicitacoes_consumidor_final', 'solicitacoes_revenda', 'solicitacoes_workshop'];

const TAG_TIPO = {
  consumidor_final: { label: 'Consumidor Final', cls: 'consumidor_final' },
  revenda: { label: 'Revendas/Redes', cls: 'revenda' },
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
      <div class="info-item"><span>Revenda/Rede</span><strong>${item.nomeRevenda || '—'}</strong></div>
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
    </div>
  `;
}

const ABAS = [
  { id: 'pendente', label: 'Pendentes' },
  { id: 'aprovado', label: 'Aprovadas' },
  { id: 'recusado', label: 'Recusadas' }
];

export function renderPainelJulia(container) {
  container.innerHTML = `
    <div class="page-head">
      <h1>Painel — Julia</h1>
      <p>Fila única de solicitações das 3 origens, ordenadas por data.</p>
    </div>
    <div class="view-switch" id="painel-tabs">
      ${ABAS.map((a) => `<button data-aba="${a.id}" class="${a.id === 'pendente' ? 'active' : ''}">${a.label}</button>`).join('')}
    </div>
    <div class="queue" id="queue" style="margin-top:16px;"><div class="loading-state">Carregando solicitações...</div></div>
  `;

  const queueEl = container.querySelector('#queue');
  const tabsEl = container.querySelector('#painel-tabs');

  let tecnicas = [];
  let porColecao = {};
  const historico = { aprovado: [], recusado: [] };
  const estadoUi = {};
  let unsubscribes = [];
  let intervaloCountdown = null;
  let abaAtiva = 'pendente';

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

  // Dois motivos distintos de indisponibilidade numa opção de data — não
  // misturar na mesma mensagem: "conflito" é a técnica já ter algo marcado
  // naquele horário; "folga" é a regra de descanso (trabalhou domingo,
  // segunda inteira indisponível). estado.conflitos[tecnicaId][idx] vem do
  // worker como { conflito, folga }.
  function tecnicasComConflitoEm(estado, idx) {
    return tecnicas.filter((t) => estado.conflitos?.[t.id]?.[idx]?.conflito).map((t) => t.nome);
  }

  function tecnicasComFolgaEm(estado, idx) {
    return tecnicas.filter((t) => estado.conflitos?.[t.id]?.[idx]?.folga).map((t) => t.nome);
  }

  function tecnicaIndisponivelEm(estado, tecnicaId, idx) {
    const status = estado.conflitos?.[tecnicaId]?.[idx];
    return Boolean(status?.conflito || status?.folga);
  }

  function renderEscolhaData(item) {
    const estado = garantirEstado(item);
    const ehPeriodo = item.tipoReserva === 'periodo';

    return `
      <div class="subhead">${ehPeriodo ? 'Escolha o período' : 'Escolha a data'}</div>
      <div class="date-pick-grid ${ehPeriodo ? 'periodo' : ''}" data-escolha-data="${item._id}">
        ${(item.opcoesData || [])
          .map((opt, idx) => {
            // Só um mínimo das opções vem preenchido agora (2 de 4 no único,
            // 1 de 2 no período) — opção em branco não vira card vazio.
            const preenchida = ehPeriodo
              ? Boolean(opt?.dataInicio && opt?.dataFim && opt?.horaInicio && opt?.horaTermino)
              : Boolean(opt?.data && opt?.horaInicio && opt?.horaTermino);
            if (!preenchida) return '';
            const conflitantes = tecnicasComConflitoEm(estado, idx);
            const emFolga = tecnicasComFolgaEm(estado, idx);
            const linhaData = ehPeriodo
              ? `${formatarDataBR(opt.dataInicio)} a ${formatarDataBR(opt.dataFim)}`
              : formatarDataBR(opt.data);
            return `
          <div class="date-pick ${estado.dataEscolhidaIdx === idx ? 'chosen' : ''}" data-idx="${idx}">
            <div class="d">${linhaData}</div>
            <div class="t">${opt.horaInicio} - ${opt.horaTermino}</div>
            <div class="check">✓ escolhida</div>
            ${conflitantes.length ? `<div class="conflict-warn">⚠️ ${conflitantes.join(', ')}</div>` : ''}
            ${emFolga.length ? `<div class="folga-warn">😴 Indisponível (folga): ${emFolga.join(', ')}</div>` : ''}
          </div>
        `;
          })
          .join('')}
      </div>
    `;
  }

  async function checarConflitos(item) {
    const estado = garantirEstado(item);
    // Guarda contra reexecução depois de já ter um resultado E contra chamadas
    // concorrentes em andamento (onSnapshot dispara mais de uma vez pro mesmo
    // write — uma local otimista, outra quando o servidor confirma — e sem
    // esse segundo guard, duas chamadas paralelas para o mesmo item podem
    // resolver fora de ordem: se a que falha resolve depois da que funcionou,
    // ela sobrescreve o resultado bom com {} e o aviso "some sozinho").
    if (estado.conflitos || estado.conflitosEmAndamento) return;
    estado.conflitosEmAndamento = true;

    const tecnicasConectadas = tecnicas.filter((t) => t.refreshTokenEncrypted);
    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;
    if (tecnicasConectadas.length === 0 || !calendarWorkerUrl) {
      estado.conflitos = {};
      estado.conflitosEmAndamento = false;
      return;
    }

    try {
      const resp = await fetch(`${calendarWorkerUrl}/verificar-conflitos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tecnicaIds: tecnicasConectadas.map((t) => t.id),
          tipoReserva: item.tipoReserva || 'unico',
          opcoesData: item.opcoesData
        })
      });
      const resultado = await resp.json();
      estado.conflitos = resp.ok ? resultado.conflitos || {} : {};
    } catch (err) {
      console.error('Falha ao verificar conflitos de agenda:', err);
      estado.conflitos = {};
    } finally {
      estado.conflitosEmAndamento = false;
    }

    renderFila();
  }

  function renderCard(item) {
    checarConflitos(item); // fire-and-forget, guardado internamente contra recheck

    const estado = garantirEstado(item);
    const countdown = formatCountdown(item.slaExpiraEm);
    const tipoLabel = TAG_TIPO[item.tipo]?.label || item.tipo;
    const nomeSolicitante = item.vendedor || item.vendedorAcompanha || '—';

    const idxRelevante = estado.dataEscolhidaIdx;
    // Enquanto a checagem de disponibilidade ainda não voltou do worker,
    // estado.conflitos fica undefined — nesse intervalo NÃO dá pra saber se a
    // técnica está livre. Sem essa distinção, a ausência de aviso parecia
    // "sem conflito confirmado" quando na verdade era "ainda não sei", e
    // Julia podia aprovar antes da checagem terminar.
    const aindaVerificando = estado.conflitos === undefined;
    const statusEscolhida =
      estado.tecnicaId && idxRelevante !== null ? estado.conflitos?.[estado.tecnicaId]?.[idxRelevante] : null;
    const combinacaoIndisponivel = Boolean(statusEscolhida?.conflito || statusEscolhida?.folga);
    const aprovarBloqueado = aindaVerificando || combinacaoIndisponivel;

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
                ${tecnicas
                  .map((t) => {
                    const status = idxRelevante !== null ? estado.conflitos?.[t.id]?.[idxRelevante] : null;
                    const tag = status?.folga ? ' 😴 folga' : status?.conflito ? ' ⚠️ conflito' : '';
                    return `<option value="${t.id}" ${estado.tecnicaId === t.id ? 'selected' : ''}>${t.nome}${tag}</option>`;
                  })
                  .join('')}
              </select>
            </div>
          </div>
          ${
            aindaVerificando
              ? `<div class="checking-note">🔄 Verificando disponibilidade das técnicas na agenda...</div>`
              : combinacaoIndisponivel
                ? `<div class="error-note">${statusEscolhida.folga ? '😴 Técnica selecionada está de folga (trabalhou no domingo anterior). Escolha outra técnica ou data.' : '⚠️ Técnica selecionada tem conflito de agenda nesse horário. Escolha outra técnica ou data.'}</div>`
                : ''
          }
          <div class="action-row">
            <button class="btn btn-approve" data-aprovar="${item._id}" ${aprovarBloqueado ? 'disabled' : ''}>Aprovar e atribuir</button>
            <button class="btn btn-decline" data-recusar="${item._id}">Recusar</button>
          </div>
          <div id="msg-${item._id}"></div>
        </div>
      </div>
    `;
  }

  function renderCardHistorico(item) {
    const tipoLabel = TAG_TIPO[item.tipo]?.label || item.tipo;
    const nomeSolicitante = item.vendedor || item.vendedorAcompanha || '—';
    const tecnica = tecnicas.find((t) => t.id === item.tecnicaAtribuida);
    const dataHora =
      item.tipoReserva === 'periodo'
        ? item.dataEscolhida
          ? `${formatarDataBR(item.dataEscolhida.dataInicio)} a ${formatarDataBR(item.dataEscolhida.dataFim)}`
          : null
        : formatarDataBR(item.dataEscolhida?.data);
    const statusLabel = item.status === 'aprovado' ? 'Aprovada' : 'Recusada';

    return `
      <div class="request-card" data-item-id="${item._id}">
        <div class="request-head">
          <div class="who">
            <strong>${tipoLabel} — ${item.tema || item.perfilProfissional || item.localInstituicao || ''}</strong>
            <span>Solicitado por ${nomeSolicitante} em ${formatDataHora(item.criadoEm)}</span>
            <div class="tags">
              <span class="tag status-${item.status}">${statusLabel}</span>
              ${renderTagsSolicitacao(item)}
            </div>
          </div>
        </div>
        <div class="request-body">
          ${renderConteudoPorTipo(item)}
          <div class="subhead">${item.status === 'aprovado' ? 'Decisão' : 'Recusada em'}</div>
          <p>
            ${item.status === 'aprovado' ? `<strong>Técnica:</strong> ${tecnica?.nome || '—'} — ` : ''}
            ${dataHora ? `<strong>Data:</strong> ${dataHora} — ` : ''}
            <strong>${item.status === 'aprovado' ? 'Aprovada' : 'Recusada'} em:</strong> ${formatDataHora(item.aprovadoEm)}
          </p>
          ${item.status === 'recusado' && item.motivoRecusa ? `<p><strong>Motivo:</strong> ${item.motivoRecusa}</p>` : ''}
        </div>
      </div>
    `;
  }

  async function carregarHistorico(status) {
    queueEl.innerHTML = `<div class="loading-state">Carregando...</div>`;
    const listas = await Promise.all(
      COLECOES.map(async (colecaoNome) => {
        const snap = await getDocs(query(collection(db, colecaoNome), where('status', '==', status)));
        return snap.docs.map((d) => ({ _id: d.id, _colecao: colecaoNome, ...d.data() }));
      })
    );
    historico[status] = listas.flat().sort((a, b) => {
      const da = a.aprovadoEm?.toMillis ? a.aprovadoEm.toMillis() : 0;
      const dbb = b.aprovadoEm?.toMillis ? b.aprovadoEm.toMillis() : 0;
      return dbb - da;
    });
    renderFila();
  }

  async function aprovar(item) {
    const estado = garantirEstado(item);
    const msgEl = container.querySelector(`#msg-${item._id}`);
    msgEl.innerHTML = '';

    if (!estado.tecnicaId) {
      msgEl.innerHTML = `<div class="error-note">Selecione uma técnica antes de aprovar.</div>`;
      return;
    }
    if (estado.dataEscolhidaIdx === null) {
      msgEl.innerHTML = `<div class="error-note">Escolha uma das datas propostas antes de aprovar.</div>`;
      return;
    }
    // Defesa extra além do botão desabilitado — se o clique já estava em voo
    // quando a checagem ainda não tinha voltado, não deixa aprovar às cegas.
    if (estado.conflitos === undefined) {
      msgEl.innerHTML = `<div class="error-note">Aguarde a verificação de disponibilidade das técnicas terminar.</div>`;
      return;
    }

    const idxRelevante = estado.dataEscolhidaIdx;
    if (tecnicaIndisponivelEm(estado, estado.tecnicaId, idxRelevante)) {
      const folga = estado.conflitos?.[estado.tecnicaId]?.[idxRelevante]?.folga;
      msgEl.innerHTML = `<div class="error-note">${folga ? '😴 Técnica selecionada está de folga (trabalhou no domingo anterior). Escolha outra técnica ou data.' : '⚠️ Técnica selecionada tem conflito de agenda nesse horário. Escolha outra técnica ou data.'}</div>`;
      return;
    }

    const dataHora = item.opcoesData[estado.dataEscolhidaIdx];

    const payload = {
      status: 'aprovado',
      tecnicaAtribuida: estado.tecnicaId,
      dataEscolhida: dataHora,
      aprovadoEm: serverTimestamp()
    };

    await updateDoc(doc(db, item._colecao, item._id), payload);

    const tecnica = tecnicas.find((t) => t.id === estado.tecnicaId);
    const nomeSolicitante = item.vendedor || item.vendedorAcompanha || '—';
    const modalidade = item.tipo === 'workshop' ? 'presencial' : item.modalidade;
    const endereco = item.endereco || null;

    // Só os campos preenchidos pelo vendedor no formulário original — exclui
    // metadados internos (_id/_colecao) e Timestamps do Firestore, que não
    // servem pro corpo do e-mail/descrição do evento e não serializam bem em
    // JSON. Usado tanto no evento do Calendar (mais contexto pra técnica)
    // quanto no e-mail de aprovação.
    const {
      _id,
      _colecao,
      criadoEm,
      slaExpiraEm,
      aprovadoEm,
      tecnicaAtribuida,
      status,
      opcoesData,
      dataEscolhida,
      ...solicitacaoParaEmail
    } = item;

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
            tipoReserva: item.tipoReserva || 'unico',
            modalidade,
            endereco,
            nomeSolicitante,
            dataHora,
            solicitacao: solicitacaoParaEmail
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

    // Mesmo critério do e-mail de café/atendimento (workers/email, gatilho
    // pra Nayra): interno + presencial + unidade Zona Sul. Além do e-mail,
    // cria o MESMO evento também na agenda dela — reaproveita o /criar-evento
    // genérico do worker de calendar, só trocando o tecnicaId. Nayra tem um
    // doc próprio na coleção `tecnicas` (papel: 'coordenadora', ativo: false
    // pra não aparecer no dropdown de atribuição nem entrar na checagem de
    // conflito) que ela conecta pela mesma tela `#/conectar-agenda`.
    if (
      calendarWorkerUrl &&
      item.tipo === 'consumidor_final' &&
      item.tipoTreinamento === 'interno' &&
      modalidade === 'presencial' &&
      item.unidade === 'Zona Sul'
    ) {
      try {
        const nayraSnap = await getDocs(
          query(collection(db, 'tecnicas'), where('papel', '==', 'coordenadora'), limit(1))
        );
        const nayraDoc = nayraSnap.docs[0];
        if (nayraDoc?.data()?.refreshTokenEncrypted) {
          const respNayra = await fetch(`${calendarWorkerUrl}/criar-evento`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tecnicaId: nayraDoc.id,
              tipo: item.tipo,
              tipoTreinamento: item.tipoTreinamento || null,
              tipoReserva: item.tipoReserva || 'unico',
              modalidade,
              endereco,
              nomeSolicitante,
              dataHora,
              solicitacao: solicitacaoParaEmail
            })
          });
          if (!respNayra.ok) {
            const erroNayra = await respNayra.json().catch(() => ({}));
            msgEl.innerHTML += `<div class="error-note">Aprovado, mas falha ao criar evento na agenda da Nayra: ${erroNayra.message || 'erro desconhecido'}</div>`;
          }
        }
      } catch (err) {
        msgEl.innerHTML += `<div class="error-note">Aprovado, mas falha ao criar evento na agenda da Nayra: ${err.message}</div>`;
      }
    }

    if (item.vendedorEmail) {
      notificarAprovacao({
        vendedorEmail: item.vendedorEmail,
        vendedorNome: nomeSolicitante,
        tipo: item.tipo,
        tipoTreinamento: item.tipoTreinamento || null,
        tipoReserva: item.tipoReserva || 'unico',
        modalidade,
        tecnicaNome: tecnica?.nome || '—',
        tecnicaEmail: tecnica?.email || null,
        dataHora,
        endereco,
        solicitacao: solicitacaoParaEmail
      });
    }
  }

  async function recusar(item) {
    const motivo = window.prompt('Motivo da recusa (obrigatório):', '');
    if (motivo === null) return; // cancelou

    const motivoLimpo = motivo.trim();
    if (!motivoLimpo) {
      window.alert('Motivo é obrigatório para recusar a solicitação.');
      return;
    }

    await updateDoc(doc(db, item._colecao, item._id), {
      status: 'recusado',
      motivoRecusa: motivoLimpo,
      aprovadoEm: serverTimestamp()
    });

    if (item.vendedorEmail) {
      notificarRecusa({
        vendedorEmail: item.vendedorEmail,
        vendedorNome: item.vendedor || item.vendedorAcompanha || '—',
        tipo: item.tipo,
        motivoRecusa: motivoLimpo
      });
    }
  }

  function renderFila() {
    if (abaAtiva !== 'pendente') {
      const itens = historico[abaAtiva] || [];
      queueEl.innerHTML =
        itens.length === 0
          ? `<div class="empty-state">Nenhuma solicitação ${abaAtiva === 'aprovado' ? 'aprovada' : 'recusada'} ainda.</div>`
          : itens.map((item) => renderCardHistorico(item)).join('');
      return;
    }

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
        renderFila();
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

  tabsEl.querySelectorAll('[data-aba]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.aba === abaAtiva) return;
      abaAtiva = btn.dataset.aba;
      tabsEl.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('active', b === btn));

      if (abaAtiva === 'pendente') {
        renderFila();
      } else {
        carregarHistorico(abaAtiva);
      }
    });
  });

  iniciar();

  return () => {
    unsubscribes.forEach((u) => u());
    if (intervaloCountdown) clearInterval(intervaloCountdown);
  };
}
