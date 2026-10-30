import { useEffect, useState } from "react";
import { decodeFunctionData, erc20Abi } from "viem";
import { SPLITLINK_ABI, formatUsdc6 } from "@/lib/splitlink";
import { type ReturnTypeOfOperation } from "./reviewTypes";
import { formatFee18, QUOTE_TTL_MS } from "@/lib/preflight";
const names = { create: "Create request", approve: "Set exact allowance", pay: "Pay split", approveReset: "Reset allowance", cancel: "Cancel request" };
export function Review({ op }: { op: ReturnTypeOfOperation }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const r = op.review;
  if (!r) return op.message ? <p role="alert" aria-live="assertive" className="notice operation-message">{op.message}</p> : null;
  const remaining = Math.max(0, Math.ceil((r.quote.quotedAt + QUOTE_TTL_MS - Date.now()) / 1000));
  const approval = ["approve", "approveReset"].includes(r.call.operation);
  const d = decodeFunctionData({ abi: approval ? erc20Abi : SPLITLINK_ABI, data: r.call.data });
  const args = d.args as readonly unknown[];
  return <section className="review" aria-label="Transaction review">
    <h2>Review: {names[r.call.operation]}</h2>
    <p>{op.manifest.chainName} · {op.manifest.environment === "arc-mainnet" ? "Mainnet USDC · Real funds" : "Test USDC"} · {op.stage === "wallet" ? "Sent to wallet. Confirm in your wallet." : op.stage === "confirming" ? "Broadcast. Waiting for the onchain receipt." : op.stage === "verifying" ? "Receipt received. Verifying transaction identity and split results…" : remaining > 0 ? `Quote valid for ${remaining}s before wallet handoff` : "Quote expired. Refresh to continue."}</p>
    <code>Signing wallet:{r.account}</code><code>Transaction target:{r.call.target}</code>
    {r.call.operation === "create" ? <><p>Public title:{String(args[0])}</p><p>Request total:{formatUsdc6(args[1] as bigint)} USDC (creation does not transfer the payment amount)</p>{(args[2] as readonly string[]).map((a,i)=><code key={a}>Recipient {i+1}：{a} · {Number((args[3] as readonly number[])[i])/100}%</code>)}</> : <p>Request ID:{r.call.requestId?.toString()} · Total {formatUsdc6(r.call.principal6)} USDC</p>}
    {approval && <><code>Spender:{String(args[0])}</code><p>Set the total allowance to {formatUsdc6(args[1] as bigint)} USDC, replacing the current allowance. Approval is not payment.</p></>}
    {r.call.operation === "pay" && <p>Pay the full total once, including any share returned to your own wallet. Balance and allowance must cover the full total.</p>}
    <p>Native value: 0 · Nonce:{r.quote.nonce} · Gas limit:{r.quote.gasLimit.toString()}</p>
    <p>Maximum gas cost:<strong>{formatFee18(r.quote.feeBudget18)} USDC</strong> (rounded up; the receipt determines the actual fee).{r.call.operation === "pay" ? "Payment amount is separate." : ""}</p>
    <p>Native gas uses 18 decimals; the USDC contract uses 6. They represent the same balance and must not be added together.</p>
    <details><summary>View exact calldata</summary><code>{r.call.data}</code></details>
    <p>Live fees are checked again before opening your wallet. Changes within your reviewed limits are allowed; limits never increase automatically. The 30-second quote window applies before wallet handoff, not to onchain confirmation. Confirm in your wallet, or reject if you leave it open too long. No automatic signing or resending.</p>
    <button disabled={op.busy} onClick={op.close}>Back, without signing</button>
    <button disabled={op.busy} onClick={() => void (remaining === 0 ? op.prepare(r.call) : op.sign())}>{op.busy ? op.stage === "wallet" ? "Confirm in your wallet…" : op.stage === "confirming" ? "Broadcast. Waiting for confirmation…" : op.stage === "verifying" ? "Receipt received. Verifying results…" : "Checking live fees…" : remaining === 0 ? "Refresh quote (no signature)" : "Confirm & open wallet"}</button>
  </section>;
}
