const MS_POR_HORA = 60 * 60 * 1000;

/**
 * SLA como 24h corridas a partir da criação — sem lógica de expediente/dia
 * útil, soma direto o intervalo.
 * @param {Date} dataBase
 * @returns {Date}
 */
export function calcularSlaExpiraEm(dataBase, horas = 24) {
  return new Date(dataBase.getTime() + horas * MS_POR_HORA);
}
