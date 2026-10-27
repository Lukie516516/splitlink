import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { getManifest, publicClientFor, requestUrl } from "@/lib/manifest";
import { HistoryCursor, creatorLogs, boundedMap } from "@/lib/history";
import { readCanonical, requestIntent } from "@/lib/runner";
import {
  requestStatusLabel,
  formatUsdc6,
  type OnChainRequest,
} from "@/lib/splitlink";
import { useWallet } from "@/hooks/useWallet";
import { useOperation } from "@/hooks/useOperation";
import { Review } from "./Review";
import { hasUnresolved, useJournal } from "./TransactionActivity";
type Item = { id: bigint; block: bigint; tx: number; log: number };
type Row = Item & { request?: OnChainRequest; error?: string; stale?: boolean };
export function MyRequests({ revision }: { revision: number }) {
  const m = getManifest(),
    wallet = useWallet();
  useJournal();
  const [rows, setRows] = useState<Row[]>([]),
    [state, setState] = useState("disconnected"),
    [message, setMessage] = useState("");
  const generation = useRef(0),
    scanQueue = useRef<Promise<void>>(Promise.resolve()),
    cursor = useRef<HistoryCursor<Item> | null>(null),
    context = useRef("");
  const key = `${wallet.account}/${wallet.chainId}/${m.chainId}/${m.contractAddress}`;
  context.current = key;
  // All initial/revision/manual/focus/timer paths share this context queue,
  // including the head read, cursor commit, bounded row reads and UI result.
  function scan() {
    const result = scanQueue.current.then(() => scanOnce());
    scanQueue.current = result.catch(() => undefined);
    return result;
  }
  async function scanOnce() {
    if (context.current !== key) return;
    const gen = ++generation.current;
    if (!wallet.account || !m.isDeployed) {
      setRows([]);
      setState(wallet.account ? "unconfigured" : "disconnected");
      return;
    }
    setState("loading");
    setRows((old) =>
      old.map((r) => ({
        ...r,
        stale: true,
        error: "Refreshing status…",
      })),
    );
    const c = publicClientFor(m),
      account = wallet.account;
    const signal = new AbortController();
    try {
      const head = await c.getBlockNumber({ cacheTime: 0 });
      // Do not let a late head from the old wallet touch the new context's cursor.
      if (gen !== generation.current || key !== context.current) return;
      if (cursor.current && head < cursor.current.head)
        throw Error("Stale RPC is behind the scanned history head. Retry.");
      if (!cursor.current)
        cursor.current = new HistoryCursor(m.deploymentBlock);
      const result = await cursor.current.scan(
        head,
        async (range) =>
          (await creatorLogs(c as any, m, account, range)).map((l) => ({
            id: l.args.requestId!,
            block: l.blockNumber,
            tx: l.transactionIndex,
            log: l.logIndex,
          })),
        (l) => `${l.id}`,
        signal.signal,
      );
      if (gen !== generation.current || key !== context.current) return;
      const found = result.items.sort((a, b) =>
        a.block > b.block
          ? -1
          : a.block < b.block
            ? 1
            : b.tx - a.tx || b.log - a.log,
      );
      const read = await boundedMap(found, async (item): Promise<Row> => {
        try {
          const r = await readCanonical(m, item.id, head, c as any);
          if (r.request.creator.toLowerCase() !== account.toLowerCase())
            throw Error("Creator mismatch.");
          return { ...item, request: r.request };
        } catch (e) {
          return {
            ...item,
            request: rows.find((r) => r.id === item.id)?.request,
            stale: true,
            error: (e as Error).message,
          };
        }
      });
      if (gen !== generation.current || key !== context.current) return;
      const next = read.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      setRows(next);
      setState(
        result.complete && next.every((r) => r.request && !r.stale && !r.error)
          ? "complete"
          : next.length
            ? "partial"
            : "error",
      );
      setMessage(
        result.error ??
          `Snapshot ${result.head}; ${next.length} public requests.`,
      );
    } catch (e) {
      if (gen === generation.current) {
        setState("error");
        setMessage((e as Error).message);
      }
    }
  }
  useEffect(() => {
    generation.current++;
    scanQueue.current = Promise.resolve();
    cursor.current = null;
    setRows([]);
    void scan();
    return () => {
      generation.current++;
    };
  }, [key]);
  useEffect(() => {
    void scan();
  }, [revision]);
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      await scan();
    };
    const timer = setInterval(tick, 15000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [key]);
  const op = useOperation(m, scan);
  async function copy(id: bigint) {
    const url = requestUrl(m, id);
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Payment link copied.");
    } catch {
      setMessage(`Copy failed. Select and copy: ${url}`);
    }
  }
  function cancel(id: bigint, r: OnChainRequest) {
    if (
      confirm(
        `Cancel this payment request? It cannot be paid after cancellation. Network fees apply. Existing USDC approvals are not revoked.\n${r.title}\n${formatUsdc6(r.totalAmount)} USDC\nRequest ${id}\n${m.chainName}\n${m.contractAddress}`,
      )
    )
      void op.prepare(requestIntent(m, "cancel", id));
  }
  return (
    <section className="panel">
      <h2>My requests</h2>
      <button
        disabled={!wallet.account || !m.isDeployed}
        onClick={() => void scan()}
      >
        Refresh history
      </button>
      <p>
        {!wallet.account
          ? "Connect a wallet to discover requests."
          : state === "complete"
            ? rows.length
              ? "History complete."
              : "No requests found on this network."
            : state === "loading"
              ? "Reading public history…"
              : state === "partial"
                ? "Partial results. Some history or request statuses could not be loaded."
                : state === "unconfigured"
                  ? "Deployment not configured."
                  : "History error. Retry; this is not an empty list."}
      </p>
      <p>{message}</p>
      {rows.map((row) => (
        <article className="history-row" key={row.id.toString()}>
          <h3>{row.request?.title ?? `Request #${row.id}`}</h3>
          <p>
            {row.stale
              ? `Refreshing / stale status: ${row.error}`
              : row.request
                ? `${formatUsdc6(row.request.totalAmount)} USDC · ${requestStatusLabel(row.request.status)} · ${new Date(Number(row.request.createdAt) * 1000).toISOString()}`
                : `Status unavailable: ${row.error}`}
          </p>
          <p>
            #{row.id.toString()} · {m.chainName} · Created at block{" "}
            {row.block.toString()}
          </p>
          {!row.stale && row.request?.status === 2 && (
            <code>Actual payer: {row.request.payer}</code>
          )}
          <a href={requestUrl(m, row.id)}>Open request</a>
          <button onClick={() => void copy(row.id)}>Copy link</button>
          {!row.stale && row.request?.status === 2 && (
            <a href={requestUrl(m, row.id, "receipt")}>View receipt</a>
          )}
          {!row.stale &&
            row.request?.status === 1 &&
            wallet.account?.toLowerCase() ===
              row.request.creator.toLowerCase() && (
              <button
                disabled={
                  wallet.chainId !== m.chainId ||
                  op.busy ||
                  hasUnresolved(m, row.id)
                }
                onClick={() => cancel(row.id, row.request!)}
              >
                Cancel
              </button>
            )}
        </article>
      ))}
      <Review op={op} />
    </section>
  );
}
