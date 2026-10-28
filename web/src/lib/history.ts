import { type PublicClient, type Address } from "viem";
import { SPLITLINK_ABI } from "./splitlink";
import type { NetworkManifest } from "./manifest";
export type Range = { from: bigint; to: bigint };
export async function scanPages<T>(p: {
  from: bigint;
  to: bigint;
  fetch: (r: Range) => Promise<T[]>;
  key: (t: T) => string;
  page?: bigint;
  retries?: number;
  delay?: (n: number) => Promise<void>;
  signal?: AbortSignal;
  progress?: (r: Range, items: T[]) => void;
}) {
  let end = p.to,
    span = p.page ?? 2000n;
  const items: T[] = [],
    seen = new Set<string>(),
    covered: Range[] = [];
  while (end >= p.from) {
    p.signal?.throwIfAborted();
    const range = {
      from: end - span + 1n > p.from ? end - span + 1n : p.from,
      to: end,
    };
    let data: T[] | null = null,
      last: unknown;
    for (let attempt = 0; attempt <= (p.retries ?? 3); attempt++) {
      try {
        data = await p.fetch(range);
        break;
      } catch (e) {
        last = e;
        if (/range|limit|size|too large/i.test(String(e)) && span > 1n) break;
        if (attempt < (p.retries ?? 3))
          await (p.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
            1000 * 2 ** attempt,
          );
        p.signal?.throwIfAborted();
      }
    }
    if (data === null) {
      if (/range|limit|size|too large/i.test(String(last)) && span > 1n) {
        span = span / 2n;
        continue;
      }
      return {
        items,
        covered,
        complete: false,
        gap: range,
        error: String(last),
      };
    }
    p.signal?.throwIfAborted();
    for (const t of data) {
      const key = p.key(t);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(t);
      }
    }
    covered.push(range);
    p.progress?.(range, data);
    end = range.from - 1n;
  }
  return { items, covered, complete: true, gap: null, error: null };
}
export async function boundedMap<T, R>(
  items: T[],
  fn: (t: T) => Promise<R>,
  limit = 4,
) {
  const result: PromiseSettledResult<R>[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          result[i] = { status: "fulfilled", value: await fn(items[i]) };
        } catch (reason) {
          result[i] = { status: "rejected", reason };
        }
      }
    }),
  );
  return result;
}
export function creatorLogs(
  c: PublicClient,
  m: NetworkManifest,
  account: Address,
  range: Range,
) {
  return c.getContractEvents({
    address: m.contractAddress as Address,
    abi: SPLITLINK_ABI,
    eventName: "RequestCreated",
    args: { creator: account },
    fromBlock: range.from,
    toBlock: range.to,
  });
}
export class HistoryCursor<T> {
  // Construct ranges and commit coverage under one per-cursor FIFO. A caller's
  // post-return generation check cannot protect these shared mutations.
  private scanQueue: Promise<void> = Promise.resolve();
  head: bigint;
  next: bigint;
  items = new Map<string, T>();
  constructor(readonly from: bigint) {
    this.head = from - 1n;
    this.next = from - 1n;
  }
  scan(
    head: bigint,
    fetch: (r: Range) => Promise<T[]>,
    key: (t: T) => string,
    signal?: AbortSignal,
  ) {
    const result = this.scanQueue.then(() => {
      signal?.throwIfAborted();
      return this.scanExclusive(head, fetch, key, signal);
    });
    // Rejection/abort must release the queue for the next explicit retry.
    this.scanQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async scanExclusive(
    head: bigint,
    fetch: (r: Range) => Promise<T[]>,
    key: (t: T) => string,
    signal?: AbortSignal,
  ) {
    const ranges = [];
    if (head > this.head)
      ranges.push({
        from: this.head + 1n > this.from ? this.head + 1n : this.from,
        to: head,
        new: true,
      });
    if (this.next >= this.from)
      ranges.push({ from: this.from, to: this.next, new: false });
    let error: string | null = null;
    for (const range of ranges) {
      const result = await scanPages({
        from: range.from,
        to: range.to,
        fetch,
        key,
        signal,
        progress: (_, items) => {
          for (const t of items) this.items.set(key(t), t);
        },
      });
      if (range.new) {
        this.head = head;
        if (!result.complete)
          this.next = result.gap!.to > this.next ? result.gap!.to : this.next;
      } else this.next = result.complete ? this.from - 1n : result.gap!.to;
      if (!result.complete) {
        error = result.error;
        break;
      }
    }
    return {
      items: [...this.items.values()],
      complete: this.next < this.from,
      error,
      head: this.head,
      gapEnd: this.next,
    };
  }
}
