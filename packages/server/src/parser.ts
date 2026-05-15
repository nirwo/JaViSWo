export type ParseErrorHandler = (err: unknown, line: string) => void;

export class NdjsonParser {
  private buf = '';
  constructor(private readonly onError: ParseErrorHandler = () => {}) {}

  feed(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        out.push(JSON.parse(line));
      } catch (err) {
        this.onError(err, line);
      }
    }
    return out;
  }

  /** Drain any trailing partial line (call when the stream closes). */
  flush(): unknown[] {
    const tail = this.buf.trim();
    this.buf = '';
    if (tail.length === 0) return [];
    try {
      return [JSON.parse(tail)];
    } catch (err) {
      this.onError(err, tail);
      return [];
    }
  }
}
