export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Dom, 6=Sáb

export type TimeRange = { start: string; end: string }; // "HH:mm"

export type BusinessHours = Partial<Record<Weekday, TimeRange[]>>;

/**
 * Exemplo:
 * - Seg a Sex: 09:00-18:00 (com almoço 12-13, opcional)
 * - Sáb: 09:00-13:00
 * - Dom: fechado
 */
export const BUSINESS_HOURS: BusinessHours = {
  1: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
  2: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
  3: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
  4: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
  5: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
  6: [{ start: "09:00", end: "13:00" }],
  // 0 (Domingo) não existe => fechado
};

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinBusinessHours(start: Date, durationMinutes: number) {
  const day = start.getDay() as Weekday; // 0=Dom
  const ranges = BUSINESS_HOURS[day];
  if (!ranges || ranges.length === 0) return false;

  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = startMin + durationMinutes;

  return ranges.some((r) => {
    const rStart = toMinutes(r.start);
    const rEnd = toMinutes(r.end);
    return startMin >= rStart && endMin <= rEnd;
  });
}