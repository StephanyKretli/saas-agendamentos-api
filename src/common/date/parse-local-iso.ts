export function parseLocalISO(value: string): Date {
  const [datePart, timePart] = value.split('T')

  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second = '0'] = (timePart || '00:00:00').split(':')

  return new Date(
    year,
    month - 1,
    day,
    Number(hour),
    Number(minute),
    Number(second),
  )
}

export function startOfDayLocal(date: string): Date {
  return parseLocalISO(`${date}T00:00:00`)
}

export function endOfDayLocal(date: string): Date {
  const d = parseLocalISO(`${date}T00:00:00`)
  d.setHours(23, 59, 59, 999)
  return d
}