import { collection, addDoc, serverTimestamp, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { calcularSlaExpiraEm } from '../utils/sla.js';
import {
  renderDateOptionsSugeridasHTML,
  coletarDateOptionsSugeridas,
  ativarSelecaoSugerida,
  opcoesSugeridasIncompletas,
  dateOptionsValidas,
  opcoesForaDoPrazo,
  destacarOpcoesInvalidas,
  renderPeriodoOptionsHTML,
  ativarSincroniaPeriodo,
  coletarPeriodoOptions,
  periodoOptionsValidas,
  opcoesPeriodoForaDoPrazo,
  opcoesPeriodoComOrdemInvalida,
  opcoesPeriodoDuplicadas
} from '../utils/date-options.js';
import { renderEnderecoHTML, coletarEndereco, ativarAutoPreenchimentoCep } from '../utils/endereco.js';
import { normalizarTexto } from '../utils/texto.js';
import { notificarNovaSolicitacao } from '../utils/notificar.js';

const VITHORIA_EMAIL = 'vithoria@smartgr.com.br';

function criarPillGroup(container, id, valorInicial, aoMudar) {
  const el = container.querySelector(`#${id}`);
  let valor = valorInicial;
  el.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    valor = pill.dataset.val;
    el.querySelectorAll('.pill').forEach((p) => p.classList.toggle('selected', p === pill));
    aoMudar(valor);
  });
  return {
    get: () => valor
  };
}

export function renderFormRevenda(container, navigate, user) {
  container.innerHTML = `
    <button class="back-link" id="btn-voltar">← Voltar</button>
    <div class="page-head">
      <h1>Solicitar treinamento — Revendas/Redes</h1>
      <p>Preencha os dados abaixo para a Julia revisar em até 24h.</p>
    </div>

    <div class="form-grid">
      <form class="card" id="form-revenda">

        <div class="section">
          <div class="section-title"><h3>Dados da revenda</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Quem é a revenda</label>
              <input type="text" id="nomeRevenda" placeholder="Nome da revenda" required />
            </div>
            <div class="field">
              <label>Vendedor responsável</label>
              <input type="text" id="vendedor" placeholder="Nome do vendedor" required />
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Treinamento é para a revenda (equipe própria) ou para um cliente da revenda?</label>
              <div class="pill-group" id="grupo-destino">
                <div class="pill selected" data-val="propria_revenda">Equipe da própria revenda</div>
                <div class="pill" data-val="cliente_revenda">Cliente da revenda</div>
              </div>
            </div>
          </div>
        </div>

        <div id="campos-propria">
        <div class="section">
          <div class="section-title"><h3>Perfil da revenda</h3><span>pode variar a cada solicitação</span></div>
          <div class="field-row">
            <div class="field">
              <label>Marcas que a revenda trabalha</label>
              <input type="text" id="marcasQueTrabalha" placeholder="Ex: SmartGR, Marca X, Marca Y" required />
            </div>
            <div class="field">
              <label>Trabalha com a linha completa da SmartGR?</label>
              <div class="pill-group" id="grupo-linha-completa">
                <div class="pill selected" data-val="sim">Sim</div>
                <div class="pill" data-val="nao">Não</div>
              </div>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Principal público da revenda</label>
              <input type="text" id="principalPublico" placeholder="Ex: Esteticistas, dermatologistas, clínicas de estética" required />
            </div>
            <div class="field">
              <label>A revenda tem técnica própria?</label>
              <div class="pill-group" id="grupo-tecnica-propria">
                <div class="pill selected" data-val="sim">Sim</div>
                <div class="pill" data-val="nao">Não</div>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title"><h3>Estrutura para o treinamento</h3><span>a revenda pode ter, alugar, ou não ter esses espaços</span></div>
          <div class="field-row">
            <div class="field">
              <label>Tem sala de cursos?</label>
              <div class="pill-group" id="grupo-sala-cursos">
                <div class="pill selected" data-val="sim">Sim</div>
                <div class="pill" data-val="nao">Não</div>
              </div>
            </div>
            <div class="field" id="campo-capacidade">
              <label>Capacidade da sala</label>
              <input type="number" min="1" id="capacidadeSala" placeholder="Nº de pessoas" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Possui espaço para prática?</label>
              <div class="pill-group" id="grupo-espaco-pratica">
                <div class="pill selected" data-val="sim">Sim</div>
                <div class="pill" data-val="nao">Não</div>
              </div>
            </div>
            <div class="field" id="campo-tipo-pratica">
              <label>Tipo de prática</label>
              <div class="pill-group" id="grupo-tipo-pratica">
                <div class="pill selected" data-val="assistida">Assistida</div>
                <div class="pill" data-val="handson">Hands-on</div>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title"><h3>Modalidade e local</h3></div>
          <div class="field-row single">
            <div class="field">
              <label>Presencial ou online</label>
              <div class="pill-group" id="grupo-modalidade">
                <div class="pill selected" data-val="presencial">Presencial</div>
                <div class="pill" data-val="online">Online</div>
              </div>
            </div>
          </div>
          <div class="conditional-block" id="bloco-endereco">
            ${renderEnderecoHTML('revenda')}
          </div>
        </div>

        <div class="section">
          <div class="section-title"><h3>Transporte</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Precisa de transporte para a técnica?</label>
              <div class="pill-group" id="grupo-transporte">
                <div class="pill selected" data-val="sim">Sim</div>
                <div class="pill" data-val="nao">Não</div>
              </div>
            </div>
          </div>
          <div id="bloco-transporte-detalhe">
            <div class="field-row">
              <div class="field">
                <label>Quem paga o transporte</label>
                <div class="pill-group" id="grupo-quem-paga">
                  <div class="pill selected" data-val="smart">SmartGR</div>
                  <div class="pill" data-val="revenda">Revenda/Rede</div>
                </div>
              </div>
              <div class="field">
                <label>Meio de transporte</label>
                <select id="meioTransporte">
                  <option value="carro">Carro</option>
                  <option value="aviao">Avião</option>
                  <option value="onibus">Ônibus</option>
                  <option value="carro_proprio">Carro Próprio</option>
                  <option value="uber">Uber</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title"><h3>Sobre o treinamento</h3></div>
          <div class="field-row single">
            <div class="field">
              <label>Tema do treinamento</label>
              <input type="text" id="tema" placeholder="Ex: Protocolos de Bioestimuladores" required />
            </div>
          </div>
        </div>
        </div>

        <div id="campos-cliente" style="display:none;">
          <div class="section">
            <div class="section-title"><h3>Tipo de treinamento</h3><span>este fluxo é sempre sobre equipamentos</span></div>
            <div class="field-row single">
              <div class="field">
                <label>Este treinamento será Online ou Presencial?</label>
                <div class="pill-group" id="grupo-tipo-treinamento-cliente">
                  <div class="pill" data-val="online">Online</div>
                  <div class="pill" data-val="presencial">Presencial</div>
                </div>
              </div>
            </div>
          </div>
          <div id="campos-cliente-detalhe"></div>
        </div>

        <div class="section">
          <div class="section-title"><h3>Duração da reserva</h3></div>
          <div class="field-row single">
            <div class="field">
              <label>Essa reserva é para mais de 1 dia?</label>
              <div class="pill-group" id="grupo-tipo-reserva">
                <div class="pill selected" data-val="unico">Não, um único dia</div>
                <div class="pill" data-val="periodo">Sim, período de vários dias</div>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <h3 id="titulo-datas">Datas disponíveis</h3>
            <span id="legenda-datas">carregando sugestões de data...</span>
          </div>
          <div class="date-options" id="date-options"><div class="loading-state">Carregando datas disponíveis...</div></div>
          <div class="advance-note">
            ⚠️ Antecedência mínima de 7 dias a partir de hoje. Datas fora do prazo não podem ser enviadas.
          </div>
          <div id="form-error"></div>
        </div>

        <label class="copia-thayla">
          <input type="checkbox" id="copia-thayla" />
          <span>Enviar uma cópia desta solicitação para a Thayla, para que ela acompanhe os pedidos feitos pela equipe.</span>
        </label>

        <button type="submit" class="submit-btn" id="btn-submit">Enviar solicitação</button>
      </form>

      <div>
        <div class="sla-card revenda">
          <div class="badge"><span class="dot"></span> SLA ativo</div>
          <h4>Julia tem até 24h</h4>
          <p>para revisar a solicitação, escolher a data e atribuir a técnica responsável.</p>
        </div>
        <div class="timeline">
          <h4>Como funciona</h4>
          <div class="tl-item done"><div class="tl-dot">✓</div><div class="tl-text"><strong>Solicitação enviada</strong><span>Vendedor preenche o formulário</span></div></div>
          <div class="tl-item"><div class="tl-dot">2</div><div class="tl-text"><strong>Julia revisa (até 24h)</strong><span>Escolhe data e atribui a técnica</span></div></div>
          <div class="tl-item"><div class="tl-dot">3</div><div class="tl-text"><strong>Google Agenda atualizada</strong><span>Evento criado na agenda da técnica</span></div></div>
          <div class="tl-item"><div class="tl-dot">4</div><div class="tl-text"><strong>Vendedor notificado</strong><span>Data e técnica confirmadas</span></div></div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-voltar').addEventListener('click', () => navigate('#/'));

  const linhaCompleta = criarPillGroup(container, 'grupo-linha-completa', 'sim', () => {});
  const tecnicaPropria = criarPillGroup(container, 'grupo-tecnica-propria', 'sim', () => {});
  const espacoPratica = criarPillGroup(container, 'grupo-espaco-pratica', 'sim', () => {});
  const tipoPratica = criarPillGroup(container, 'grupo-tipo-pratica', 'assistida', () => {});
  const quemPaga = criarPillGroup(container, 'grupo-quem-paga', 'smart', () => {});

  const campoCapacidade = container.querySelector('#campo-capacidade');
  const salaCursos = criarPillGroup(container, 'grupo-sala-cursos', 'sim', (valor) => {
    campoCapacidade.style.display = valor === 'sim' ? 'flex' : 'none';
  });

  const blocoEndereco = container.querySelector('#bloco-endereco');
  // Snapshot antes de qualquer toggle — só esses campos devem voltar a ser
  // `required` quando o bloco reaparece (complemento é opcional, fica de fora).
  const camposObrigatoriosEndereco = Array.from(blocoEndereco.querySelectorAll('[required]'));
  ativarAutoPreenchimentoCep(container, 'revenda', () => atualizarSugestoesUnico());
  const modalidade = criarPillGroup(container, 'grupo-modalidade', 'presencial', (valor) => {
    blocoEndereco.style.display = valor === 'presencial' ? 'block' : 'none';
    // Campo required escondido trava o submit nativo em silêncio (Chrome não
    // consegue focar um campo inválido oculto) — required precisa acompanhar
    // a visibilidade do bloco.
    camposObrigatoriosEndereco.forEach((el) => {
      el.required = valor === 'presencial';
    });
    atualizarSugestoesUnico();
  });

  let tecnicas = [];
  async function carregarTecnicas() {
    const snap = await getDocs(query(collection(db, 'tecnicas'), where('ativo', '==', true)));
    tecnicas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // "Equipe própria": cidade do endereço dela mesma, só se presencial.
  // "Cliente da revenda": cidade do endereço do cliente, só se presencial.
  // Online (qualquer um dos dois) não tem endereço — cai no "todas as técnicas".
  function ehRioClaro() {
    if (destino.get() === 'cliente_revenda') {
      if (tipoTreinamentoCliente !== 'presencial') return false;
      const cidade = container.querySelector('[data-endereco="revenda-cliente-cidade"]')?.value || '';
      return normalizarTexto(cidade) === normalizarTexto('Rio Claro');
    }
    if (modalidade.get() !== 'presencial') return false;
    const cidade = container.querySelector('[data-endereco="revenda-cidade"]')?.value || '';
    return normalizarTexto(cidade) === normalizarTexto('Rio Claro');
  }

  const blocoTransporteDetalhe = container.querySelector('#bloco-transporte-detalhe');
  const transporte = criarPillGroup(container, 'grupo-transporte', 'sim', (valor) => {
    blocoTransporteDetalhe.style.display = valor === 'sim' ? 'block' : 'none';
  });

  // --- Fluxo "Cliente da revenda" — sempre sobre equipamentos, com switch
  // Online/Presencial decidindo os campos seguintes. Reconstrói o bloco do
  // zero a cada escolha/troca — evita dado fantasma (endereço/transporte
  // preenchido e esquecido se voltar pra Online, ou pra "equipe própria").
  const camposPropria = container.querySelector('#campos-propria');
  const camposCliente = container.querySelector('#campos-cliente');
  const camposClienteDetalhe = container.querySelector('#campos-cliente-detalhe');
  const grupoTipoTreinamentoCliente = container.querySelector('#grupo-tipo-treinamento-cliente');
  // Endereço (fluxo próprio) já segue a regra dele mesmo (modalidade) — os
  // demais campos obrigatórios do bloco só valem quando ele está visível.
  const camposObrigatoriosPropriaExtras = Array.from(camposPropria.querySelectorAll('[required]')).filter(
    (el) => !camposObrigatoriosEndereco.includes(el)
  );

  let tipoTreinamentoCliente = null;

  function renderCamposClienteDetalhe() {
    if (!tipoTreinamentoCliente) {
      camposClienteDetalhe.innerHTML = '';
      return;
    }
    const presencial = tipoTreinamentoCliente === 'presencial';
    camposClienteDetalhe.innerHTML = `
      <div class="section">
        <div class="section-title"><h3>Dados do treinamento</h3></div>
        <div class="field-row single">
          <div class="field">
            <label>Nome do treinamento</label>
            <input type="text" id="nomeTreinamentoCliente" placeholder="Ex: Treinamento Smart Maximus Plasma" required />
          </div>
        </div>
        <div class="field-row single">
          <div class="field">
            <label>Observações</label>
            <textarea id="observacoesCliente" placeholder="Opcional"></textarea>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title"><h3>Equipamento e insumos</h3></div>
        <div class="field-row">
          <div class="field">
            <label>${presencial ? 'Equipamento que o cliente possui' : 'Equipamento'}</label>
            <input type="text" id="equipamentoCliente" placeholder="Ex: Smart Maximus Plasma" required />
          </div>
          <div class="field">
            <label>Insumos</label>
            <input type="text" id="insumosCliente" placeholder="Ex: Ponteiras, gel condutor" required />
          </div>
        </div>
      </div>

      ${
        presencial
          ? `
      <div class="section">
        <div class="section-title"><h3>Endereço</h3></div>
        <div class="conditional-block" id="bloco-endereco-cliente">${renderEnderecoHTML('revenda-cliente')}</div>
      </div>

      <div class="section">
        <div class="section-title"><h3>Transporte</h3></div>
        <div class="field-row single">
          <div class="field">
            <label>Transporte para a técnica</label>
            <input type="text" id="transporteCliente" placeholder="Ex: Uber, revenda paga o combustível" required />
          </div>
        </div>
      </div>
      `
          : ''
      }
    `;

    if (presencial) {
      ativarAutoPreenchimentoCep(container, 'revenda-cliente', () => atualizarSugestoesUnico());
    }
  }

  grupoTipoTreinamentoCliente.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    tipoTreinamentoCliente = pill.dataset.val;
    grupoTipoTreinamentoCliente.querySelectorAll('.pill').forEach((p) => p.classList.toggle('selected', p === pill));
    renderCamposClienteDetalhe();
    atualizarSugestoesUnico();
  });

  const destino = criarPillGroup(container, 'grupo-destino', 'propria_revenda', (valor) => {
    const mostrarPropria = valor === 'propria_revenda';
    camposPropria.style.display = mostrarPropria ? '' : 'none';
    camposCliente.style.display = mostrarPropria ? 'none' : '';

    // Campo required escondido trava o submit nativo em silêncio — precisa
    // acompanhar a visibilidade do bloco, igual o padrão já usado no endereço.
    camposObrigatoriosPropriaExtras.forEach((el) => {
      el.required = mostrarPropria;
    });
    camposObrigatoriosEndereco.forEach((el) => {
      el.required = mostrarPropria && modalidade.get() === 'presencial';
    });

    // Troca de branch limpa o que já tinha sido preenchido do outro lado.
    tipoTreinamentoCliente = null;
    grupoTipoTreinamentoCliente.querySelectorAll('.pill').forEach((p) => p.classList.remove('selected'));
    camposClienteDetalhe.innerHTML = '';
    atualizarSugestoesUnico();
  });

  let tipoReserva = 'unico';
  let datasSugeridasAtuais = [];
  const dateOptionsEl = container.querySelector('#date-options');
  const tituloDatas = container.querySelector('#titulo-datas');
  const legendaDatas = container.querySelector('#legenda-datas');
  const errorBox = container.querySelector('#form-error');
  const submitBtn = container.querySelector('#btn-submit');

  function renderizarBlocoDatas() {
    if (tipoReserva === 'periodo') {
      tituloDatas.textContent = 'Períodos de preferência';
      legendaDatas.textContent = 'informe pelo menos 1 das 2 opções de período (data início/término)';
      dateOptionsEl.innerHTML = renderPeriodoOptionsHTML();
      ativarSincroniaPeriodo(dateOptionsEl);
    } else {
      tituloDatas.textContent = 'Datas disponíveis';
      atualizarSugestoesUnico();
    }
  }

  // Busca no worker os dias em que alguma técnica já está livre de verdade —
  // pra Rio Claro, prioriza só a agenda da Vithoria (Julia ainda pode
  // atribuir outra técnica na aprovação, isso só muda a SUGESTÃO de data);
  // pros demais casos, olha todas as técnicas ativas.
  async function atualizarSugestoesUnico() {
    if (tipoReserva !== 'unico') return;
    const calendarWorkerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;

    dateOptionsEl.innerHTML = `<div class="loading-state">Carregando datas disponíveis...</div>`;
    legendaDatas.textContent = 'carregando sugestões de data...';

    if (!calendarWorkerUrl || tecnicas.length === 0) {
      datasSugeridasAtuais = [];
      dateOptionsEl.innerHTML = `<div class="empty-state">Não foi possível carregar as datas disponíveis agora. Tente novamente em instantes.</div>`;
      return;
    }

    const vithoria = tecnicas.find((t) => t.email === VITHORIA_EMAIL);
    const usarSoVithoria = ehRioClaro() && Boolean(vithoria);
    const tecnicaIds = usarSoVithoria ? [vithoria.id] : tecnicas.map((t) => t.id);

    try {
      const resp = await fetch(`${calendarWorkerUrl}/sugerir-datas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tecnicaIds, diasMinimos: 7 })
      });
      const resultado = await resp.json();
      datasSugeridasAtuais = resp.ok ? resultado.datas || [] : [];
    } catch (err) {
      console.error('Falha ao buscar datas sugeridas:', err);
      datasSugeridasAtuais = [];
    }

    if (tipoReserva !== 'unico') return;

    const minimo = Math.min(2, datasSugeridasAtuais.length);
    legendaDatas.textContent =
      datasSugeridasAtuais.length > 0 ? `selecione de ${minimo} a 4 das opções abaixo e informe o horário` : '';
    dateOptionsEl.innerHTML = renderDateOptionsSugeridasHTML(datasSugeridasAtuais);
    ativarSelecaoSugerida(dateOptionsEl);
  }

  criarPillGroup(container, 'grupo-tipo-reserva', 'unico', (valor) => {
    tipoReserva = valor;
    renderizarBlocoDatas();
  });

  // Feedback assim que o vendedor repete uma data/horário — não precisa
  // esperar o submit pra descobrir. Único agora usa dias já sugeridos pelo
  // sistema (nunca colidem entre si por construção), então a checagem de
  // duplicata só faz sentido pro período.
  dateOptionsEl.addEventListener('input', () => {
    if (tipoReserva !== 'periodo') return;
    const opcoesData = coletarPeriodoOptions(dateOptionsEl);
    const duplicadas = opcoesPeriodoDuplicadas(opcoesData);
    destacarOpcoesInvalidas(dateOptionsEl, duplicadas);
    errorBox.innerHTML =
      duplicadas.length > 0 ? `<div class="error-note">As datas e horários das opções precisam ser diferentes entre si.</div>` : '';
  });

  carregarTecnicas().then(() => atualizarSugestoesUnico());

  container.querySelector('#form-revenda').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';

    if (destino.get() === 'cliente_revenda' && !tipoTreinamentoCliente) {
      errorBox.innerHTML = `<div class="error-note">Selecione o tipo de treinamento (Online ou Presencial).</div>`;
      return;
    }

    if (tipoReserva === 'unico' && datasSugeridasAtuais.length === 0) {
      errorBox.innerHTML = `<div class="error-note">Não há datas disponíveis no momento. Tente novamente mais tarde ou fale com a Julia.</div>`;
      return;
    }

    const opcoesData =
      tipoReserva === 'periodo' ? coletarPeriodoOptions(dateOptionsEl) : coletarDateOptionsSugeridas(dateOptionsEl, datasSugeridasAtuais);

    if (tipoReserva === 'periodo') {
      const ordemInvalida = opcoesPeriodoComOrdemInvalida(opcoesData);
      if (ordemInvalida.length > 0) {
        destacarOpcoesInvalidas(dateOptionsEl, ordemInvalida);
        errorBox.innerHTML = `<div class="error-note">A data término não pode ser antes da data início. Corrija a(s) opção(ões) destacada(s).</div>`;
        return;
      }

      const duplicadas = opcoesPeriodoDuplicadas(opcoesData);
      if (duplicadas.length > 0) {
        destacarOpcoesInvalidas(dateOptionsEl, duplicadas);
        errorBox.innerHTML = `<div class="error-note">As datas e horários das opções precisam ser diferentes entre si.</div>`;
        return;
      }
    } else {
      const incompletas = opcoesSugeridasIncompletas(dateOptionsEl, datasSugeridasAtuais);
      if (incompletas.length > 0) {
        destacarOpcoesInvalidas(dateOptionsEl, incompletas);
        errorBox.innerHTML = `<div class="error-note">Preencha o horário de início e término das datas marcadas.</div>`;
        return;
      }
    }

    const minimoUnico = Math.min(2, datasSugeridasAtuais.length);
    const opcoesValidas = tipoReserva === 'periodo' ? periodoOptionsValidas(opcoesData) : dateOptionsValidas(opcoesData, minimoUnico);
    if (!opcoesValidas) {
      destacarOpcoesInvalidas(dateOptionsEl, []);
      errorBox.innerHTML =
        tipoReserva === 'periodo'
          ? `<div class="error-note">Preencha pelo menos 1 das 2 opções de período (data início, data término e horários).</div>`
          : `<div class="error-note">Selecione pelo menos ${minimoUnico} das datas sugeridas e informe o horário.</div>`;
      return;
    }

    const forasDoPrazo =
      tipoReserva === 'periodo' ? opcoesPeriodoForaDoPrazo(opcoesData, 7) : opcoesForaDoPrazo(opcoesData, 7);
    destacarOpcoesInvalidas(dateOptionsEl, forasDoPrazo);
    if (forasDoPrazo.length > 0) {
      errorBox.innerHTML = `<div class="error-note">A data escolhida precisa ter no mínimo 7 dias de antecedência a partir de hoje. Corrija a(s) opção(ões) destacada(s).</div>`;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const agora = new Date();
      const slaExpiraEm = calcularSlaExpiraEm(agora);
      const precisaTransporte = transporte.get() === 'sim';
      const temSalaCursos = salaCursos.get() === 'sim';
      const clienteRevenda = destino.get() === 'cliente_revenda';
      const presencialCliente = clienteRevenda && tipoTreinamentoCliente === 'presencial';

      const doc = {
        tipo: 'revenda',
        nomeRevenda: container.querySelector('#nomeRevenda').value,
        vendedor: container.querySelector('#vendedor').value,
        vendedorEmail: user?.email || null,
        destinoTreinamento: destino.get(),

        // Campos do fluxo "equipe própria" — ficam null quando é cliente da
        // revenda, pra não misturar os dois formatos no mesmo documento.
        marcasQueTrabalha: clienteRevenda ? null : container.querySelector('#marcasQueTrabalha').value,
        trabalhaLinhaCompletaSmartGR: clienteRevenda ? null : linhaCompleta.get() === 'sim',
        principalPublico: clienteRevenda ? null : container.querySelector('#principalPublico').value,
        temTecnicaPropria: clienteRevenda ? null : tecnicaPropria.get() === 'sim',
        temSalaCursos: clienteRevenda ? null : temSalaCursos,
        capacidadeSala: clienteRevenda ? null : temSalaCursos ? Number(container.querySelector('#capacidadeSala').value) || null : null,
        possuiEspacoPratica: clienteRevenda ? null : espacoPratica.get() === 'sim',
        tipoPratica: clienteRevenda ? null : espacoPratica.get() === 'sim' ? tipoPratica.get() : null,
        modalidade: clienteRevenda ? null : modalidade.get(),
        endereco: clienteRevenda ? null : modalidade.get() === 'presencial' ? coletarEndereco(container, 'revenda') : null,
        precisaTransporte: clienteRevenda ? null : precisaTransporte,
        transporte:
          !clienteRevenda && precisaTransporte
            ? { quemPaga: quemPaga.get(), meio: container.querySelector('#meioTransporte').value }
            : null,
        tema: clienteRevenda ? null : container.querySelector('#tema').value,

        // Campos do fluxo "cliente da revenda" — sempre sobre equipamentos.
        tipoTreinamentoCliente: clienteRevenda ? tipoTreinamentoCliente : null,
        nomeTreinamentoCliente: clienteRevenda ? container.querySelector('#nomeTreinamentoCliente').value : null,
        observacoesCliente: clienteRevenda ? container.querySelector('#observacoesCliente').value : null,
        equipamentoCliente: clienteRevenda ? container.querySelector('#equipamentoCliente').value : null,
        insumosCliente: clienteRevenda ? container.querySelector('#insumosCliente').value : null,
        enderecoCliente: presencialCliente ? coletarEndereco(container, 'revenda-cliente') : null,
        transporteCliente: presencialCliente ? container.querySelector('#transporteCliente').value : null,

        tipoReserva,
        opcoesData,
        status: 'pendente',
        dataEscolhida: null,
        tecnicaAtribuida: null,
        slaExpiraEm: Timestamp.fromDate(slaExpiraEm),
        criadoEm: serverTimestamp(),
        aprovadoEm: null
      };

      await addDoc(collection(db, 'solicitacoes_revenda'), doc);

      notificarNovaSolicitacao(
        'revenda',
        clienteRevenda
          ? {
              'Revenda/Rede': doc.nomeRevenda,
              Vendedor: doc.vendedor,
              Destino: 'Cliente da revenda',
              'Tipo de treinamento': doc.tipoTreinamentoCliente === 'online' ? 'Online' : 'Presencial',
              'Nome do treinamento': doc.nomeTreinamentoCliente,
              Equipamento: doc.equipamentoCliente
            }
          : {
              'Revenda/Rede': doc.nomeRevenda,
              Vendedor: doc.vendedor,
              Destino: 'Equipe própria',
              Tema: doc.tema,
              Modalidade: doc.modalidade === 'online' ? 'Online' : 'Presencial'
            },
        { copiaThayla: container.querySelector('#copia-thayla').checked }
      );

      container.querySelector('.form-grid').innerHTML = `
        <div class="success-note">✓ Solicitação enviada com sucesso. A Julia vai revisar em até 24h.</div>
      `;
    } catch (err) {
      errorBox.innerHTML = `<div class="error-note">Erro ao enviar solicitação: ${err.message}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar solicitação';
    }
  });
}
