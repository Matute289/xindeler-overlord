export type SseEvent = {
  event: string;
  data: string;
};

/**
 * Parses the raw SSE wire format (`field: value` lines, blank-line-terminated
 * blocks) off a byte stream into `{event, data}` objects. Decoupled from
 * `fetch` — takes a reader directly — so this file has zero Expo/native
 * imports and is testable with a hand-built reader.
 */
export async function* parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const parsed = parseRawEvent(rawEvent);
      if (parsed) yield parsed;
      separatorIndex = buffer.indexOf('\n\n');
    }
  }
}

function parseRawEvent(raw: string): SseEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // blank line / comment (e.g. `: ping`)

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const rawValue = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // Other fields (`id:`, `retry:`) aren't needed by this app — dropped, not an error.
  }

  if (event === null || dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
