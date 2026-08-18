const HORA_INICIO_EXPEDIENTE = 8;
const HORA_FIM_EXPEDIENTE = 18;

function ehFimDeSemana(data) {
  const dia = data.getDay();
  return dia === 0 || dia === 6;
}

function proximoInicioExpediente(data) {
  const d = new Date(data);
  if (d.getHours() >= HORA_FIM_EXPEDIENTE) {
    d.setDate(d.getDate() + 1);
    d.setHours(HORA_INICIO_EXPEDIENTE, 0, 0, 0);
  } else if (d.getHours() < HORA_INICIO_EXPEDIENTE) {
    d.setHours(HORA_INICIO_EXPEDIENTE, 0, 0, 0);
  }
  while (ehFimDeSemana(d)) {
    d.setDate(d.getDate() + 1);
    d.setHours(HORA_INICIO_EXPEDIENTE, 0, 0, 0);
  }
  return d;
}

const MS_POR_HORA = 60 * 60 * 1000;

/**
 * Soma horas úteis (expediente 08h-18h, seg-sex) a uma data base.
 * @param {Date} dataBase
 * @param {number} horasUteis
 * @returns {Date}
 */
export function calcularSlaUteis(dataBase, horasUteis) {
  let atual = proximoInicioExpediente(dataBase);
  let msRestantes = horasUteis * MS_POR_HORA;

  while (msRestantes > 0) {
    const fimDoDia = new Date(atual);
    fimDoDia.setHours(HORA_FIM_EXPEDIENTE, 0, 0, 0);

    const msDisponiveisHoje = fimDoDia.getTime() - atual.getTime();
    const msAUsar = Math.min(msRestantes, msDisponiveisHoje);

    atual = new Date(atual.getTime() + msAUsar);
    msRestantes -= msAUsar;

    if (msRestantes > 0) {
      atual.setDate(atual.getDate() + 1);
      atual.setHours(HORA_INICIO_EXPEDIENTE, 0, 0, 0);
      while (ehFimDeSemana(atual)) {
        atual.setDate(atual.getDate() + 1);
      }
    }
  }

  return atual;
}
