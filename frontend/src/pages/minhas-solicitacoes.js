import { collection, query, where, getDocs, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { TAG_TIPO, formatDataHora } from '../utils/tipo-labels.js';
import { formatarDataEscolhida } from '../utils/date-options.js';
import { eventoForaDoExpediente } from '../utils/expediente.js';
import { notificarRecusaTecnica } from '../utils/notificar.js';

const COLECOES = ['solicitacoes_consumidor_final', 'solicitacoes_revenda', 'solicitacoes_workshop'];

// Só os 3 status que o sistema realmente tem hoje — sem inventar um estágio
// "concluído" que não existe em nenhum outro lugar do código.
const STATUS_LABEL = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };

function porCriadoEmDesc(a, b) {
  const ta = a.criadoEm?.toMillis ? a.criadoEm.toMillis() : 0;
  const tb = b.criadoEm?.toMillis ? b.criadoEm.toMillis() : 0;
  return tb - ta;
}

// Uma query por coleção (campo é sempre o mesmo nas 3: vendedorEmail ou
// tecnicaEmail) — não precisa saber de antemão se o e-mail logado é
// "vendedor" ou "técnica", cada seção só aparece se a query dela trouxer algo.
async function carregarPorCampo(campo, valor) {
  const resultados = await Promise.all(
    COLECOES.map((colecaoNome) =>
      getDocs(query(collection(db, colecaoNome), where(campo, '==', valor))).then((snap) =>
        snap.docs.map((d) => ({ _id: d.id, _colecao: colecaoNome, ...d.data() }))
      )
    )
  );
  return resultados.flat().sort(porCriadoEmDesc);
}

// Treinamento pode ter 2ª técnica opcional (frontend/src/pages/painel-julia.js,
// "+ Atribuir outra técnica") — busca as duas listas (tecnicaEmail e
// tecnicaEmail2) e junta, marcando em qual "slot" essa pessoa está, pra saber
// depois quais campos limpar se ela recusar.
async function carregarAtribuidos(email) {
  const [primarios, secundarios] = await Promise.all([
    carregarPorCampo('tecnicaEmail', email),
    carregarPorCampo('tecnicaEmail2', email)
  ]);
  const vistos = new Set();
  const combinados = [];
  primarios.forEach((item) => {
    vistos.add(item._id);
    combinados.push({ ...item, _meuSlot: 'primaria' });
  });
  secundarios.forEach((item) => {
    if (vistos.has(item._id)) return;
    combinados.push({ ...item, _meuSlot: 'secundaria' });
  });
  return combinados.sort(porCriadoEmDesc);
}

function renderCabecalho(labelQuem) {
  return `
    <div class="tracking-row tracking-header">
      <div>Data</div>
      <div>${labelQuem}</div>
      <div>Tipo</div>
      <div>Status</div>
      <div>Última atualização</div>
    </div>
  `;
}

function renderLinha(item, quemLabel, podeRecusar) {
  const tipoInfo = TAG_TIPO[item.tipo];
  const dataLabel = formatarDataEscolhida(item) || 'Aguardando aprovação';
  const statusLabel = STATUS_LABEL[item.status] || item.status;
  return `
    <div class="tracking-row">
      <div>${dataLabel}</div>
      <div>${quemLabel}</div>
      <div>${tipoInfo ? `<span class="tag ${tipoInfo.cls}">${tipoInfo.label}</span>` : item.tipo}</div>
      <div><span class="tag status-${item.status}">${statusLabel}</span></div>
      <div>
        ${formatDataHora(item.aprovadoEm || item.criadoEm)}
        ${
          podeRecusar
            ? `<div><button class="btn btn-decline" style="margin-top:6px;" data-recusar-tecnica="${item._id}">Recusar (fora do expediente)</button></div>`
            : ''
        }
      </div>
    </div>
    <div id="msg-recusar-${item._id}"></div>
  `;
}

export function renderMinhasSolicitacoes(container, navigate, user) {
  container.innerHTML = `
    <div class="page-head">
      <h1>Minhas Solicitações</h1>
      <p>Acompanhe o status do que você enviou e, se você for técnica, dos treinamentos atribuídos a você.</p>
    </div>

    <div class="section" id="bloco-enviadas" style="display:none;">
      <div class="section-title">
        <h3>Solicitações que enviei</h3>
        <select id="filtro-enviadas" class="filtro-status">
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="aprovado">Aprovado</option>
          <option value="recusado">Recusado</option>
        </select>
      </div>
      <div id="lista-enviadas" class="tracking-list"><div class="loading-state">Carregando...</div></div>
    </div>

    <div class="section" id="bloco-atribuidos" style="display:none;">
      <div class="section-title">
        <h3>Treinamentos atribuídos a mim</h3>
        <select id="filtro-atribuidos" class="filtro-status">
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="aprovado">Aprovado</option>
          <option value="recusado">Recusado</option>
        </select>
      </div>
      <p style="font-size:12px;color:var(--text-soft);margin:-6px 0 10px;">
        Treinamentos em fim de semana, feriado ou fora de 08:30–17:30 podem ser recusados por você.
      </p>
      <div id="lista-atribuidos" class="tracking-list"><div class="loading-state">Carregando...</div></div>
    </div>

    <div id="estado-vazio" class="empty-state" style="display:none;">
      Nenhuma solicitação encontrada pra ${user.email}.
    </div>
  `;

  const blocoEnviadas = container.querySelector('#bloco-enviadas');
  const blocoAtribuidos = container.querySelector('#bloco-atribuidos');
  const listaEnviadasEl = container.querySelector('#lista-enviadas');
  const listaAtribuidosEl = container.querySelector('#lista-atribuidos');
  const filtroEnviadas = container.querySelector('#filtro-enviadas');
  const filtroAtribuidos = container.querySelector('#filtro-atribuidos');
  const estadoVazio = container.querySelector('#estado-vazio');

  let enviadas = [];
  let atribuidos = [];
  let minhaTecnicaId = null;

  function renderListaEnviadas(itens, filtro) {
    const filtrados = filtro ? itens.filter((item) => item.status === filtro) : itens;
    if (filtrados.length === 0) {
      listaEnviadasEl.innerHTML = `<div class="empty-state">Nenhuma solicitação${filtro ? ` com status "${STATUS_LABEL[filtro]}"` : ''}.</div>`;
      return;
    }
    listaEnviadasEl.innerHTML =
      renderCabecalho('Técnica') + filtrados.map((item) => renderLinha(item, item._tecnicaNome, false)).join('');
  }

  function renderListaAtribuidos(itens, filtro) {
    const filtrados = filtro ? itens.filter((item) => item.status === filtro) : itens;
    if (filtrados.length === 0) {
      listaAtribuidosEl.innerHTML = `<div class="empty-state">Nenhuma solicitação${filtro ? ` com status "${STATUS_LABEL[filtro]}"` : ''}.</div>`;
      return;
    }
    listaAtribuidosEl.innerHTML = renderCabecalho('Solicitante') +
      filtrados
        .map((item) => {
          const podeRecusar =
            item.status === 'aprovado' && eventoForaDoExpediente(item.dataEscolhida, item.tipoReserva || 'unico');
          return renderLinha(item, item.vendedor || item.vendedorAcompanha || '—', podeRecusar);
        })
        .join('');

    listaAtribuidosEl.querySelectorAll('[data-recusar-tecnica]').forEach((btn) => {
      const itemId = btn.dataset.recusarTecnica;
      const item = atribuidos.find((i) => i._id === itemId);
      btn.addEventListener('click', () => recusarComoTecnica(item, btn));
    });
  }

  // Recusa só o SEU pedaço do treinamento: se havia 2ª técnica, a outra
  // continua com o evento dela intacto (evento próprio por técnica — mesmo
  // padrão já usado pra Nayra em painel-julia.js). Sem promover ninguém pro
  // lugar vazio automaticamente — a Julia reatribui pela aba "Aprovadas" do
  // painel dela, igual já faz hoje pra qualquer troca de técnica.
  async function recusarComoTecnica(item, btnEl) {
    const msgEl = container.querySelector(`#msg-recusar-${item._id}`);
    msgEl.innerHTML = '';

    const motivo = window.prompt(
      'Este treinamento cai fora do horário comercial (fim de semana, feriado ou fora de 08:30–17:30).\nMotivo da recusa (opcional):',
      ''
    );
    if (motivo === null) return;
    const motivoLimpo = motivo.trim();

    btnEl.disabled = true;
    btnEl.textContent = 'Recusando...';

    const ehPrimaria = item._meuSlot === 'primaria';
    const eventId = ehPrimaria ? item.googleEventId : item.googleEventId2;
    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;

    if (calendarWorkerUrl && eventId && minhaTecnicaId) {
      try {
        await fetch(`${calendarWorkerUrl}/escala/excluir-evento`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tecnicaId: minhaTecnicaId, eventId })
        });
      } catch (err) {
        console.error('recusar (técnica): falha ao excluir evento da própria agenda, seguindo mesmo assim:', err.message);
      }
    }

    const camposSlot = ehPrimaria
      ? { tecnicaAtribuida: null, tecnicaEmail: null, googleEventId: null, googleEventLink: null, googleMeetLink: null }
      : { tecnicaAtribuida2: null, tecnicaEmail2: null, googleEventId2: null, googleEventLink2: null, googleMeetLink2: null };

    try {
      await updateDoc(doc(db, item._colecao, item._id), {
        ...camposSlot,
        recusasTecnica: arrayUnion({
          tecnicaNome: user.displayName || user.email,
          tecnicaEmail: user.email,
          slot: item._meuSlot,
          motivo: motivoLimpo,
          em: new Date().toISOString()
        })
      });
    } catch (err) {
      msgEl.innerHTML = `<div class="error-note">Erro ao recusar: ${err.message}</div>`;
      btnEl.disabled = false;
      btnEl.textContent = 'Recusar (fora do expediente)';
      return;
    }

    notificarRecusaTecnica({
      tecnicaNome: user.displayName || user.email,
      tipo: item.tipo,
      tipoReserva: item.tipoReserva || 'unico',
      dataHora: item.dataEscolhida,
      motivo: motivoLimpo,
      vendedorNome: item.vendedor || item.vendedorAcompanha || '—'
    });

    atribuidos = atribuidos.filter((i) => i._id !== item._id);
    renderListaAtribuidos(atribuidos, filtroAtribuidos.value);
    blocoAtribuidos.style.display = atribuidos.length > 0 ? '' : 'none';
  }

  async function carregar() {
    const [tecnicasSnap, enviadasResult, atribuidosResult] = await Promise.all([
      getDocs(collection(db, 'tecnicas')),
      carregarPorCampo('vendedorEmail', user.email),
      carregarAtribuidos(user.email)
    ]);

    const tecnicasPorId = Object.fromEntries(tecnicasSnap.docs.map((d) => [d.id, d.data()]));
    minhaTecnicaId = tecnicasSnap.docs.find((d) => d.data()?.email === user.email)?.id || null;

    enviadas = enviadasResult.map((item) => ({ ...item, _tecnicaNome: tecnicasPorId[item.tecnicaAtribuida]?.nome || '—' }));
    atribuidos = atribuidosResult;

    blocoEnviadas.style.display = enviadas.length > 0 ? '' : 'none';
    blocoAtribuidos.style.display = atribuidos.length > 0 ? '' : 'none';
    estadoVazio.style.display = enviadas.length === 0 && atribuidos.length === 0 ? '' : 'none';

    renderListaEnviadas(enviadas, filtroEnviadas.value);
    renderListaAtribuidos(atribuidos, filtroAtribuidos.value);
  }

  filtroEnviadas.addEventListener('change', () => renderListaEnviadas(enviadas, filtroEnviadas.value));
  filtroAtribuidos.addEventListener('change', () => renderListaAtribuidos(atribuidos, filtroAtribuidos.value));

  carregar().catch((err) => {
    console.error('Falha ao carregar minhas solicitações:', err);
    listaEnviadasEl.innerHTML = `<div class="error-note">Erro ao carregar: ${err.message}</div>`;
    listaAtribuidosEl.innerHTML = '';
    blocoEnviadas.style.display = '';
  });
}
