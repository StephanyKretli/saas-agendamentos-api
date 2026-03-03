export function parseLocalISO(input: string): Date {
  // remove timezone se vier (Z ou +hh:mm)
  const clean = input.replace(/Z|[+-]\d{2}:\d{2}$/, "");

  // clean: "YYYY-MM-DDTHH:mm:ss(.sss)" ou "YYYY-MM-DDTHH:mm"
  const [datePart, timePart = "00:00:00"] = clean.split("T");
  const [y, m, d] = datePart.split("-").map(Number);

  const [hh = 0, mm = 0, ss = 0] = timePart.split(":").map(Number);

  // cria Date no horário local do servidor
  return new Date(y, (m - 1), d, hh, mm, ss, 0);
}