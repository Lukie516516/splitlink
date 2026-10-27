import { useEffect, useState } from "react";
import { journal, type TransactionRecord } from "@/lib/journal";
import { getSupportedManifest, requestUrl } from "@/lib/manifest";
import { recoverOperation } from "@/lib/runner";
import { formatFee18 } from "@/lib/preflight";
export function useJournal() {
  const [, render] = useState(0);
  useEffect(() => journal().subscribe(() => render((n) => n + 1)), []);
  return journal();
}
export function hasUnresolved(
  m: { chainId: number; contractAddress: string },
  id: bigint | null,
) {
  return journal().records.some(
    (r) =>
      r.chainId === m.chainId &&
      r.contractAddress.toLowerCase() === m.contractAddress.toLowerCase() &&
      r.requestId === (id?.toString() ?? null) &&
      !r.dismissedAtMs &&
      ["unknown", "prepared", "awaitingSignature", "submitted"].includes(
        r.txState,
      ),
  );
}
export function TransactionActivity() {
  const store = useJournal();
  const [running, setRunning] = useState(false);
  async function recover() {
    if (running) return;
    setRunning(true);
    try {
      for (const r of [...store.records]) {
        const m = getSupportedManifest(r.chainId, r.contractAddress);
        if (!m) continue;
        if (
          ["unknown", "submitted"].includes(r.txState) ||
          r.businessVerification === "unavailable"
        )
          await recoverOperation(store, r, m);
      }
    } finally {
      setRunning(false);
    }
  }
  useEffect(() => {
    let active = false;
    const tick = async () => {
      if (active || document.visibilityState === "hidden") return;
      active = true;
      try {
        await recover();
      } finally {
        active = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    const storage = () => {
      store.hydrate();
      void tick();
    };
    window.addEventListener("focus", tick);
    window.addEventListener("storage", storage);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      window.removeEventListener("storage", storage);
    };
  }, []);
  function dismiss(r: TransactionRecord) {
    if (
      confirm(
        "Check wallet activity and fresh request status first. Dismiss only the local retry guard? This does not cancel, fail or resend the transaction. It may still complete.",
      )
    )
      store.patch(r, { dismissedAtMs: Date.now() });
  }
  return (
    <section className="activity">
      <h2>Transaction recovery on this device</h2>
      <p>
        No automatic signatures or resubmissions. Outcomes are tracked on each
        original chain; business status is verified separately.
      </p>
      {store.warning && (
        <p role="alert" className="error">
          {store.warning}
        </p>
      )}
      {!store.records.length ? (
        <p>No local transaction attempts.</p>
      ) : (
        <>
          <button onClick={() => void recover()} disabled={running}>
            Retry recovery
          </button>
          {store.records.map((r) => (
            <article key={r.recordId}>
              <strong>
                {r.operationType} · {r.txState}
              </strong>
              <p>
                Business verification: {r.businessVerification} · Original
                chain: {r.chainId}
              </p>
              <code>Original account: {r.account}</code>
              {r.effectiveTxHash && (
                <code>Attempt hash: {r.effectiveTxHash}</code>
              )}
              {r.actualFee18 && (
                <p>
                  Actual fee: {formatFee18(BigInt(r.actualFee18))} native token
                  (rounded upward from gasUsed × effectiveGasPrice)
                </p>
              )}
              {r.error && <p className="error">{r.error.message}</p>}
              {r.operationType === "create" &&
                r.businessVerification === "verified" &&
                r.requestId &&
                getSupportedManifest(r.chainId, r.contractAddress) && (
                  <a
                    href={requestUrl(
                      getSupportedManifest(r.chainId, r.contractAddress)!,
                      BigInt(r.requestId),
                    )}
                  >
                    Open verified created request #{r.requestId}
                  </a>
                )}
              {r.txState === "unknown" && !r.dismissedAtMs && (
                <button onClick={() => dismiss(r)}>
                  Dismiss after checking wallet activity
                </button>
              )}
              {r.dismissedAtMs && (
                <p>Retry guard dismissed. Outcome remains {r.txState}.</p>
              )}
              {["unknown", "submitted"].includes(r.txState) &&
                Date.now() - r.createdAtMs > 120000 && (
                  <p>
                    Still unresolved. Time and nonce advance do not prove
                    success or failure. Check wallet history.
                  </p>
                )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
