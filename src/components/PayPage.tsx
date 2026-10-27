import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  parseRoute,
  getManifest,
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
        <a href="/create">Create a request</a>
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
              "Paid — settlement transaction details temporarily unavailable.",
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
            ? "Request not found."
            : `RPC / integration error: ${(e as Error).message}`,
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
        <button onClick={() => void refresh()}>Retry</button>
      </section>
    );
  if (!canonical) return <p>Reading public request…</p>;
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
    ? `Paid by ${r.payer}.`
    : wallet.account.toLowerCase() !== r.payer.toLowerCase()
      ? `This request was paid by another wallet: ${r.payer}.`
      : ownAttempt
        ? "Your payment is complete."
        : "This request was paid by your wallet.";
  const blocked =
    op.busy || hasUnresolved(m, id) || wallet.chainId !== m.chainId;
  return (
    <section className="panel detail">
      <p>
        {requestStatusLabel(r.status)} · Request #{id.toString()} ·{" "}
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
        Immutable ordered terms. Final recipient receives any rounding
        remainder. Platform fee: 0 USDC.
      </p>
      <details>
        <summary>On-chain terms</summary>
        <code>Creator: {r.creator}</code>
        <code>Contract: {m.contractAddress}</code>
        <p>Created {new Date(Number(r.createdAt) * 1000).toISOString()}</p>
      </details>
      {r.status === 2 ? (
        <>
          <div className="notice">{attribution}</div>
          <code>Actual payer: {r.payer}</code>
          {evidence ? (
            <div className="notice">
              <strong>Verified settlement</strong>
              <code>{evidence.hash}</code>
              {m.explorerBase && (
                <a
                  href={`${m.explorerBase}/tx/${evidence.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View verified transaction
                </a>
              )}
              <p>
                Actual payment fee: {formatFee18(evidence.fee18)}{" "}
                {m.sharedBalance ? "USDC" : "local test ETH"} (rounded upward
                from gasUsed × effectiveGasPrice).
              </p>
              <p>Paid {new Date(Number(r.paidAt) * 1000).toISOString()}</p>
            </div>
          ) : (
            <div className="notice">
              <span>{evidenceError || "Verifying settlement evidence…"}</span>
              <button onClick={() => void refresh()}>Retry evidence</button>
            </div>
          )}
          <a href={requestUrl(m, id, "receipt")}>Open receipt</a>
        </>
      ) : r.status === 3 ? (
        <div className="notice">This payment request was cancelled.</div>
      ) : receiptOnly ? (
        <div className="notice">
          This request is Open. There is no payment receipt.
          <a href={requestUrl(m, id)}>Open payment request</a>
        </div>
      ) : (
        <>
          <div className="notice">
            <p>
              Request total: {formatUsdc6(r.totalAmount)} USDC. Network fees are
              additional. Any wallet may pay once.
            </p>
            {self > 0n && (
              <>
                <p>
                  Your wallet is also a recipient. You will receive{" "}
                  {formatUsdc6(self)} USDC of this payment.
                </p>
                <p>
                  Amount allocated to other recipients:{" "}
                  {formatUsdc6(r.totalAmount - self)} USDC.
                </p>
                <p>
                  Gross funding and approval still require{" "}
                  {formatUsdc6(r.totalAmount)} USDC.
                </p>
                {op.review?.call.operation === "pay" ? (
                  <p>
                    Net decrease budget:{" "}
                    {m.sharedBalance
                      ? `${formatFee18((r.totalAmount - self) * 1000000000000n + op.review.quote.feeBudget18)} USDC`
                      : `${formatUsdc6(r.totalAmount - self)} USDC plus ${formatFee18(op.review.quote.feeBudget18)} local test ETH`}
                    . Cap, not actual spend.
                  </p>
                ) : (
                  <p>
                    Net wallet change cannot be estimated until network fees are
                    available.
                  </p>
                )}
              </>
            )}
          </div>
          {!wallet.account ? (
            <button onClick={() => void wallet.connect()}>
              Connect wallet to pay
            </button>
          ) : wallet.chainId !== m.chainId ? (
            <p className="notice">
              Switch to {m.chainName} to continue. Public reads remain
              available.
            </p>
          ) : !f ? (
            <p className="notice">
              Allowance / balances unavailable. Retry before signing.
              <button onClick={() => void refresh()}>Retry funds</button>
            </p>
          ) : f.allowance < r.totalAmount ? (
            <>
              <div className="notice">
                Payment fee unavailable until approval is confirmed. You may
                need more USDC to complete payment.
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
                I understand future payment fees are unknown and approval does
                not pay this request.
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
                  Explicitly reset insufficient allowance first. Network fees
                  apply; this is a separate transaction.
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
                  ? "Review allowance reset"
                  : "Review USDC approval"}
              </button>
            </>
          ) : (
            <button
              disabled={blocked}
              onClick={() =>
                void op.prepare(requestIntent(m, "pay", id, r.totalAmount))
              }
            >
              Review payment
            </button>
          )}
          {f && (
            <p>
              Token balance: {formatUsdc6(f.balance6)} USDC · Native balance (18
              decimals): {f.native18.toString()}.{" "}
              {m.sharedBalance
                ? "Two views of one balance; never added."
                : "LOCAL MOCK: token principal and test ETH gas are separate assets."}
            </p>
          )}
          {wallet.account?.toLowerCase() === r.creator.toLowerCase() && (
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
              Cancel request
            </button>
          )}
        </>
      )}
      <Review op={op} />
    </section>
  );
}
