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
