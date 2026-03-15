export function resolveBufferMinutes(bufferMinutes?: number | null) {
  if (bufferMinutes == null || Number.isNaN(bufferMinutes) || bufferMinutes < 0) {
    return 0;
  }

  return bufferMinutes;
}

export function getAppointmentTotalMinutes(
  serviceDuration: number,
  bufferMinutes: number,
) {
  return serviceDuration + bufferMinutes;
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function rangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
) {
  return startA < endB && endA > startB;
}