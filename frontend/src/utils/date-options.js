// `required` nativo NÃO é usado aqui de propósito — só um mínimo das opções
// precisa ser preenchido (2 de 4 no modo único, checado em JS via
// dateOptionsValidas), então travar todos os campos como obrigatórios no
// HTML bloquearia o submit mesmo com o mínimo já atingido.
export function renderDateOptionsHTML(containerId, diasMinimos = 7) {
  const min = dataMinimaISO(diasMinimos);
  const labels = ['Opção 1', 'Opção 2', 'Opção 3', 'Opção 4'];
  return labels
    .map(
      (label, i) => `
    <div class="date-option" data-idx="${i}">
      <span class="opt-label">${label}</span>
      <div class="row">
        <input type="date" data-idx="${i}" data-field="data" min="${min}" />
        <div class="time-pair">
          <span>Início</span>
          <input type="time" data-idx="${i}" data-field="horaInicio" />
        </div>
        <div class="time-pair">
          <span>Término</span>
          <input type="time" data-idx="${i}" data-field="horaTermino" />
        </div>
      </div>
    </div>
  `
    )
    .join('');
}

export function coletarDateOptions(container) {
  const opcoes = [null, null, null, null];
  // Escopo em `input[data-idx]`: o wrapper `.date-option` também ganhou
  // `data-idx` (pra destacarOpcoesInvalidas), então um seletor genérico
  // `[data-idx]` pega o próprio wrapper junto e grava uma chave espúria
  // `undefined` em cada opção — o que quebra o addDoc() (Firestore rejeita
  // valores `undefined`).
  container.querySelectorAll('input[data-idx]').forEach((input) => {
    const idx = Number(input.dataset.idx);
    const field = input.dataset.field;
    if (!opcoes[idx]) opcoes[idx] = { data: '', horaInicio: '', horaTermino: '' };
    opcoes[idx][field] = input.value;
  });
  return opcoes;
}

function opcaoUnicoPreenchida(o) {
  return Boolean(o && o.data && o.horaInicio && o.horaTermino);
}

// Só um mínimo das 4 opções precisa vir preenchido — o resto fica opcional
// (o vendedor pode não ter mais alternativas de data pra oferecer).
export function dateOptionsValidas(opcoes, minPreenchidas = 2) {
  return opcoes.filter(opcaoUnicoPreenchida).length >= minPreenchidas;
}

// Antecedência mínima é calculada em America/Sao_Paulo (UTC-3 fixo, sem horário
// de verão desde 2019) — não no fuso local do navegador — pra bater com a
// validação espelhada em firestore.rules (função diasAntecedenciaOk). Qualquer
// mudança aqui precisa refletir lá também.
function hojeBrasiliaISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Valor pro atributo `min` de <input type="date"> — trava física além da
// validação em JS/rules. Meio-dia UTC evita virar de dia por causa de fuso.
export function dataMinimaISO(diasMinimos = 7) {
  const d = new Date(`${hojeBrasiliaISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + diasMinimos);
  return d.toISOString().slice(0, 10);
}

export function diasAntecedenciaOk(dataStr, diasMinimos = 7, hojeStr = hojeBrasiliaISO()) {
  const alvo = new Date(`${dataStr}T00:00:00-03:00`);
  const hoje = new Date(`${hojeStr}T00:00:00-03:00`);
  const diffDias = Math.round((alvo.getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000));
  return diffDias >= diasMinimos;
}

// Só opções realmente preenchidas entram na checagem — uma opção deixada em
// branco (permitido, já que só um mínimo é obrigatório) não é "fora do prazo".
export function opcoesForaDoPrazo(opcoes, diasMinimos = 7) {
  return opcoes.reduce((idxs, o, idx) => {
    if (opcaoUnicoPreenchida(o) && !diasAntecedenciaOk(o.data, diasMinimos)) idxs.push(idx);
    return idxs;
  }, []);
}

// Só pra exibição — o valor armazenado (Firestore, comparações, validações)
// continua sempre em ISO (YYYY-MM-DD). Não usar o retorno daqui pra nada além
// de mostrar na tela.
export function formatarDataBR(dataISO) {
  if (!dataISO) return dataISO;
  const [ano, mes, dia] = dataISO.split('-');
  if (!ano || !mes || !dia) return dataISO;
  return `${dia}-${mes}-${ano}`;
}

// Formata a data ESCOLHIDA (pós-aprovação) de uma solicitação, único ou
// período — reaproveitado no painel da Julia e no painel "Minhas
// Solicitações". Retorna null se ainda não tem dataEscolhida (pendente).
export function formatarDataEscolhida(item) {
  if (!item.dataEscolhida) return null;
  return item.tipoReserva === 'periodo'
    ? `${formatarDataBR(item.dataEscolhida.dataInicio)} a ${formatarDataBR(item.dataEscolhida.dataFim)}`
    : formatarDataBR(item.dataEscolhida.data);
}

export function destacarOpcoesInvalidas(container, indicesInvalidos) {
  container.querySelectorAll('.date-option').forEach((el) => {
    const idx = Number(el.dataset.idx);
    el.classList.toggle('invalid', indicesInvalidos.includes(idx));
  });
}

// --- "Período de vários dias" (tipoReserva === 'periodo') ---
// Mesmo padrão visual/estrutural do modo "único" (.date-option + data-idx),
// só que 2 opções em vez de 4, cada uma com {dataInicio, dataFim, horaInicio,
// horaTermino} em vez de {data, horaInicio, horaTermino}.

// `required` nativo omitido de propósito — só 1 das 2 opções de período
// precisa vir preenchida (checado em JS via periodoOptionsValidas).
export function renderPeriodoOptionsHTML(diasMinimos = 7) {
  const min = dataMinimaISO(diasMinimos);
  const labels = ['Opção 1', 'Opção 2'];
  return labels
    .map(
      (label, i) => `
    <div class="date-option periodo" data-idx="${i}">
      <span class="opt-label">${label}</span>
      <div class="row">
        <div class="time-pair">
          <span>Data início</span>
          <input type="date" data-idx="${i}" data-field="dataInicio" min="${min}" />
        </div>
        <div class="time-pair">
          <span>Data término</span>
          <input type="date" data-idx="${i}" data-field="dataFim" min="${min}" />
        </div>
      </div>
      <div class="row">
        <div class="time-pair">
          <span>Horário início (1º dia)</span>
          <input type="time" data-idx="${i}" data-field="horaInicio" />
        </div>
        <div class="time-pair">
          <span>Horário término (último dia)</span>
          <input type="time" data-idx="${i}" data-field="horaTermino" />
        </div>
      </div>
    </div>
  `
    )
    .join('');
}

// Trava a data término pra nunca ficar antes da data início escolhida —
// UX na frente da validação em JS/rules, que também confere isso.
export function ativarSincroniaPeriodo(container) {
  container.querySelectorAll('.date-option.periodo').forEach((card) => {
    const inicio = card.querySelector('input[data-field="dataInicio"]');
    const fim = card.querySelector('input[data-field="dataFim"]');
    if (!inicio || !fim) return;
    inicio.addEventListener('change', () => {
      if (inicio.value) fim.min = inicio.value;
    });
  });
}

export function coletarPeriodoOptions(container) {
  const opcoes = [null, null];
  container.querySelectorAll('input[data-idx]').forEach((input) => {
    const idx = Number(input.dataset.idx);
    const field = input.dataset.field;
    if (!opcoes[idx]) opcoes[idx] = { dataInicio: '', dataFim: '', horaInicio: '', horaTermino: '' };
    opcoes[idx][field] = input.value;
  });
  return opcoes;
}

function opcaoPeriodoPreenchida(o) {
  return Boolean(o && o.dataInicio && o.dataFim && o.horaInicio && o.horaTermino);
}

function opcaoPeriodoCompleta(o) {
  return opcaoPeriodoPreenchida(o) && o.dataFim >= o.dataInicio;
}

// Só um mínimo das 2 opções precisa vir preenchida (e com dataFim >= dataInicio).
export function periodoOptionsValidas(opcoes, minPreenchidas = 1) {
  return opcoes.filter(opcaoPeriodoCompleta).length >= minPreenchidas;
}

// Opção preenchida mas com data término antes da início — erro específico,
// diferente de "faltou preencher".
export function opcoesPeriodoComOrdemInvalida(opcoes) {
  return opcoes.reduce((idxs, o, idx) => {
    if (opcaoPeriodoPreenchida(o) && o.dataFim < o.dataInicio) idxs.push(idx);
    return idxs;
  }, []);
}

// Só a data início de opções realmente completas entra na checagem — a data
// fim é consequência do período, não uma nova "data de agendamento", e uma
// opção em branco (permitido) não é "fora do prazo".
export function opcoesPeriodoForaDoPrazo(opcoes, diasMinimos = 7) {
  return opcoes.reduce((idxs, o, idx) => {
    if (opcaoPeriodoCompleta(o) && !diasAntecedenciaOk(o.dataInicio, diasMinimos)) idxs.push(idx);
    return idxs;
  }, []);
}
