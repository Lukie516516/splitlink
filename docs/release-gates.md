# Gates and operational limitations

- G1: an actual Studio app/session and partial exports exist (recorded in the coordinating build log). Studio stopped at daily quota. This candidate's completion is explicitly external; it does not claim a completed Studio remediation round or additional Studio runs.
- G2: full authoritative rules, accepted external/import workflow and eligibility remain unverified. A Studio source lineage alone is not entry acceptance.
- G3: local Anvil and mock token validate the local application only. Canonical token self-transfer, nonzero allowance/reset, shared 6/18 balance, actual fees, issuer restrictions/rollback and real RPC historical range behavior require separately authorized testnet execution. No measured preapproval hint exists; unknown-fee acknowledgment remains the only enabled preapproval path. Do not enable `runtimeVerified` for Arc by assuming local tests suffice.
- G4: no external deployment, audited production manifest, controlled real wallet/funds/signatures or actual hosted HTTPS/deep-link/CORS acceptance. Hosting fallback is prepared and local hard-refresh tested. No release or security-audit claim.
- G5: exact deadline/timezone, full submission evidence and payout/verification terms remain unverified. No submission executed.

Public reads use a manifest-scoped HTTP client independent from the connected wallet. One approved RPC is configured per entry; retries shrink page ranges and preserve inaccessible gaps, but operational multi-provider failover remains release configuration work. The exact code appearance block is checked, so an RPC lacking historical code reads cannot silently certify the deployment.

All five writes need a successful current simulation/estimate plus fresh funds/request/allowance and exact wallet context. The wallet's final validation supplements these checks. Gas cap/reserve are conservative policy, not guaranteed actual expense. Changes after simulation remain possible.

The browser's journal is origin-local public data, not custody, a background service or a guaranteed index. No auto-signing/resubmission. Cleared storage, another device, inaccessible RPC history or missing replacement APIs may prevent recovery of a lost hash. Standard JSON-RPC lacks universal sender+nonce lookup. Candidate replacements are independently verified; nonce advance or timeout alone cannot establish an outcome. Known pending exact bodies remain submitted; absent/pruned bodies stay unknown. Canonical state is separate.

Every provider cache/status is untrusted until fresh reads succeed; history rows retain their titles on retry but are marked stale and cannot authorize cancellation/receipt completion. Polling runs in the foreground and resumes on focus. Transaction tracking retains its original context when the wallet switches.

Only loopback deployment tooling exists in the candidate. Real deployment/testnet runners and controlled execution must be separately reviewed/authorized before adding a write path. No private keys or private RPC credentials belong in source, logs, CI or VITE variables.
