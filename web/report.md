# Final web integration candidate — October 28

Coordinator completed preserved partial work after developer turn failed due account usage limit. Candidate is complete for focused independent review, not yet published or real-wallet validated.

Preserves accepted blue/white wallet UI. Adds exact reviewed testnet deployment capability separated from runtimeVerified/full scenario acceptance, injected wallet add/switch, live Request1 dashboard, create/share/exact approve/pay and public receipt recovery, Chinese review and 30-second quote countdown, explicit nonce and revalidation, shared-balance funding reserve, Web Locks plus durable browser intent with unknown outcome blocking. Reads storage again inside lock to detect other-tab records. Reset/cancel and mainnet remain disabled.

Validation: candidate TypeScript noEmit passed; Vite production build passed (bundle-size advisory only); 5 targeted synthetic checks passed (deployment identity/capabilities, TTL, shared gross funding, storage failure, wallet switch rejection). No real signatures, broadcasts, Keychain/helper reads or operation ledger writes. Browser QA attempted through CUA but Work settings returned local browser use disabled; not claimed passed. Prior accepted design desktop/mobile inspections reused; new interactions need review/browser availability.

Limitations: browser wallet may hold its confirmation popup beyond application TTL; application rechecks immediately before eth_sendTransaction and instructs user to reject a stale popup, but cannot cancel an already handed-off wallet request. Local journal does not protect against users deleting all browser data or signing in another device/app. Receipt confirms contract events and canonical state, does not claim independent whole-block balance attribution or full competition eligibility. Mainnet funds/signatures, Studio terms/login, public audience, video and submission receipt remain outstanding.

## R2 focused repair

The independent reviewer turn failed after network permission revocation; no formal completed PASS is claimed. Its last commentary identified two synthetic counterexamples, retained as necessary repair input: stale background recovery could overwrite another tab intent; returned nonce could overwrite reviewed nonce.

R2 uses one origin-wide journal Web Lock for submission and all background recovery, refreshes storage after lock acquisition, and recovers the current record object. Submission's final recovery stays inside the existing lock without nested acquisition. Global lock intentionally serializes different wallets too, preventing whole-array journal lost updates. Unused dismiss mutation removed. Reviewed nonce is persisted before wallet handoff and never overwritten from returned transactions; missing frozen nonce or mismatched nonce remains unknown.

Candidate typecheck and production build passed; original five focused checks plus exactly two synthetic regression checks passed. Cross-tab fixture retained both old/new records and skipped writes while lock unavailable; mismatched nonce5 vs frozen4 remained unknown/unavailable with zero business-state reads. No actual wallet, secret or real ledger touched. Browser QA remains unavailable, mainnet and unsupported operations remain closed.
