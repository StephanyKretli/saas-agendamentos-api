// Datas no fuso de Brasília, independentes do TZ do processo.
//
// O container roda em UTC (docker-compose.yaml não define TZ). Entre 21h e 24h
// de Brasília já é o dia seguinte em UTC, então `new Date().toISOString()`
// devolve a data errada — e um `.setDate(getDate() + 1)` em cima disso pula
// dois dias. Isto quebra `nextDueDate` do Asaas.

const BR_TZ = 'America/Sao_Paulo';

// 'en-CA' formata como YYYY-MM-DD; o `timeZone` é o que faz o corte de dia
// acontecer no relógio de Brasília, não no do servidor.
const brDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: BR_TZ });

/** Data (YYYY-MM-DD) de `when` no fuso de Brasília. Default: agora. */
export function brDateString(when: Date = new Date()): string {
  return brDateFormatter.format(when);
}

/**
 * Data (YYYY-MM-DD) daqui a `days` dias, no fuso de Brasília.
 * O Brasil não tem mais horário de verão, então somar 24h por dia é seguro.
 */
export function brDateStringPlusDays(days: number, from: Date = new Date()): string {
  return brDateString(new Date(from.getTime() + days * 24 * 60 * 60 * 1000));
}
