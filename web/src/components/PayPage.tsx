import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  parseRoute,
  getManifest,
  operationAllowed,
  requestUrl,
  type NetworkManifest,
} from "@/lib/manifest";
import {
  readCanonical,
  settlementEvidence,
  funds,
  approvalIntent,
  requestIntent,
} from "@/lib/runner";
import { formatUsdc6, requestStatusLabel } from "@/lib/splitlink";
import { formatFee18 } from "@/lib/preflight";
import { useWallet } from "@/hooks/useWallet";
import { useOperation } from "@/hooks/useOperation";
import { Allocation } from "./CreatePage";
import { Review } from "./Review";
import { hasUnresolved, useJournal } from "./TransactionActivity";
export function PayPage({ receiptOnly = false }: { receiptOnly?: boolean }) {
  const params = useParams();
  let error = "";
  let route: { m: NetworkManifest; id: bigint } | null = null;
  try {
    route = parseRoute(
      params.chainId,
      params.contractAddress,
      params.requestId,
    );
  } catch (e) {
    error = (e as Error).message;
  }
  if (!route)
    return (
      <section className="panel">
        <h1>{error}</h1>
        <a href="/create">创建分账请求</a>
      </section>
    );
  return (
    <RequestView
      key={`${route.m.chainId}/${route.m.contractAddress}/${route.id}`}
      {...route}
      receiptOnly={receiptOnly}
    />
  );
}
function RequestView({
  m,
  id,
  receiptOnly,
}: {
  m: NetworkManifest;
  id: bigint;
  receiptOnly: boolean;
}) {
  const wallet = useWallet(),
    store = useJournal();
  const [canonical, setCanonical] = useState<Awaited<
      ReturnType<typeof readCanonical>
    > | null>(null),
    [loadError, setLoadError] = useState(""),
    [evidence, setEvidence] = useState<Awaited<
      ReturnType<typeof settlementEvidence>
    > | null>(null),
    [evidenceError, setEvidenceError] = useState(""),
    [f, setFunds] = useState<Awaited<ReturnType<typeof funds>> | null>(null),
    [ack, setAck] = useState(false),
    [resetAck, setResetAck] = useState(false);
  const minimumBlock = useRef(0n);
  const generation = useRef(0),
    context = useRef("");
  const key = `${wallet.account}/${wallet.chainId}/${wallet.generation}`;
  context.current = key;
  async function refresh() {
    if (key !== context.current) return;
    const gen = ++generation.current;
    try {
      const result = await readCanonical(m, id, minimumBlock.current);
      if (gen !== generation.current || key !== context.current) return;
      minimumBlock.current = result.block;
      setCanonical(result);
      setLoadError("");
      if (result.request.status === 2) {
        try {
          const proof = await settlementEvidence(m, id);
          if (gen === generation.current) {
            setEvidence(proof);
            setEvidenceError("");
          }
        } catch {
          if (gen === generation.current) {
            setEvidence(null);
            setEvidenceError(
              "链上状态为已付款，但交易细节暂未完成核验。",
            );
          }
        }
      }
      if (wallet.account) {
        try {
          const result = await funds(m, wallet.account);
          if (gen === generation.current && key === context.current)
            setFunds(result);
        } catch {
          if (gen === generation.current) setFunds(null);
        }
      }
    } catch (e) {
      if (gen === generation.current) {
        setCanonical(null);
        setLoadError(
          /RequestNotFound/.test(String(e))
            ? "未找到请求。"
            : `链上读取或身份校验失败： ${(e as Error).message}`,
        );
      }
    }
  }
  useEffect(() => {
    setCanonical(null);
    setEvidence(null);
    setFunds(null);
    setAck(false);
    setResetAck(false);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [key]);
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        await refresh();
      } finally {
        running = false;
      }
    };
    const timer = setInterval(tick, 5000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [key]);
  const op = useOperation(m, refresh);
  if (loadError)
    return (
      <section className="panel">
        <h1>{loadError}</h1>
        <button onClick={() => void refresh()}>重试</button>
      </section>
    );
  if (!canonical) return <p>正在读取公开链上请求…</p>;
  const { request: r, allocations } = canonical;
  const self = wallet.account
    ? r.recipients.reduce(
        (n, a, i) =>
          n +
          (a.toLowerCase() === wallet.account!.toLowerCase()
            ? allocations[i]
            : 0n),
        0n,
      )
    : 0n;
  const ownAttempt =
    evidence &&
    store.records.find(
      (a) =>
        a.operationType === "pay" &&
        a.effectiveTxHash === evidence.hash &&
        a.businessVerification === "verified" &&
        a.account.toLowerCase() === r.payer.toLowerCase(),
    );
  const attribution = !wallet.account
    ? `此请求由 ${r.payer} 付款。`
    : wallet.account.toLowerCase() !== r.payer.toLowerCase()
      ? `此请求由其他钱包付款：${r.payer}。`
      : ownAttempt
        ? "你的付款已完成。"
        : "此请求已由你的钱包付款。";
  const blocked =
    op.busy || hasUnresolved(m, id) || wallet.chainId !== m.chainId;
  return (
    <section className="panel detail">
      <p>
        {requestStatusLabel(r.status)} · 请求 #{id.toString()} ·{" "}
        {m.chainName}
      </p>
      <h1>{r.title}</h1>
      <div className="amount">{formatUsdc6(r.totalAmount)} USDC</div>
      <Allocation
        recipients={r.recipients}
        shares={r.sharesBps}
        amounts={allocations}
      />
      <p>
        收款人顺序与份额创建后不可更改，最小单位余数归最后一位。平台手续费为 0。
      </p>
      <details>
        <summary>链上条款</summary>
        <code>创建人： {r.creator}</code>
        <code>合约： {m.contractAddress}</code>
        <p>创建时间 {new Date(Number(r.createdAt) * 1000).toISOString()}</p>
      </details>
      {r.status === 2 ? (
        <>
          <div className="notice">{attribution}</div>
          <code>实际付款人： {r.payer}</code>
          {evidence ? (
            <div className="notice">
              <strong>付款交易与分配事件已核实</strong>
              <p>这是链上付款证明；不代表全部测试场景已验收。共享余额的同块归因仍需独立证据。</p>
              <code>{evidence.hash}</code>
              {m.explorerBase && (
                <a
                  href={`${m.explorerBase}/tx/${evidence.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看已核实交易
                </a>
              )}
              <p>
                实际付款 gas 费： {formatFee18(evidence.fee18)}{" "}
                {m.sharedBalance ? "USDC" : "local test ETH"} （按 gasUsed × effectiveGasPrice 向上取整显示）。
              </p>
              <p>付款时间 {new Date(Number(r.paidAt) * 1000).toISOString()}</p>
            </div>
          ) : (
            <div className="notice">
              <span>{evidenceError || "正在核验付款交易与事件…"}</span>
              <button onClick={() => void refresh()}>重读付款证据</button>
            </div>
          )}
          <a href={requestUrl(m, id, "receipt")}>打开收据</a>
        </>
      ) : r.status === 3 ? (
        <div className="notice">此请求已取消，不能继续付款。</div>
      ) : receiptOnly ? (
        <div className="notice">
          此请求仍可付款，尚无付款收据。
          <a href={requestUrl(m, id)}>打开付款请求</a>
        </div>
      ) : (
        <>
          <div className="notice">
            <p>
              请求总额： {formatUsdc6(r.totalAmount)} USDC，网络费另计。任意钱包可支付，成功后不能再次支付。
            </p>
            {self > 0n && (
              <>
                <p>
                  你的钱包也是收款人，将收到{" "}
                  {formatUsdc6(self)} USDC 的分配份额。
                </p>
                <p>
                  分配给其他收款人：{" "}
                  {formatUsdc6(r.totalAmount - self)} USDC.
                </p>
                <p>
                  余额和授权仍需覆盖完整总额{" "}
                  {formatUsdc6(r.totalAmount)} USDC.
                </p>
                {op.review?.call.operation === "pay" ? (
                  <p>
                    预计净减少预算：{" "}
                    {m.sharedBalance
                      ? `${formatFee18((r.totalAmount - self) * 1000000000000n + op.review.quote.feeBudget18)} USDC`
                      : `${formatUsdc6(r.totalAmount - self)} USDC plus ${formatFee18(op.review.quote.feeBudget18)} local test ETH`}
                    . 这是上限，不是实际支出。
                  </p>
                ) : (
                  <p>
                    网络费未取得前，无法估算钱包净变化。
                  </p>
                )}
              </>
            )}
          </div>
          {!wallet.account ? (
            <button onClick={() => void wallet.connect(m).catch(e => alert(e.message))}>
              连接钱包以付款
            </button>
          ) : wallet.chainId !== m.chainId ? (
            <p className="notice">
              请切换至 {m.chainName} 后继续。 公开查询仍可使用。
              <button onClick={() => void wallet.switchNetwork(m).catch(e => alert(e.message))}>切换至 {m.chainName}</button>
            </p>
          ) : !f ? (
            <p className="notice">
              授权或余额暂不可用，请重新读取后再签名。
              <button onClick={() => void refresh()}>重新读取余额</button>
            </p>
          ) : f.allowance < r.totalAmount ? (
            <>
              <div className="notice">
                授权确认后才能估算付款费用。完成付款可能还需要更多 USDC。
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => {
                    setAck(e.target.checked);
                    op.invalidate();
                  }}
                />
                我理解下一笔付款费用尚未知，授权不会支付此请求。
              </label>
              {m.resetRequired && f.allowance > 0n && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={resetAck}
                    onChange={(e) => {
                      setResetAck(e.target.checked);
                      op.invalidate();
                    }}
                  />
                  单独重置不足的授权额度，需要另付网络费。
                </label>
              )}
              <button
                disabled={
                  blocked ||
                  !ack ||
                  (m.resetRequired && f.allowance > 0n && !resetAck)
                }
                onClick={() =>
                  void op.prepare(
                    approvalIntent(
                      m,
                      id,
                      r.totalAmount,
                      !!m.resetRequired && f.allowance > 0n,
                    ),
                  )
                }
              >
                {m.resetRequired && f.allowance > 0n
                  ? "预览授权重置"
                  : "预览准确授权"}
              </button>
            </>
          ) : (
            <button
              disabled={blocked}
              onClick={() =>
                void op.prepare(requestIntent(m, "pay", id, r.totalAmount))
              }
            >
              预览本次付款
            </button>
          )}
          {f && (
            <p>
              USDC 余额： {formatUsdc6(f.balance6)} USDC · 原生余额（18 位）： {f.native18.toString()}.{" "}
              {m.sharedBalance
                ? "同一资产的两种精度，不相加。"
                : "LOCAL MOCK: token principal and test ETH gas are separate assets."}
            </p>
          )}
          {operationAllowed(m, "cancel") && wallet.account?.toLowerCase() === r.creator.toLowerCase() && (
            <button
              disabled={blocked}
              onClick={() => {
                if (
                  confirm(
                    `Cancel this payment request? It cannot be paid after cancellation. Network fees apply. Existing USDC approvals are not revoked.\n${r.title}\n${formatUsdc6(r.totalAmount)} USDC\nRequest ${id}\n${m.chainName}\n${m.contractAddress}`,
                  )
                )
                  void op.prepare(requestIntent(m, "cancel", id));
              }}
            >
              取消请求
            </button>
          )}
        </>
      )}
      <Review op={op} />
    </section>
  );
}
