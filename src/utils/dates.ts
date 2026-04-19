/**
 * Yields every YYYY-MM-DD date from start to end (inclusive).
 * If end is omitted, yields only the start date.
 */
export function* dateRange(start: string, end?: string): Generator<string> {
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = end ? new Date(`${end}T12:00:00`) : startDate;

  const current = new Date(startDate);
  while (current <= endDate) {
    yield current.toISOString().slice(0, 10);
    current.setDate(current.getDate() + 1);
  }
}

/** Format minutes into "Xh YYm" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
