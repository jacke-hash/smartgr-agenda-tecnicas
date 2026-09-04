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

// --- Modo único com datas SUGERIDAS pelo sistema (worker /sugerir-datas) ---
// Paralelo a renderDateOptionsHTML/coletarDateOptions — não substitui essas
// funções (período continua usando o fluxo de digitação livre de sempre,
// só o modo único ganhou sugestão). A data de cada opção é travada (uma por
// dia sugerido, o vendedor não digita) — só horário início/término continua
// editável. Reaproveita opcaoUnicoPreenchida/dateOptionsValidas/
// opcoesForaDoPrazo/destacarOpcoesInvalidas — mesmo shape {data, horaInicio,
// horaTermino}, então rules/SLA/Calendar não precisam saber que a origem da
// data mudou.
// A rota /sugerir-datas agora devolve TODOS os dias disponíveis numa janela
// de 2 meses (pode passar de 30 dias) — mostrar tudo de uma vez ficaria
// enorme, então pagina de 4 em 4 (mesmo tamanho de grid de sempre, 2x2) com
// setinha pra navegar. `data-idx` continua sendo o índice ABSOLUTO no array
// completo (não muda com a página) — coletarDateOptionsSugeridas/
// opcoesSugeridasIncompletas continuam funcionando sem saber de paginação,
// já que `querySelector` acha o card mesmo escondido (`hidden`) numa página
// que não é a atual, preservando o que a pessoa já marcou ao navegar.
const SUGERIDAS_POR_PAGINA = 4;

export function renderDateOptionsSugeridasHTML(datasDisponiveis) {
  if (!datasDisponiveis || datasDisponiveis.length === 0) {
    return `<div class="empty-state">Nenhuma data disponível encontrada no momento. Tente novamente mais tarde ou fale com a Julia.</div>`;
  }
  const totalPaginas = Math.ceil(datasDisponiveis.length / SUGERIDAS_POR_PAGINA);
  const cards = datasDisponiveis
    .map((dataISO, i) => {
      const pagina = Math.floor(i / SUGERIDAS_POR_PAGINA);
      return `
    <label class="date-option sugerida" data-idx="${i}" data-pagina="${pagina}" ${pagina === 0 ? '' : 'hidden'}>
      <div class="date-sugerida-topo">
        <input type="checkbox" class="date-sugerida-check" data-idx="${i}" />
        <span class="opt-label">${formatarDataBR(dataISO)}</span>
      </div>
      <div class="row">
        <div class="time-pair">
          <span>Início</span>
          <input type="time" data-idx="${i}" data-field="horaInicio" />
        </div>
        <div class="time-pair">
          <span>Término</span>
          <input type="time" data-idx="${i}" data-field="horaTermino" />
        </div>
      </div>
    </label>
  `;
    })
    .join('');

  const paginacao =
    totalPaginas > 1
      ? `
    <div class="date-pager">
      <button type="button" class="date-pager-btn" data-pager="prev" disabled>←</button>
      <span class="date-pager-info" data-pager-info>Página 1 de ${totalPaginas}</span>
      <button type="button" class="date-pager-btn" data-pager="next">→</button>
    </div>
  `
      : '';

  return cards + paginacao;
}

// Destaque visual de "marcada" (borda azul) — reflete o estado do checkbox
// na hora, sem esperar re-render nenhum. Também liga as setas de paginação,
// se existirem (janela com só 1 página não mostra pager nenhum).
export function ativarSelecaoSugerida(container) {
  container.querySelectorAll('.date-sugerida-check').forEach((check) => {
    check.addEventListener('change', () => {
      check.closest('.date-option.sugerida')?.classList.toggle('selecionada', check.checked);
    });
  });

  const btnPrev = container.querySelector('[data-pager="prev"]');
  const btnNext = container.querySelector('[data-pager="next"]');
  if (!btnPrev || !btnNext) return;

  const cartoes = [...container.querySelectorAll('.date-option.sugerida')];
  const totalPaginas = Math.max(...cartoes.map((c) => Number(c.dataset.pagina))) + 1;
  const infoEl = container.querySelector('[data-pager-info]');
  let paginaAtual = 0;

  function mostrarPagina() {
    cartoes.forEach((c) => {
      c.hidden = Number(c.dataset.pagina) !== paginaAtual;
    });
    infoEl.textContent = `Página ${paginaAtual + 1} de ${totalPaginas}`;
    btnPrev.disabled = paginaAtual === 0;
    btnNext.disabled = paginaAtual === totalPaginas - 1;
  }

  btnPrev.addEventListener('click', () => {
    if (paginaAtual === 0) return;
    paginaAtual -= 1;
    mostrarPagina();
  });
  btnNext.addEventListener('click', () => {
    if (paginaAtual === totalPaginas - 1) return;
    paginaAtual += 1;
    mostrarPagina();
  });
}

// Só monta {data, horaInicio, horaTermino} pras opções com a caixinha
// marcada — as demais ficam vazias (mesmo tratamento de "opção não
// oferecida" que o modo digitado já tinha).
export function coletarDateOptionsSugeridas(container, datasDisponiveis) {
  return datasDisponiveis.map((dataISO, idx) => {
    const label = container.querySelector(`.date-option.sugerida[data-idx="${idx}"]`);
    const marcada = label?.querySelector('.date-sugerida-check')?.checked;
    if (!marcada) return { data: '', horaInicio: '', horaTermino: '' };
    return {
      data: dataISO,
      horaInicio: label.querySelector('[data-field="horaInicio"]')?.value || '',
      horaTermino: label.querySelector('[data-field="horaTermino"]')?.value || ''
    };
  });
}

// Caixa marcada mas sem horário preenchido — a pessoa claramente quis
// oferecer essa data, só esqueceu o horário. Erro diferente de "não marcou".
export function opcoesSugeridasIncompletas(container, datasDisponiveis) {
  const idxs = [];
  datasDisponiveis.forEach((_, idx) => {
    const label = container.querySelector(`.date-option.sugerida[data-idx="${idx}"]`);
    const marcada = label?.querySelector('.date-sugerida-check')?.checked;
    if (!marcada) return;
    const horaInicio = label.querySelector('[data-field="horaInicio"]')?.value;
    const horaTermino = label.querySelector('[data-field="horaTermino"]')?.value;
    if (!horaInicio || !horaTermino) idxs.push(idx);
  });
  return idxs;
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

// Duas opções com a MESMA data+horário não são duas alternativas de
// verdade — oferecer a mesma janela duas vezes não ajuda a Julia a montar a
// agenda. Só compara opções já preenchidas (uma em branco nunca é
// "duplicata" de outra). Retorna os índices de TODAS as opções envolvidas em
// algum par repetido (pra destacar as duas, não só a segunda).
export function opcoesUnicoDuplicadas(opcoes) {
  const idxs = new Set();
  for (let i = 0; i < opcoes.length; i++) {
    if (!opcaoUnicoPreenchida(opcoes[i])) continue;
    for (let j = i + 1; j < opcoes.length; j++) {
      if (!opcaoUnicoPreenchida(opcoes[j])) continue;
      if (
        opcoes[i].data === opcoes[j].data &&
        opcoes[i].horaInicio === opcoes[j].horaInicio &&
        opcoes[i].horaTermino === opcoes[j].horaTermino
      ) {
        idxs.add(i);
        idxs.add(j);
      }
    }
  }
  return [...idxs];
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

// Mesma lógica de opcoesUnicoDuplicadas, pro shape de período (dataInicio +
// dataFim + horários) — duas opções de período idênticas não são duas
// alternativas de verdade.
export function opcoesPeriodoDuplicadas(opcoes) {
  const idxs = new Set();
  for (let i = 0; i < opcoes.length; i++) {
    if (!opcaoPeriodoPreenchida(opcoes[i])) continue;
    for (let j = i + 1; j < opcoes.length; j++) {
      if (!opcaoPeriodoPreenchida(opcoes[j])) continue;
      if (
        opcoes[i].dataInicio === opcoes[j].dataInicio &&
        opcoes[i].dataFim === opcoes[j].dataFim &&
        opcoes[i].horaInicio === opcoes[j].horaInicio &&
        opcoes[i].horaTermino === opcoes[j].horaTermino
      ) {
        idxs.add(i);
        idxs.add(j);
      }
    }
  }
  return [...idxs];
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
