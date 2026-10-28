import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { getManifest, publicClientFor, requestUrl, operationAllowed } from "@/lib/manifest";
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
        throw Error("Stale RPC is behind the scanned history head. 重试.");
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
      setMessage("付款链接已复制。");
    } catch {
      setMessage(`复制失败，请选择并复制： ${url}`);
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
      <h2>我创建的请求</h2>
      <button
        disabled={!wallet.account || !m.isDeployed}
        onClick={() => void scan()}
      >
        刷新历史
      </button>
      <p>
        {!wallet.account
          ? "连接钱包后查询该钱包创建的请求。"
          : state === "complete"
            ? rows.length
              ? "历史读取完成。"
              : "当前网络未找到此钱包创建的请求。"
            : state === "loading"
              ? "正在读取公开历史…"
              : state === "partial"
                ? "仅取得部分结果，有些历史或请求状态尚不可用。"
                : state === "unconfigured"
                  ? "部署尚未配置。"
                  : "History error. 重试; this is not an empty list."}
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
            #{row.id.toString()} · {m.chainName} · 创建时间 at block{" "}
            {row.block.toString()}
          </p>
          {!row.stale && row.request?.status === 2 && (
            <code>实际付款人： {row.request.payer}</code>
          )}
          <a href={requestUrl(m, row.id)}>打开请求</a>
          <button onClick={() => void copy(row.id)}>复制链接</button>
          {!row.stale && row.request?.status === 2 && (
            <a href={requestUrl(m, row.id, "receipt")}>查看收据</a>
          )}
          {operationAllowed(m, "cancel") && !row.stale &&
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
