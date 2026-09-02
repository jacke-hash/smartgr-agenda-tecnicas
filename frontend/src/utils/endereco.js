const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

export function renderEnderecoHTML(prefix) {
  return `
    <div class="field-row">
      <div class="field">
        <label>CEP</label>
        <input type="text" placeholder="00000-000" data-endereco="${prefix}-cep" required />
      </div>
      <div class="field">
        <label>Cidade</label>
        <input type="text" placeholder="Cidade" data-endereco="${prefix}-cidade" required />
      </div>
    </div>
    <div class="field-row">
      <div class="field" style="grid-column:span 2;">
        <label>Rua / Logradouro</label>
        <input type="text" placeholder="Nome da rua" data-endereco="${prefix}-rua" required />
      </div>
    </div>
    <div class="field-row triple">
      <div class="field">
        <label>Número</label>
        <input type="text" placeholder="Nº" data-endereco="${prefix}-numero" required />
      </div>
      <div class="field">
        <label>Bairro</label>
        <input type="text" placeholder="Bairro" data-endereco="${prefix}-bairro" required />
      </div>
      <div class="field">
        <label>UF</label>
        <select data-endereco="${prefix}-uf" required>
          <option value="">UF</option>
          ${UFS.map((uf) => `<option value="${uf}">${uf}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field-row single">
      <div class="field">
        <label>Complemento (opcional)</label>
        <input type="text" placeholder="Sala, ponto de referência, etc." data-endereco="${prefix}-complemento" />
      </div>
    </div>
  `;
}

// Busca rua/bairro/cidade/UF pelo CEP (ViaCEP, pública, sem chave) assim que
// o campo perde o foco — só preenche automaticamente o que o Google/usuário
// não digita facilmente; número e complemento continuam manuais (ViaCEP
// nunca devolve isso). CEP não encontrado ou erro de rede: não bloqueia
// nada, os campos continuam editáveis manualmente como sempre foram.
// `aoPreencher` (opcional): chamado depois que a cidade é preenchida (por
// CEP OU digitada manualmente) — quem chama usa isso pra saber quando
// reconsultar datas sugeridas (a prioridade da Vithoria em Rio Claro depende
// da cidade, que só existe depois desse preenchimento).
export function ativarAutoPreenchimentoCep(container, prefix, aoPreencher) {
  const campoCep = container.querySelector(`[data-endereco="${prefix}-cep"]`);
  const campoCidade = container.querySelector(`[data-endereco="${prefix}-cidade"]`);
  if (!campoCep) return;

  campoCep.addEventListener('blur', async () => {
    const cepLimpo = campoCep.value.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;

    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      if (!resp.ok) return;
      const dados = await resp.json();
      if (dados.erro) return;

      const set = (campo, valor) => {
        const el = container.querySelector(`[data-endereco="${prefix}-${campo}"]`);
        if (el && valor) el.value = valor;
      };
      set('rua', dados.logradouro);
      set('bairro', dados.bairro);
      set('cidade', dados.localidade);
      set('uf', dados.uf);

      // ViaCEP nunca devolve número — leva o foco pra lá, próximo campo que
      // realmente precisa de digitação manual.
      container.querySelector(`[data-endereco="${prefix}-numero"]`)?.focus();
      aoPreencher?.();
    } catch (err) {
      console.error('Falha ao buscar CEP:', err);
    }
  });

  // Cidade digitada manualmente (sem passar pelo CEP, ou corrigida depois do
  // autopreenchimento) também precisa disparar o mesmo aviso.
  campoCidade?.addEventListener('blur', () => aoPreencher?.());
}

export function coletarEndereco(container, prefix) {
  const get = (campo) => container.querySelector(`[data-endereco="${prefix}-${campo}"]`)?.value || '';
  return {
    cep: get('cep'),
    rua: get('rua'),
    numero: get('numero'),
    bairro: get('bairro'),
    cidade: get('cidade'),
    uf: get('uf'),
    complemento: get('complemento')
  };
}
