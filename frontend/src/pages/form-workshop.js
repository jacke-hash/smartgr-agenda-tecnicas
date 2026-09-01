import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { calcularSlaExpiraEm } from '../utils/sla.js';
import { renderEnderecoHTML, coletarEndereco, ativarAutoPreenchimentoCep } from '../utils/endereco.js';
import {
  renderDateOptionsHTML,
  coletarDateOptions,
  dateOptionsValidas,
  opcoesForaDoPrazo,
  opcoesUnicoDuplicadas,
  destacarOpcoesInvalidas,
  renderPeriodoOptionsHTML,
  ativarSincroniaPeriodo,
  coletarPeriodoOptions,
  periodoOptionsValidas,
  opcoesPeriodoForaDoPrazo,
  opcoesPeriodoComOrdemInvalida,
  opcoesPeriodoDuplicadas
} from '../utils/date-options.js';
import { notificarNovaSolicitacao } from '../utils/notificar.js';

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
  return { get: () => valor };
}

export function renderFormWorkshop(container, navigate, user) {
  container.innerHTML = `
    <button class="back-link" id="btn-voltar">← Voltar</button>
    <div class="page-head">
      <h1>Solicitar Workshop</h1>
      <p>Ação institucional em faculdades, eventos ou instituições de ensino. A Julia tem até 24h para revisar.</p>
    </div>

    <div class="form-grid">
      <form class="card" id="form-workshop">

        <div class="section">
          <div class="section-title"><h3>Local e instituição</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Local / Instituição</label>
              <input type="text" id="localInstituicao" placeholder="Ex: Faculdade de Estética São Paulo" required />
            </div>
            <div class="field">
              <label>Vendedor que irá acompanhar</label>
              <input type="text" id="vendedorAcompanha" placeholder="Nome do vendedor" required />
            </div>
          </div>
          ${renderEnderecoHTML('workshop')}
        </div>

        <div class="section">
          <div class="section-title"><h3>Contato do responsável no local</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Nome do responsável</label>
              <input type="text" id="responsavelNome" placeholder="Nome de quem vai receber a equipe" required />
            </div>
            <div class="field">
              <label>Contato</label>
              <input type="text" id="responsavelContato" placeholder="Telefone / WhatsApp / e-mail" required />
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title"><h3>Sobre o workshop</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Tema</label>
              <input type="text" id="tema" placeholder="Ex: Introdução à Estética Avançada" required />
            </div>
            <div class="field">
              <label>Público</label>
              <input type="text" id="publico" placeholder="Ex: Alunos do curso de Estética, 4º semestre" required />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Nº estimado de participantes</label>
              <input type="number" min="1" id="participantesEstimados" placeholder="Ex: 40" required />
            </div>
            <div class="field">
              <label>Terá demonstração prática?</label>
              <div class="pill-group" id="grupo-demo">
                <div class="pill selected" data-val="sim">Sim</div>
                <div class="pill" data-val="nao">Não</div>
              </div>
            </div>
          </div>
          <div class="conditional-block" id="bloco-demo">
            <div class="field-row">
              <div class="field">
                <label>Precisa levar equipamento/insumos da SmartGR?</label>
                <div class="pill-group" id="grupo-equipamento">
                  <div class="pill selected" data-val="sim">Sim</div>
                  <div class="pill" data-val="nao">Não</div>
                </div>
              </div>
              <div class="field" id="campo-qual-equipamento">
                <label>Qual(is) equipamento(s)</label>
                <input type="text" id="qualEquipamento" placeholder="Ex: Smart Maximus Plasma" />
              </div>
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Material de apoio necessário (opcional)</label>
              <input type="text" id="materialApoio" placeholder="Ex: banner, folder, apresentação" />
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Observações</label>
              <textarea id="observacoes" placeholder="Alguma observação sobre o workshop"></textarea>
            </div>
          </div>
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
            <h3 id="titulo-datas">Datas e horários de preferência</h3>
            <span id="legenda-datas">informe pelo menos 2 das 4 opções, com início e término</span>
          </div>
          <div class="date-options" id="date-options">${renderDateOptionsHTML()}</div>
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
        <div class="sla-card workshop">
          <div class="badge"><span class="dot"></span> SLA ativo</div>
          <h4>Julia tem até 24h</h4>
          <p>para revisar a solicitação e atribuir a técnica responsável.</p>
        </div>
        <div class="timeline">
          <h4>Como funciona</h4>
          <div class="tl-item done"><div class="tl-dot">✓</div><div class="tl-text"><strong>Solicitação enviada</strong><span>Vendedor preenche o formulário</span></div></div>
          <div class="tl-item"><div class="tl-dot">2</div><div class="tl-text"><strong>Julia revisa (até 24h)</strong><span>Atribui a técnica</span></div></div>
          <div class="tl-item"><div class="tl-dot">3</div><div class="tl-text"><strong>Google Agenda atualizada</strong><span>Evento criado na agenda da técnica</span></div></div>
          <div class="tl-item"><div class="tl-dot">4</div><div class="tl-text"><strong>Vendedor notificado</strong><span>Técnica confirmada</span></div></div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-voltar').addEventListener('click', () => navigate('#/'));
  ativarAutoPreenchimentoCep(container, 'workshop');

  const campoQualEquipamento = container.querySelector('#campo-qual-equipamento');
  const equipamento = criarPillGroup(container, 'grupo-equipamento', 'sim', (valor) => {
    campoQualEquipamento.style.display = valor === 'sim' ? 'flex' : 'none';
  });

  const blocoDemo = container.querySelector('#bloco-demo');
  const demo = criarPillGroup(container, 'grupo-demo', 'sim', (valor) => {
    blocoDemo.style.display = valor === 'sim' ? 'block' : 'none';
  });

  const errorBox = container.querySelector('#form-error');
  const submitBtn = container.querySelector('#btn-submit');
  const dateOptionsEl = container.querySelector('#date-options');
  const tituloDatas = container.querySelector('#titulo-datas');
  const legendaDatas = container.querySelector('#legenda-datas');
  let tipoReserva = 'unico';

  function renderizarBlocoDatas() {
    if (tipoReserva === 'periodo') {
      tituloDatas.textContent = 'Períodos de preferência';
      legendaDatas.textContent = 'informe pelo menos 1 das 2 opções de período (data início/término)';
      dateOptionsEl.innerHTML = renderPeriodoOptionsHTML();
      ativarSincroniaPeriodo(dateOptionsEl);
    } else {
      tituloDatas.textContent = 'Datas e horários de preferência';
      legendaDatas.textContent = 'informe pelo menos 2 das 4 opções, com início e término';
      dateOptionsEl.innerHTML = renderDateOptionsHTML();
    }
  }

  criarPillGroup(container, 'grupo-tipo-reserva', 'unico', (valor) => {
    tipoReserva = valor;
    renderizarBlocoDatas();
  });

  // Feedback assim que o vendedor repete uma data/horário — não precisa
  // esperar o submit pra descobrir.
  dateOptionsEl.addEventListener('input', () => {
    const opcoesData = tipoReserva === 'periodo' ? coletarPeriodoOptions(dateOptionsEl) : coletarDateOptions(dateOptionsEl);
    const duplicadas = tipoReserva === 'periodo' ? opcoesPeriodoDuplicadas(opcoesData) : opcoesUnicoDuplicadas(opcoesData);
    destacarOpcoesInvalidas(dateOptionsEl, duplicadas);
    errorBox.innerHTML =
      duplicadas.length > 0 ? `<div class="error-note">As datas e horários das opções precisam ser diferentes entre si.</div>` : '';
  });

  container.querySelector('#form-workshop').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';

    const opcoesData = tipoReserva === 'periodo' ? coletarPeriodoOptions(dateOptionsEl) : coletarDateOptions(dateOptionsEl);

    if (tipoReserva === 'periodo') {
      const ordemInvalida = opcoesPeriodoComOrdemInvalida(opcoesData);
      if (ordemInvalida.length > 0) {
        destacarOpcoesInvalidas(dateOptionsEl, ordemInvalida);
        errorBox.innerHTML = `<div class="error-note">A data término não pode ser antes da data início. Corrija a(s) opção(ões) destacada(s).</div>`;
        return;
      }
    }

    const duplicadas = tipoReserva === 'periodo' ? opcoesPeriodoDuplicadas(opcoesData) : opcoesUnicoDuplicadas(opcoesData);
    if (duplicadas.length > 0) {
      destacarOpcoesInvalidas(dateOptionsEl, duplicadas);
      errorBox.innerHTML = `<div class="error-note">As datas e horários das opções precisam ser diferentes entre si.</div>`;
      return;
    }

    const opcoesValidas = tipoReserva === 'periodo' ? periodoOptionsValidas(opcoesData) : dateOptionsValidas(opcoesData);
    if (!opcoesValidas) {
      destacarOpcoesInvalidas(dateOptionsEl, []);
      errorBox.innerHTML =
        tipoReserva === 'periodo'
          ? `<div class="error-note">Preencha pelo menos 1 das 2 opções de período (data início, data término e horários).</div>`
          : `<div class="error-note">Preencha pelo menos 2 das 4 opções de data com início e término.</div>`;
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
      const teraDemonstracaoPratica = demo.get() === 'sim';

      const doc = {
        tipo: 'workshop',
        localInstituicao: container.querySelector('#localInstituicao').value,
        vendedorAcompanha: container.querySelector('#vendedorAcompanha').value,
        vendedorEmail: user?.email || null,
        endereco: coletarEndereco(container, 'workshop'),
        responsavelLocal: {
          nome: container.querySelector('#responsavelNome').value,
          contato: container.querySelector('#responsavelContato').value
        },
        tema: container.querySelector('#tema').value,
        publico: container.querySelector('#publico').value,
        participantesEstimados: Number(container.querySelector('#participantesEstimados').value),
        teraDemonstracaoPratica,
        precisaEquipamentoSmartGR: teraDemonstracaoPratica ? equipamento.get() === 'sim' : null,
        qualEquipamento: teraDemonstracaoPratica && equipamento.get() === 'sim' ? container.querySelector('#qualEquipamento').value : null,
        materialApoio: container.querySelector('#materialApoio').value || null,
        tipoReserva,
        opcoesData,
        observacoes: container.querySelector('#observacoes').value,
        status: 'pendente',
        dataEscolhida: null,
        tecnicaAtribuida: null,
        slaExpiraEm: Timestamp.fromDate(slaExpiraEm),
        criadoEm: serverTimestamp(),
        aprovadoEm: null
      };

      await addDoc(collection(db, 'solicitacoes_workshop'), doc);

      notificarNovaSolicitacao(
        'workshop',
        {
          Instituição: doc.localInstituicao,
          Vendedor: doc.vendedorAcompanha,
          Tema: doc.tema
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
