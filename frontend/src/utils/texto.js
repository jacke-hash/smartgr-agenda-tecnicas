// Compara texto livre digitado pelo vendedor (ex: cidade do endereço) sem se
// importar com maiúsculas/minúsculas, acento ou espaço nas pontas — usado
// pra detectar "isso é Rio Claro" sem exigir digitação exata.
export function normalizarTexto(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
