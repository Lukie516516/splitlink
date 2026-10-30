import { userMessage } from "@/lib/messages";
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
        <a href="/create">Create a split request</a>
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
  const reading = useRef(false), nextReadAt = useRef(0), preparing = useRef(false);
  async function refresh() {
    if (key !== context.current || reading.current || Date.now() < nextReadAt.current) return;
    reading.current = true;
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
              "The request is paid onchain, but transaction details are not yet verified.",
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
      nextReadAt.current = Date.now() + (/rate limit|defined limit|429/i.test(String(e)) ? 60000 : 10000);
      if (gen === generation.current) {
        setCanonical(null);
        setLoadError(
          /RequestNotFound/.test(String(e))
            ? "Request not found."
            : userMessage(e),
        );
      }
    } finally { reading.current = false; }
  }
  useEffect(() => {
    nextReadAt.current = 0;
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
      if (running || preparing.current || document.visibilityState === "hidden") return;
      running = true;
      try {
        await refresh();
      } finally {
        running = false;
      }
    };
    const timer = setInterval(tick, 30000);

    return () => {
      clearInterval(timer);

    };
  }, [key]);
  const op = useOperation(m, refresh);
  preparing.current = op.busy;
  if (loadError)
    return (
      <section className="panel">
        <h1>{loadError}</h1>
        <button onClick={() => void refresh()}>Retry</button>
      </section>
    );
  if (!canonical) return <p>Loading public onchain request…</p>;
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
    ? `This request was paid by ${r.payer}.`
    : wallet.account.toLowerCase() !== r.payer.toLowerCase()
      ? `Another wallet paid this request: ${r.payer}.`
      : ownAttempt
        ? "Your payment is complete."
        : "Your wallet has paid this request.";
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
        Recipient order and shares are fixed after creation. The rounding remainder goes to the final recipient. No platform fee.
      </p>
      <details>
        <summary>Onchain terms</summary>
        <code>Creator: {r.creator}</code>
        <code>Contract: {m.contractAddress}</code>
        <p>Created {new Date(Number(r.createdAt) * 1000).toISOString()}</p>
      </details>
      {r.status === 2 ? (
        <>
          <div className="notice">{attribution}</div>
          <code>Payer: {r.payer}</code>
          {evidence ? (
            <div className="notice">
              <strong>Payment and distribution events verified</strong>
              <p>This is onchain payment evidence, not full test acceptance. Attribution of shared-balance changes within a block requires separate evidence.</p>
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
                Actual payment gas fee: {formatFee18(evidence.fee18)}{" "}
                {m.sharedBalance ? "USDC" : "local test ETH"} (gasUsed × effectiveGasPrice, rounded up for display).
              </p>
              <p>Paid {new Date(Number(r.paidAt) * 1000).toISOString()}</p>
            </div>
          ) : (
            <div className="notice">
              <span>{evidenceError || "Verifying payment transaction and events…"}</span>
              <button onClick={() => void refresh()}>Refresh payment evidence</button>
            </div>
          )}
          <a href={requestUrl(m, id, "receipt")}>Open receipt</a>
        </>
      ) : r.status === 3 ? (
        <div className="notice">This request is cancelled and cannot be paid.</div>
      ) : receiptOnly ? (
        <div className="notice">
          This request is still open. No payment receipt exists yet.
          <a href={requestUrl(m, id)}>Open payment request</a>
        </div>
      ) : (
        <>
          <div className="notice">
            <p>
              Request total: {formatUsdc6(r.totalAmount)} USDC, plus network fees. Any wallet may pay. A successful payment cannot be repeated.
            </p>
            {self > 0n && (
              <>
                <p>
                  Your wallet is also a recipient and will receive{" "}
                  {formatUsdc6(self)} USDC as its share.
                </p>
                <p>
                  Allocated to other recipients:{" "}
                  {formatUsdc6(r.totalAmount - self)} USDC.
                </p>
                <p>
                  Balance and allowance must still cover the full total of{" "}
                  {formatUsdc6(r.totalAmount)} USDC.
                </p>
                {op.review?.call.operation === "pay" ? (
                  <p>
                    Estimated maximum net outflow:{" "}
                    {m.sharedBalance
                      ? `${formatFee18((r.totalAmount - self) * 1000000000000n + op.review.quote.feeBudget18)} USDC`
                      : `${formatUsdc6(r.totalAmount - self)} USDC plus ${formatFee18(op.review.quote.feeBudget18)} local test ETH`}
                    . This is a limit, not actual spending.
                  </p>
                ) : (
                  <p>
                    Net wallet change cannot be estimated before network fees are available.
                  </p>
                )}
              </>
            )}
          </div>
          {!wallet.account ? (
            <button onClick={() => void wallet.connect(m).catch(e => alert(e.message))}>
              Connect wallet to pay
            </button>
          ) : wallet.chainId !== m.chainId ? (
            <p className="notice">
              Switch to {m.chainName} to continue. Public reads remain available.
              <button onClick={() => void wallet.switchNetwork(m).catch(e => alert(e.message))}>Switch to {m.chainName}</button>
            </p>
          ) : !f ? (
            <p className="notice">
              Allowance or balance is unavailable. Refresh before signing.
              <button onClick={() => void refresh()}>Refresh balance</button>
            </p>
          ) : f.allowance < r.totalAmount ? (
            <>
              <div className="notice">
                Payment fees can be estimated after approval confirms. Additional USDC may be needed for payment.
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
                I understand payment fees are not yet known and approval does not pay this request.
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
                  Resetting insufficient allowance is a separate transaction with its own network fee.
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
                {op.busy ? "Checking approval and fees…" : m.resetRequired && f.allowance > 0n
                  ? "Preview allowance reset"
                  : "Preview exact approval"}
              </button>
            </>
          ) : (
            <button
              disabled={blocked}
              onClick={() =>
                void op.prepare(requestIntent(m, "pay", id, r.totalAmount))
              }
            >
              {op.busy ? "Checking payment and fees…" : "Preview payment"}
            </button>
          )}
          {f && (
            <p>
              USDC balance: {formatUsdc6(f.balance6)} USDC · Native balance (18 decimals): {f.native18.toString()}.{" "}
              {m.sharedBalance
                ? "Two decimal representations of the same asset. Do not add them together."
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
              Cancel request
            </button>
          )}
        </>
      )}
      <Review op={op} />
    </section>
  );
}
