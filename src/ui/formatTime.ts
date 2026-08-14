export function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
}
