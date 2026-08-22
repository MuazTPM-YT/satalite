// format elapsed hours to clock time string (pour start 04:00)
export function elapsedToClock(elapsed_h: number): string {
  const totalMinutes = Math.round((4 + elapsed_h) * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
