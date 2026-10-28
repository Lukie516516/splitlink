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
  return (
    <section className="activity">
      <h2>本机交易恢复</h2>
      <p>
        仅按原链只读恢复，不自动签名或重发；交易结果与请求状态分别核验。
      </p>
      {store.warning && (
        <p role="alert" className="error">
          {store.warning}
        </p>
      )}
      {!store.records.length ? (
        <p>本机尚无交易尝试记录。</p>
      ) : (
        <>
          <button onClick={() => void recover()} disabled={running}>
            只读恢复
          </button>
          {store.records.map((r) => (
            <article key={r.recordId}>
              <strong>
                {r.operationType} · {r.txState}
              </strong>
              <p>
                业务核验： {r.businessVerification} · 原链： {r.chainId}
              </p>
              <code>原钱包： {r.account}</code>
              {r.effectiveTxHash && (
                <code>交易哈希： {r.effectiveTxHash}</code>
              )}
              {r.actualFee18 && (
                <p>
                  实际 gas 费： {formatFee18(BigInt(r.actualFee18))} 原生资产（按实际 gas 用量与价格向上取整显示）
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
                    打开已核实创建的请求 #{r.requestId}
                  </a>
                )}
              {r.txState === "unknown" && <p>结果未决：只读恢复，不会自动重签或重发。不要清除存储来重复提交。</p>}
              {r.dismissedAtMs && (
                <p>重试 guard dismissed. Outcome remains {r.txState}.</p>
              )}
              {["unknown", "submitted"].includes(r.txState) &&
                Date.now() - r.createdAtMs > 120000 && (
                  <p>
                    结果仍未决，时间或 nonce 推进不能证明成功或失败，请检查钱包历史。
                  </p>
                )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
