import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { calcularSlaUteis } from '../utils/sla.js';
import {
  renderDateOptionsHTML,
  coletarDateOptions,
  dateOptionsValidas,
  opcoesForaDoPrazo,
  destacarOpcoesInvalidas
} from '../utils/date-options.js';
import { renderEnderecoHTML, coletarEndereco } from '../utils/endereco.js';
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
  return {
    get: () => valor
  };
}

export function renderFormRevenda(container, navigate, user) {
  container.innerHTML = `
    <button class="back-link" id="btn-voltar">← Voltar</button>
    <div class="page-head">
      <h1>Solicitar treinamento — Revenda</h1>
      <p>Preencha os dados abaixo para a Julia revisar em até 24h úteis.</p>
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
                  <div class="pill" data-val="revenda">Revenda</div>
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

        <div class="section">
          <div class="section-title">
            <h3>Datas e horários de preferência</h3>
            <span>informe 4 opções com início e término</span>
          </div>
          <div class="date-options" id="date-options">${renderDateOptionsHTML()}</div>
          <div class="advance-note">
            ⚠️ Antecedência mínima de 7 dias a partir de hoje. Datas fora do prazo não podem ser enviadas.
          </div>
          <div id="form-error"></div>
        </div>

        <button type="submit" class="submit-btn" id="btn-submit">Enviar solicitação</button>
      </form>

      <div>
        <div class="sla-card revenda">
          <div class="badge"><span class="dot"></span> SLA ativo</div>
          <h4>Julia tem até 24h úteis</h4>
          <p>para revisar a solicitação, escolher a data e atribuir a técnica responsável.</p>
        </div>
        <div class="timeline">
          <h4>Como funciona</h4>
          <div class="tl-item done"><div class="tl-dot">✓</div><div class="tl-text"><strong>Solicitação enviada</strong><span>Vendedor preenche o formulário</span></div></div>
          <div class="tl-item"><div class="tl-dot">2</div><div class="tl-text"><strong>Julia revisa (até 24h úteis)</strong><span>Escolhe data e atribui a técnica</span></div></div>
          <div class="tl-item"><div class="tl-dot">3</div><div class="tl-text"><strong>Google Agenda atualizada</strong><span>Evento criado na agenda da técnica</span></div></div>
          <div class="tl-item"><div class="tl-dot">4</div><div class="tl-text"><strong>Vendedor notificado</strong><span>Data e técnica confirmadas</span></div></div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-voltar').addEventListener('click', () => navigate('#/'));

  const destino = criarPillGroup(container, 'grupo-destino', 'propria_revenda', () => {});
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
  const modalidade = criarPillGroup(container, 'grupo-modalidade', 'presencial', (valor) => {
    blocoEndereco.style.display = valor === 'presencial' ? 'block' : 'none';
    // Campo required escondido trava o submit nativo em silêncio (Chrome não
    // consegue focar um campo inválido oculto) — required precisa acompanhar
    // a visibilidade do bloco.
    camposObrigatoriosEndereco.forEach((el) => {
      el.required = valor === 'presencial';
    });
  });

  const blocoTransporteDetalhe = container.querySelector('#bloco-transporte-detalhe');
  const transporte = criarPillGroup(container, 'grupo-transporte', 'sim', (valor) => {
    blocoTransporteDetalhe.style.display = valor === 'sim' ? 'block' : 'none';
  });

  const dateOptionsEl = container.querySelector('#date-options');
  const errorBox = container.querySelector('#form-error');
  const submitBtn = container.querySelector('#btn-submit');

  container.querySelector('#form-revenda').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';

    const opcoesData = coletarDateOptions(dateOptionsEl);
    if (!dateOptionsValidas(opcoesData)) {
      destacarOpcoesInvalidas(dateOptionsEl, []);
      errorBox.innerHTML = `<div class="error-note">Preencha as 4 opções de data com início e término.</div>`;
      return;
    }

    const forasDoPrazo = opcoesForaDoPrazo(opcoesData, 7);
    destacarOpcoesInvalidas(dateOptionsEl, forasDoPrazo);
    if (forasDoPrazo.length > 0) {
      errorBox.innerHTML = `<div class="error-note">A data escolhida precisa ter no mínimo 7 dias de antecedência a partir de hoje. Corrija a(s) opção(ões) destacada(s).</div>`;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const agora = new Date();
      const slaExpiraEm = calcularSlaUteis(agora, 24);
      const precisaTransporte = transporte.get() === 'sim';
      const temSalaCursos = salaCursos.get() === 'sim';

      const doc = {
        tipo: 'revenda',
        nomeRevenda: container.querySelector('#nomeRevenda').value,
        vendedor: container.querySelector('#vendedor').value,
        vendedorEmail: user?.email || null,
        destinoTreinamento: destino.get(),
        marcasQueTrabalha: container.querySelector('#marcasQueTrabalha').value,
        trabalhaLinhaCompletaSmartGR: linhaCompleta.get() === 'sim',
        principalPublico: container.querySelector('#principalPublico').value,
        temTecnicaPropria: tecnicaPropria.get() === 'sim',
        temSalaCursos,
        capacidadeSala: temSalaCursos ? Number(container.querySelector('#capacidadeSala').value) || null : null,
        possuiEspacoPratica: espacoPratica.get() === 'sim',
        tipoPratica: espacoPratica.get() === 'sim' ? tipoPratica.get() : null,
        modalidade: modalidade.get(),
        endereco: modalidade.get() === 'presencial' ? coletarEndereco(container, 'revenda') : null,
        precisaTransporte,
        transporte: precisaTransporte
          ? { quemPaga: quemPaga.get(), meio: container.querySelector('#meioTransporte').value }
          : null,
        tema: container.querySelector('#tema').value,
        opcoesData,
        status: 'pendente',
        dataEscolhida: null,
        tecnicaAtribuida: null,
        slaExpiraEm: Timestamp.fromDate(slaExpiraEm),
        criadoEm: serverTimestamp(),
        aprovadoEm: null
      };

      await addDoc(collection(db, 'solicitacoes_revenda'), doc);

      notificarNovaSolicitacao('revenda', {
        Revenda: doc.nomeRevenda,
        Vendedor: doc.vendedor,
        Destino: doc.destinoTreinamento === 'propria_revenda' ? 'Equipe própria' : 'Cliente da revenda',
        Tema: doc.tema,
        Modalidade: doc.modalidade === 'online' ? 'Online' : 'Presencial'
      });

      container.querySelector('.form-grid').innerHTML = `
        <div class="success-note">✓ Solicitação enviada com sucesso. A Julia vai revisar em até 24h úteis.</div>
      `;
    } catch (err) {
      errorBox.innerHTML = `<div class="error-note">Erro ao enviar solicitação: ${err.message}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar solicitação';
    }
  });
}
