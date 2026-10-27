import { type ReturnTypeOfOperation } from "./reviewTypes";
import { formatFee18 } from "@/lib/preflight";
export function Review({ op }: { op: ReturnTypeOfOperation }) {
  const r = op.review;
  if (!r)
    return op.message ? (
      <p role="alert" className="notice">
        {op.message}
      </p>
    ) : null;
  return (
    <section className="review" aria-label="Transaction review">
      <h2>Review {r.call.operation}</h2>
      <code>Account: {r.account}</code>
      <code>Target: {r.call.target}</code>
      <p>Value: 0 · Gas limit: {r.quote.gasLimit.toString()}</p>
      <p>
        Maximum current fee budget: {formatFee18(r.quote.feeBudget18)} native
        token (rounded upward). Cap, not actual spend. Quote expires in 30
        seconds.
      </p>
      <details>
        <summary>Exact reviewed calldata</summary>
        <code>{r.call.data}</code>
      </details>
      <button disabled={op.busy} onClick={op.close}>
        Return without signing
      </button>
      <button disabled={op.busy} onClick={() => void op.sign()}>
        {op.busy ? "Waiting for wallet / chain…" : "Sign reviewed transaction"}
      </button>
    </section>
  );
}
