import { brDateString, brDateStringPlusDays } from './br-date';

describe('br-date — datas no fuso de Brasília', () => {
  it('brDateString: 22h BRT (= 01h UTC do dia seguinte) ainda devolve o dia BRT, não o UTC', () => {
    // 2026-03-10 22:00 BRT === 2026-03-11 01:00 UTC
    const instante = new Date('2026-03-11T01:00:00.000Z');
    expect(brDateString(instante)).toBe('2026-03-10');
  });

  it('brDateStringPlusDays(1) às 22h BRT: amanhã é 11, NÃO 12 (o bug do UTC pulava um dia)', () => {
    const instante = new Date('2026-03-11T01:00:00.000Z'); // 10/03 22:00 BRT
    expect(brDateStringPlusDays(1, instante)).toBe('2026-03-11');

    // referência do bug antigo: Date nativo + setDate(+1) + toISOString em UTC
    const bugado = new Date(instante);
    bugado.setDate(bugado.getDate() + 1);
    expect(bugado.toISOString().split('T')[0]).toBe('2026-03-12'); // pulou
  });

  it('brDateString: meio-dia BRT devolve o mesmo dia', () => {
    expect(brDateString(new Date('2026-03-10T15:00:00.000Z'))).toBe('2026-03-10'); // 12:00 BRT
  });

  it('formato é sempre YYYY-MM-DD', () => {
    expect(brDateString(new Date('2026-01-05T12:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
