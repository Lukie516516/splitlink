export function userMessage(error: unknown): string {
  const s = error instanceof Error ? error.message : String(error);
  if (/rate limit|defined limit|too many requests|429/i.test(s)) return "Arc RPC is rate-limited. Reads are paused for one minute. Retry later; no signature is requested before identity verification.";
  if (/4001|reject|declin/i.test(s)) return "You rejected the wallet signature. No automatic retry.";
  if (/feeEnvelopeExceeded|fee cap increased/i.test(s)) return "Live fees exceed your reviewed limits. No signature requested. Refresh the quote; limits never increase automatically.";
  if (/expired|staleQuote/i.test(s)) return "The quote expired before wallet handoff. No signature requested. Refresh the quote and confirm again.";
  if (/RequestNotOpen|Paid|Cancelled/i.test(s)) return "The request is paid or cancelled. Refresh its onchain state.";
  if (/RequestNotFound/i.test(s)) return "Request not found on this network. Check the link and request ID.";
  if (/insufficientPrincipal|Insufficient USDC/i.test(s)) return "Insufficient USDC. Keep enough for the full total, including your own recipient share, plus network fees.";
  if (/insufficientFeeBudget/i.test(s)) return "Balance cannot cover the full total, maximum gas cost and reserve.";
  if (/allowance insufficient/i.test(s)) return "Insufficient allowance. Preview approval for the exact full total first.";
  if (/context changed|Wallet context/i.test(s)) return "Wallet, network or inputs changed. Preview again.";
  if (/pending transaction|transaction is pending/i.test(s)) return "A wallet transaction is still pending. Check wallet activity, wait for its receipt, then use Recover status if it appears in Transaction recovery. Do not submit it again.";
  if (/wallet nonce changed/i.test(s)) return "The wallet transaction sequence changed after preview. Refresh the quote. If you just signed, check wallet activity and recover that transaction first.";
  if (/revert|simulation/i.test(s)) return "Simulation failed. No signature requested. Refresh the request and allowance; do not reset approval for an unknown error.";
  if (/RPC|fetch|http|network|timeout|integration|unavailable/i.test(s)) return "Onchain reads or identity verification are unavailable. Read-only mode is active. Try again later.";
  if (!/[\u3400-\u9fff]/.test(s) && s.length < 220 && !/^(?:[A-Za-z]+Error|Error):/.test(s)) return s;
  return "The operation is unverified and has stopped. Check wallet activity and recover status; do not submit again.";
}
