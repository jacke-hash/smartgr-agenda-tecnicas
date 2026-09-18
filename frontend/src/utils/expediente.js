// Regras de "horário comercial" pra decidir se uma técnica pode recusar um
// treinamento já aprovado: fim de semana, feriado nacional ou fora de
// 08:30–17:30. Cálculo em UTC direto na string ISO (mesmo padrão de
// frontend/src/pages/escala-tecnicas.js e workers/calendar/src/index.js) —
// dia da semana é propriedade da data civil, não do instante.

const HORA_INICIO_COMERCIAL = '08:30';
const HORA_FIM_COMERCIAL = '17:30';

const FERIADOS_FIXOS = [
  { mes: 1, dia: 1 }, // Confraternização Universal
  { mes: 4, dia: 21 }, // Tiradentes
  { mes: 5, dia: 1 }, // Dia do Trabalho
  { mes: 9, dia: 7 }, // Independência
  { mes: 10, dia: 12 }, // Nossa Senhora Aparecida
  { mes: 11, dia: 2 }, // Finados
  { mes: 11, dia: 15 }, // Proclamação da República
  { mes: 11, dia: 20 }, // Consciência Negra (feriado nacional desde 2023)
  { mes: 12, dia: 25 } // Natal
];

function diaDaSemanaISO(dataISO) {
  return new Date(`${dataISO}T00:00:00Z`).getUTCDay();
}

function somarDiasISO(dataISO, dias) {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Algoritmo de Gauss/Meeus pro domingo de Páscoa — base pros feriados móveis
// (Carnaval, Sexta-feira Santa, Corpus Christi), que dependem dela.
function pascoaISO(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function feriadosDoAno(ano) {
  const pascoa = pascoaISO(ano);
  return [
    ...FERIADOS_FIXOS.map((f) => `${ano}-${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`),
    somarDiasISO(pascoa, -47), // Carnaval (segunda)
    somarDiasISO(pascoa, -46), // Carnaval (terça)
    somarDiasISO(pascoa, -2), // Sexta-feira Santa
    somarDiasISO(pascoa, 60) // Corpus Christi
  ];
}

export function ehFimDeSemana(dataISO) {
  const dia = diaDaSemanaISO(dataISO);
  return dia === 0 || dia === 6;
}

export function ehFeriado(dataISO) {
  if (!dataISO) return false;
  const ano = Number(dataISO.slice(0, 4));
  return feriadosDoAno(ano).includes(dataISO);
}

export function horarioForaComercial(horaInicio, horaFim) {
  return Boolean((horaInicio && horaInicio < HORA_INICIO_COMERCIAL) || (horaFim && horaFim > HORA_FIM_COMERCIAL));
}

// Único: checa a data escolhida. Período: checa início E fim do intervalo —
// qualquer um dos dois caindo em fim de semana/feriado, ou o horário de
// início/término do compromisso passando do expediente, já conta.
export function eventoForaDoExpediente(dataEscolhida, tipoReserva) {
  if (!dataEscolhida) return false;

  if (tipoReserva === 'periodo') {
    const { dataInicio, dataFim, horaInicio, horaTermino } = dataEscolhida;
    return (
      ehFimDeSemana(dataInicio) ||
      ehFimDeSemana(dataFim) ||
      ehFeriado(dataInicio) ||
      ehFeriado(dataFim) ||
      horarioForaComercial(horaInicio, horaTermino)
    );
  }

  const { data, horaInicio, horaTermino } = dataEscolhida;
  return ehFimDeSemana(data) || ehFeriado(data) || horarioForaComercial(horaInicio, horaTermino);
}
