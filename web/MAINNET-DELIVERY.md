# Mainnet delivery — 2026-10-29

The live app is https://splitlink.wiryfig6.chatgpt.site (Site v9). Runtime source is synchronized in this directory; the release manifest records exact source blob hashes and the Site source commit.

Request 1 is actually Paid on Arc Mainnet, chain 5042. Payment transaction: https://explorer.arc.io/tx/0x2d8daad1340b548fc101745ba159bfcf1fcead6c365ccf8499f02bbb18a829d1 . Canonical block 28462860, successful receipt, exact payer A / nonce3 / payRequest(1) / value0, runtime identity, ordered RecipientPaid(A,5000), RecipientPaid(B,5001), RequestPaid(total10001) and canonical USDC Transfer events were checked. Receipt-block and latest allowance are zero; receipt-block and latest request state are Paid with matching payer/paidAt. Actual payment gas fee was 0.0034357286099125 USDC. Whole-block wallet balance isolation is not claimed.

The contract is `0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010`; deployment fee 0.03492295 USDC. The funded project's once-only flow is complete. Each operation's app-requested gas cap is 0.02 USDC, under the project ceiling of 1 USDC; the owner can still independently change wallet fees or sign unrelated transactions.

Recent fixes: fee-cap preflight and nearby error/review placement; RPC throttling/cooldown and reduced polling; bounded transaction-history lookup; JSON-RPC batching and parallel independent checks; live requirements compared with the unchanged reviewed transaction envelope; explicit refresh-quote action and distinct wallet/receipt status.

Validation reused already completed typecheck/build/16 focused checks and the recorded public-readonly/browser timing observations. No additional real transaction or signature was executed for source synchronization. Existing root application and its CI remain separate from this frontend. Historical reviews/manifests are retained without re-labeling them as reviews of v9.

Remaining hackathon work: genuine walkthrough video/upload and personal final submission. Studio partial-export/external-supplement provenance must be disclosed honestly; eligibility is not assumed.
