import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { TAG_TIPO, formatDataHora } from '../utils/tipo-labels.js';
import { formatarDataEscolhida } from '../utils/date-options.js';

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

function renderLinha(item, quemLabel) {
  const tipoInfo = TAG_TIPO[item.tipo];
  const dataLabel = formatarDataEscolhida(item) || 'Aguardando aprovação';
  const statusLabel = STATUS_LABEL[item.status] || item.status;
  return `
    <div class="tracking-row">
      <div>${dataLabel}</div>
      <div>${quemLabel}</div>
      <div>${tipoInfo ? `<span class="tag ${tipoInfo.cls}">${tipoInfo.label}</span>` : item.tipo}</div>
      <div><span class="tag status-${item.status}">${statusLabel}</span></div>
      <div>${formatDataHora(item.aprovadoEm || item.criadoEm)}</div>
    </div>
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

  function renderLista(el, itens, filtro, quemDoItem) {
    const filtrados = filtro ? itens.filter((item) => item.status === filtro) : itens;
    if (filtrados.length === 0) {
      el.innerHTML = `<div class="empty-state">Nenhuma solicitação${filtro ? ` com status "${STATUS_LABEL[filtro]}"` : ''}.</div>`;
      return;
    }
    el.innerHTML = renderCabecalho(quemDoItem === 'tecnica' ? 'Técnica' : 'Solicitante') +
      filtrados.map((item) => renderLinha(item, quemDoItem === 'tecnica' ? item._tecnicaNome : item.vendedor || item.vendedorAcompanha || '—')).join('');
  }

  async function carregar() {
    const [tecnicasSnap, enviadasResult, atribuidosResult] = await Promise.all([
      getDocs(collection(db, 'tecnicas')),
      carregarPorCampo('vendedorEmail', user.email),
      carregarPorCampo('tecnicaEmail', user.email)
    ]);

    const tecnicasPorId = Object.fromEntries(tecnicasSnap.docs.map((d) => [d.id, d.data()]));
    enviadas = enviadasResult.map((item) => ({ ...item, _tecnicaNome: tecnicasPorId[item.tecnicaAtribuida]?.nome || '—' }));
    atribuidos = atribuidosResult;

    blocoEnviadas.style.display = enviadas.length > 0 ? '' : 'none';
    blocoAtribuidos.style.display = atribuidos.length > 0 ? '' : 'none';
    estadoVazio.style.display = enviadas.length === 0 && atribuidos.length === 0 ? '' : 'none';

    renderLista(listaEnviadasEl, enviadas, filtroEnviadas.value, 'tecnica');
    renderLista(listaAtribuidosEl, atribuidos, filtroAtribuidos.value, 'solicitante');
  }

  filtroEnviadas.addEventListener('change', () => renderLista(listaEnviadasEl, enviadas, filtroEnviadas.value, 'tecnica'));
  filtroAtribuidos.addEventListener('change', () => renderLista(listaAtribuidosEl, atribuidos, filtroAtribuidos.value, 'solicitante'));

  carregar().catch((err) => {
    console.error('Falha ao carregar minhas solicitações:', err);
    listaEnviadasEl.innerHTML = `<div class="error-note">Erro ao carregar: ${err.message}</div>`;
    listaAtribuidosEl.innerHTML = '';
    blocoEnviadas.style.display = '';
  });
}
