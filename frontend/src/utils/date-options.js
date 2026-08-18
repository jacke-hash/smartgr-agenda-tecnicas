export function renderDateOptionsHTML(containerId) {
  const labels = ['Opção 1', 'Opção 2', 'Opção 3', 'Opção 4'];
  return labels
    .map(
      (label, i) => `
    <div class="date-option" data-idx="${i}">
      <span class="opt-label">${label}</span>
      <div class="row">
        <input type="date" data-idx="${i}" data-field="data" required />
        <div class="time-pair">
          <span>Início</span>
          <input type="time" data-idx="${i}" data-field="horaInicio" required />
        </div>
        <div class="time-pair">
          <span>Término</span>
          <input type="time" data-idx="${i}" data-field="horaTermino" required />
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

export function dateOptionsValidas(opcoes) {
  return opcoes.every((o) => o && o.data && o.horaInicio && o.horaTermino);
}

// Antecedência mínima é calculada em America/Sao_Paulo (UTC-3 fixo, sem horário
// de verão desde 2019) — não no fuso local do navegador — pra bater com a
// validação espelhada em firestore.rules (função diasAntecedenciaOk). Qualquer
// mudança aqui precisa refletir lá também.
function hojeBrasiliaISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function diasAntecedenciaOk(dataStr, diasMinimos = 7, hojeStr = hojeBrasiliaISO()) {
  const alvo = new Date(`${dataStr}T00:00:00-03:00`);
  const hoje = new Date(`${hojeStr}T00:00:00-03:00`);
  const diffDias = Math.round((alvo.getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000));
  return diffDias >= diasMinimos;
}

export function opcoesForaDoPrazo(opcoes, diasMinimos = 7) {
  return opcoes.reduce((idxs, o, idx) => {
    if (!diasAntecedenciaOk(o.data, diasMinimos)) idxs.push(idx);
    return idxs;
  }, []);
}

export function destacarOpcoesInvalidas(container, indicesInvalidos) {
  container.querySelectorAll('.date-option').forEach((el) => {
    const idx = Number(el.dataset.idx);
    el.classList.toggle('invalid', indicesInvalidos.includes(idx));
  });
}
