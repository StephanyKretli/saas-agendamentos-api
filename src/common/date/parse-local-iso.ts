export function parseLocalISO(value: string): Date {
  const normalized = value.trim().replace(/(Z|[+-]\d{2}:\d{2})$/, "");

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);

  if (!match) {
    return new Date(NaN);
  }

  const [, year, month, day, hour, minute, second = "00"] = match;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );
}