const EXPEDIENTE_INICIO_MIN = 8 * 60 + 30; // 08:30
const EXPEDIENTE_FIM_MIN = 17 * 60 + 30; // 17:30

function ehFimDeSemana(data) {
  const dia = data.getDay();
  return dia === 0 || dia === 6;
}

function minutosDoDia(data) {
  return data.getHours() * 60 + data.getMinutes();
}

function proximoDiaUtil(data) {
  const d = new Date(data);
  d.setDate(d.getDate() + 1);
  while (ehFimDeSemana(d)) d.setDate(d.getDate() + 1);
  return d;
}

function ajustarParaExpediente(dataBase) {
  const d = new Date(dataBase);

  if (ehFimDeSemana(d)) {
    do {
      d.setDate(d.getDate() + 1);
    } while (ehFimDeSemana(d));
    d.setHours(8, 30, 0, 0);
    return d;
  }

  const minutos = minutosDoDia(d);

  if (minutos < EXPEDIENTE_INICIO_MIN) {
    // Antes do expediente, mesmo dia útil: conta como se fosse 08:30 hoje.
    d.setHours(8, 30, 0, 0);
    return d;
  }

  if (minutos >= EXPEDIENTE_FIM_MIN) {
    // Depois do expediente: conta como 08:30 do próximo dia útil.
    const prox = new Date(d);
    do {
      prox.setDate(prox.getDate() + 1);
    } while (ehFimDeSemana(prox));
    prox.setHours(8, 30, 0, 0);
    return prox;
  }

  return d;
}

/**
 * SLA como "dia útil equivalente": expira no mesmo horário de criação
 * (ajustado pra dentro do expediente 08:30-17:30 se necessário), no PRÓXIMO
 * dia útil — não soma mais horas fracionadas de expediente acumuladas ao
 * longo de vários dias.
 * @param {Date} dataBase
 * @returns {Date}
 */
export function calcularProximoDiaUtilEquivalente(dataBase) {
  const referencia = ajustarParaExpediente(dataBase);
  return proximoDiaUtil(referencia);
}
