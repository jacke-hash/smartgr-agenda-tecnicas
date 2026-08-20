import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { calcularSlaExpiraEm } from '../utils/sla.js';
import {
  renderDateOptionsHTML,
  coletarDateOptions,
  dateOptionsValidas,
  opcoesForaDoPrazo,
  destacarOpcoesInvalidas,
  renderPeriodoOptionsHTML,
  ativarSincroniaPeriodo,
  coletarPeriodoOptions,
  periodoOptionsValidas,
  opcoesPeriodoForaDoPrazo
} from '../utils/date-options.js';
import { renderEnderecoHTML, coletarEndereco } from '../utils/endereco.js';
import { notificarNovaSolicitacao } from '../utils/notificar.js';

const UNIDADES = ['Zona Sul', 'Zona Leste', 'Rio Claro', 'Recife', 'Porto Alegre'];

export function renderFormConsumidorFinal(container, navigate, user) {
  let participantes = [{ nome: '', profissao: '' }];
  let modalidade = 'presencial';
  let tipoTreinamento = 'interno';

  container.innerHTML = `
    <button class="back-link" id="btn-voltar">← Voltar</button>
    <div class="page-head">
      <h1>Solicitar treinamento — Consumidor Final</h1>
      <p>Preencha os dados abaixo. A Julia tem até 24h para revisar e atribuir uma técnica.</p>
    </div>

    <div class="form-grid">
      <form class="card" id="form-final">

        <div class="section">
          <div class="section-title"><h3>Dados do profissional</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Vendedor responsável</label>
              <input type="text" id="vendedor" placeholder="Nome do vendedor" required />
            </div>
            <div class="field">
              <label>Perfil do profissional (cliente final)</label>
              <input type="text" id="perfilProfissional" placeholder="Ex: Esteticista, Clínica X" required />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Contato da pessoa</label>
              <input type="text" id="contato" placeholder="Telefone / WhatsApp / e-mail" required />
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <h3>Participantes</h3>
            <span>nome e profissão de cada pessoa que vai participar</span>
          </div>
          <div id="participants-wrap"></div>
          <button type="button" class="add-participant" id="btn-add-participant">+ Adicionar participante</button>
        </div>

        <div class="section">
          <div class="section-title"><h3>Equipamento e insumos</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Equipamento comprado</label>
              <input type="text" id="equipamentoComprado" placeholder="Ex: Smart Maximus Plasma" required />
            </div>
            <div class="field">
              <label>Número de série</label>
              <input type="text" id="numeroSerie" placeholder="Ex: SGR-2026-0451" />
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Insumos adquiridos (ponteiras etc.)</label>
              <input type="text" id="insumosAdquiridos" placeholder="Ex: 2x ponteira facial, 1x ponteira corporal" />
            </div>
          </div>
          <div class="field-row single">
            <div class="field">
              <label>Observação</label>
              <textarea id="observacao" placeholder="Alguma observação sobre a compra ou o treinamento"></textarea>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title"><h3>Modalidade</h3></div>
          <div class="field-row">
            <div class="field">
              <label>Online ou presencial</label>
              <div class="pill-group" id="grupo-modalidade">
                <div class="pill selected" data-val="presencial">Presencial</div>
                <div class="pill" data-val="online">Online</div>
              </div>
            </div>
            <div class="field">
              <label>Treinamento interno ou externo</label>
              <div class="pill-group" id="grupo-tipo">
                <div class="pill selected" data-val="interno">Interno</div>
                <div class="pill" data-val="externo">Externo</div>
              </div>
            </div>
          </div>

          <div class="conditional-block" id="bloco-interno">
            <div class="field-row single">
              <div class="field">
                <label>Unidade (treinamento interno)</label>
                <select id="unidade">
                  ${UNIDADES.map((u) => `<option value="${u}">${u}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="conditional-block" id="bloco-externo" style="display:none;">
            ${renderEnderecoHTML('final')}
            <div class="nayra-note">
              ⓘ Treinamento externo: o preenchimento operacional é feito pela técnica em outro portal. Este formulário só sinaliza a solicitação para a Julia.
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
            <span id="legenda-datas">informe 4 opções com início e término</span>
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
        <div class="sla-card">
          <div class="badge"><span class="dot"></span> SLA ativo</div>
          <h4>Julia tem até 24h</h4>
          <p>para revisar sua solicitação, escolher a data e atribuir a técnica responsável.</p>
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

  const wrapParticipants = container.querySelector('#participants-wrap');

  function renderParticipantes() {
    wrapParticipants.innerHTML = participantes
      .map(
        (p, i) => `
      <div class="participant-row" data-idx="${i}">
        <input type="text" placeholder="Nome" data-campo="nome" value="${p.nome}" required />
        <input type="text" placeholder="Profissão" data-campo="profissao" value="${p.profissao}" required />
        <button type="button" class="remove-btn" data-remove="${i}">×</button>
      </div>
    `
      )
      .join('');

    wrapParticipants.querySelectorAll('.participant-row').forEach((row) => {
      const idx = Number(row.dataset.idx);
      row.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', () => {
          participantes[idx][input.dataset.campo] = input.value;
        });
      });
    });

    wrapParticipants.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (participantes.length <= 1) return;
        participantes.splice(Number(btn.dataset.remove), 1);
        renderParticipantes();
      });
    });
  }

  renderParticipantes();

  container.querySelector('#btn-add-participant').addEventListener('click', () => {
    participantes.push({ nome: '', profissao: '' });
    renderParticipantes();
  });

  const grupoModalidade = container.querySelector('#grupo-modalidade');
  const grupoTipo = container.querySelector('#grupo-tipo');
  const blocoInterno = container.querySelector('#bloco-interno');
  const blocoExterno = container.querySelector('#bloco-externo');
  // Snapshot tirado antes de qualquer toggle — só esses campos (endereço) devem
  // voltar a ser `required` quando o bloco reaparece; o complemento (opcional)
  // nunca entra aqui.
  const camposObrigatoriosExterno = Array.from(blocoExterno.querySelectorAll('[required]'));

  function aplicarTrava() {
    grupoModalidade.querySelectorAll('.pill').forEach((p) => {
      p.classList.toggle('selected', p.dataset.val === modalidade);
      p.classList.toggle('disabled', tipoTreinamento === 'externo' && p.dataset.val === 'online');
    });
    grupoTipo.querySelectorAll('.pill').forEach((p) => {
      p.classList.toggle('selected', p.dataset.val === tipoTreinamento);
      p.classList.toggle('disabled', modalidade === 'online' && p.dataset.val === 'externo');
    });
    blocoInterno.style.display = tipoTreinamento === 'interno' ? 'block' : 'none';
    blocoExterno.style.display = tipoTreinamento === 'externo' ? 'block' : 'none';

    // Campos de endereço (renderEnderecoHTML) nascem com `required`. Enquanto o
    // bloco fica escondido (display:none), esses campos continuam obrigatórios
    // pra validação nativa do form — o Chrome tenta focar o primeiro inválido,
    // não consegue (está escondido) e bloqueia o submit em silêncio, sem
    // disparar o evento 'submit' nem mostrar erro nenhum. Por isso o required
    // precisa acompanhar a visibilidade do bloco.
    camposObrigatoriosExterno.forEach((el) => {
      el.required = tipoTreinamento === 'externo';
    });
  }

  grupoModalidade.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill || pill.classList.contains('disabled')) return;
    modalidade = pill.dataset.val;
    if (modalidade === 'online') tipoTreinamento = 'interno';
    aplicarTrava();
  });

  grupoTipo.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill || pill.classList.contains('disabled')) return;
    tipoTreinamento = pill.dataset.val;
    if (tipoTreinamento === 'externo') modalidade = 'presencial';
    aplicarTrava();
  });

  aplicarTrava();

  let tipoReserva = 'unico';
  const dateOptionsEl = container.querySelector('#date-options');
  const tituloDatas = container.querySelector('#titulo-datas');
  const legendaDatas = container.querySelector('#legenda-datas');
  const grupoTipoReserva = container.querySelector('#grupo-tipo-reserva');
  const errorBox = container.querySelector('#form-error');
  const submitBtn = container.querySelector('#btn-submit');

  function renderizarBlocoDatas() {
    if (tipoReserva === 'periodo') {
      tituloDatas.textContent = 'Períodos de preferência';
      legendaDatas.textContent = 'informe 2 opções de período (data início/término)';
      dateOptionsEl.innerHTML = renderPeriodoOptionsHTML();
      ativarSincroniaPeriodo(dateOptionsEl);
    } else {
      tituloDatas.textContent = 'Datas e horários de preferência';
      legendaDatas.textContent = 'informe 4 opções com início e término';
      dateOptionsEl.innerHTML = renderDateOptionsHTML();
    }
  }

  grupoTipoReserva.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    tipoReserva = pill.dataset.val;
    grupoTipoReserva.querySelectorAll('.pill').forEach((p) => p.classList.toggle('selected', p === pill));
    renderizarBlocoDatas();
  });

  container.querySelector('#form-final').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';

    const opcoesData = tipoReserva === 'periodo' ? coletarPeriodoOptions(dateOptionsEl) : coletarDateOptions(dateOptionsEl);
    const opcoesValidas = tipoReserva === 'periodo' ? periodoOptionsValidas(opcoesData) : dateOptionsValidas(opcoesData);
    if (!opcoesValidas) {
      destacarOpcoesInvalidas(dateOptionsEl, []);
      errorBox.innerHTML =
        tipoReserva === 'periodo'
          ? `<div class="error-note">Preencha as 2 opções de período (data início, data término e horários) — a data término não pode ser antes da data início.</div>`
          : `<div class="error-note">Preencha as 4 opções de data com início e término.</div>`;
      return;
    }

    const forasDoPrazo =
      tipoReserva === 'periodo' ? opcoesPeriodoForaDoPrazo(opcoesData, 7) : opcoesForaDoPrazo(opcoesData, 7);
    destacarOpcoesInvalidas(dateOptionsEl, forasDoPrazo);
    if (forasDoPrazo.length > 0) {
      errorBox.innerHTML = `<div class="error-note">A data escolhida precisa ter no mínimo 7 dias de antecedência a partir de hoje. Corrija a(s) opção(ões) destacada(s).</div>`;
      return;
    }

    if (participantes.some((p) => !p.nome || !p.profissao)) {
      errorBox.innerHTML = `<div class="error-note">Preencha nome e profissão de todos os participantes.</div>`;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const agora = new Date();
      const slaExpiraEm = calcularSlaExpiraEm(agora);

      const doc = {
        tipo: 'consumidor_final',
        vendedor: container.querySelector('#vendedor').value,
        vendedorEmail: user?.email || null,
        perfilProfissional: container.querySelector('#perfilProfissional').value,
        contato: container.querySelector('#contato').value,
        participantes,
        equipamentoComprado: container.querySelector('#equipamentoComprado').value,
        numeroSerie: container.querySelector('#numeroSerie').value,
        insumosAdquiridos: container.querySelector('#insumosAdquiridos').value,
        observacao: container.querySelector('#observacao').value,
        modalidade,
        tipoTreinamento,
        unidade: tipoTreinamento === 'interno' ? container.querySelector('#unidade').value : null,
        endereco: tipoTreinamento === 'externo' ? coletarEndereco(container, 'final') : null,
        tipoReserva,
        opcoesData,
        status: 'pendente',
        dataEscolhida: null,
        tecnicaAtribuida: null,
        slaExpiraEm: Timestamp.fromDate(slaExpiraEm),
        criadoEm: serverTimestamp(),
        aprovadoEm: null
      };

      await addDoc(collection(db, 'solicitacoes_consumidor_final'), doc);

      notificarNovaSolicitacao('consumidor_final', {
        Vendedor: doc.vendedor,
        'Perfil profissional': doc.perfilProfissional,
        Contato: doc.contato,
        Modalidade: modalidade === 'online' ? 'Online' : 'Presencial',
        'Tipo de treinamento': tipoTreinamento === 'interno' ? 'Interno' : 'Externo'
      });

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
