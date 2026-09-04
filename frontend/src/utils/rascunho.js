// Rascunho de formulário salvo no localStorage do próprio navegador — nunca
// sincroniza entre pessoas nem vai pro Firestore, só sobrevive a um F5/fechar
// aba sem querer no MESMO aparelho. Cada formulário usa uma chave própria e
// apaga o rascunho assim que a solicitação é enviada com sucesso (não faz
// sentido reaparecer preenchido depois de já ter sido enviado).
export function salvarRascunho(chave, dados) {
  try {
    localStorage.setItem(chave, JSON.stringify(dados));
  } catch (err) {
    console.error(`Falha ao salvar rascunho (${chave}):`, err.message);
  }
}

export function carregarRascunho(chave) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : null;
  } catch (err) {
    console.error(`Falha ao carregar rascunho (${chave}):`, err.message);
    return null;
  }
}

export function limparRascunho(chave) {
  try {
    localStorage.removeItem(chave);
  } catch (err) {
    console.error(`Falha ao limpar rascunho (${chave}):`, err.message);
  }
}

// Restaura a escolha de um pill-group SIMULANDO O CLIQUE (em vez de mexer
// direto na variável interna de cada grupo) — assim os efeitos colaterais que
// o clique real dispara (aplicarTrava, mostrar/esconder bloco condicional,
// reconsultar datas sugeridas etc.) acontecem exatamente como se a pessoa
// tivesse clicado, sem duplicar essa lógica aqui.
export function clicarPill(container, groupId, valor) {
  if (!valor) return;
  const grupo = container.querySelector(`#${groupId}`);
  const pill = grupo?.querySelector(`.pill[data-val="${valor}"]`);
  if (pill && !pill.classList.contains('selected')) {
    pill.dispatchEvent(new Event('click', { bubbles: true }));
  }
}

// Preenche `<input>`/`<select>`/`<textarea>` por id — usado pros campos de
// texto simples de cada formulário.
export function preencherCampos(container, mapa) {
  Object.entries(mapa).forEach(([id, val]) => {
    if (val === null || val === undefined || val === '') return;
    const el = container.querySelector(`#${id}`);
    if (el) el.value = val;
  });
}

// Preenche os campos de endereço (data-endereco="prefix-campo") de
// utils/endereco.js a partir do objeto que coletarEndereco() devolve.
export function preencherEndereco(container, prefix, endereco) {
  if (!endereco) return;
  Object.entries(endereco).forEach(([campo, val]) => {
    if (!val) return;
    const el = container.querySelector(`[data-endereco="${prefix}-${campo}"]`);
    if (el) el.value = val;
  });
}
