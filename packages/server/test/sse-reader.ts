// A small SSE reader for the tests: reads messages from a stream response.

export interface ParsedSseMessage {
  id: string | undefined;
  event: string | undefined;
  data: string;
}

export class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  /** The heartbeat comments that the reader skipped. */
  heartbeats = 0;

  constructor(response: Response) {
    if (response.body === null) {
      throw new Error('The response has no body.');
    }
    this.reader = response.body.getReader();
  }

  /** The next message. Fails after `timeoutMs`. */
  async next(timeoutMs = 5000): Promise<ParsedSseMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end !== -1) {
        const block = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        const event = parseSseBlock(block);
        if (event === undefined) {
          this.heartbeats++;
          continue;
        }
        return event;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error('No SSE message in time.');
      }
      let timer: NodeJS.Timeout | undefined;
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('No SSE message in time.')), left);
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) {
        throw new Error('The stream ended.');
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  /** The data of the next `count` messages, parsed as JSON. */
  async json<T = unknown>(count: number, timeoutMs?: number): Promise<T[]> {
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      result.push(JSON.parse((await this.next(timeoutMs)).data) as T);
    }
    return result;
  }

  async close() {
    await this.reader.cancel();
  }
}

// One SSE block. Returns undefined for a block with only comments.
const parseSseBlock = (block: string): ParsedSseMessage | undefined => {
  let id: string | undefined;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') {
      id = value;
    } else if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      data.push(value);
    }
  }
  if (id === undefined && event === undefined && data.length === 0) {
    return undefined;
  }
  return { id, event, data: data.join('\n') };
};
