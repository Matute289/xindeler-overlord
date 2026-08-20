export function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
}

export function formatUnixTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('es-AR', { hour12: false });
}
