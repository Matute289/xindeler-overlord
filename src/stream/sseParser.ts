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
  // A `\r` at the very end of one decoded chunk and a `\n` at the start of the
  // next form a single CRLF line terminator, but they arrive in separate
  // `read()` calls — normalizing each chunk in isolation would treat the lone
  // trailing `\r` as its own terminator and then see the next chunk's `\n` as
  // a second one, splitting one record into two. Hold the trailing `\r` back
  // and prepend it to the next chunk before normalizing so it's never judged
  // in isolation.
  let pendingCr = false;

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        // A stream that ends right after a lone trailing `\r` still terminated
        // that line — flush it rather than silently dropping it. Still run the
        // extraction below on the flushed buffer: this can complete a final
        // event's `\n\n` terminator that no earlier chunk had a chance to see.
        if (pendingCr) buffer += '\n';
        yield* drainCompleteEvents();
        return;
      }
      // The SSE wire format (WHATWG spec) allows CRLF, LF, or bare CR as line
      // terminators — normalize to LF right after decoding so the `\n\n` block
      // separator below matches regardless of what the server/proxy emits.
      let text = decoder.decode(value, { stream: true });
      if (pendingCr) {
        text = `\r${text}`;
        pendingCr = false;
      }
      if (text.endsWith('\r')) {
        pendingCr = true;
        text = text.slice(0, -1);
      }
      buffer += text.replace(/\r\n|\r/g, '\n');

      yield* drainCompleteEvents();
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  function* drainCompleteEvents(): Generator<SseEvent> {
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
