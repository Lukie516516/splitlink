export type Range = { from: bigint; to: bigint };
export type Scan<T> = {
  items: T[];
  covered: Range[];
  gap: Range | null;
  complete: boolean;
  error?: string;
};
export async function scanLogs<T>(opts: {
  from: bigint;
  to: bigint;
  page?: bigint;
  retries?: number;
  fetch: (r: Range) => Promise<T[]>;
  key: (t: T) => string;
  signal?: AbortSignal;
  delay?: (ms: number) => Promise<void>;
  progress?: (s: Scan<T>) => void;
}): Promise<Scan<T>> {
  const state: Scan<T> = { items: [], covered: [], gap: null, complete: false };
  const seen = new Set<string>();
  let end = opts.to;
  let span = opts.page ?? 2000n;
  while (end >= opts.from) {
    opts.signal?.throwIfAborted();
    const start = end - span + 1n > opts.from ? end - span + 1n : opts.from;
    const range = { from: start, to: end };
    let items: T[] | null = null;
    let last: unknown;
    for (let attempt = 0; attempt <= (opts.retries ?? 3); attempt++) {
      try {
        items = await opts.fetch(range);
        break;
      } catch (e) {
        last = e;
        const message = String(e);
        if (/range|too large|limit|size|too many/i.test(message) && span > 1n)
          break;
        if (attempt < (opts.retries ?? 3))
          await (opts.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
            1000 * 2 ** attempt,
          );
        opts.signal?.throwIfAborted();
      }
    }
    if (items === null) {
      if (
        /range|too large|limit|size|too many/i.test(String(last)) &&
        span > 1n
      ) {
        span = span / 2n || 1n;
        continue;
      }
      state.gap = range;
      state.error = String(last);
      opts.progress?.({ ...state });
      return state;
    }
    opts.signal?.throwIfAborted();
    for (const item of items) {
      const k = opts.key(item);
      if (!seen.has(k)) {
        seen.add(k);
        state.items.push(item);
      }
    }
    state.covered.push(range);
    end = start - 1n;
    opts.progress?.({ ...state });
  }
  state.complete = true;
  return state;
}
export async function boundedMap<T, R>(
  items: T[],
  fn: (t: T) => Promise<R>,
  concurrency = 4,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = { status: "fulfilled", value: await fn(items[i]) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}
export class Generation {
  private value = 0;
  next() {
    return ++this.value;
  }
  current(v: number) {
    return v === this.value;
  }
}
