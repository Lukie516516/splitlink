# SplitLink v1.1 — Independent review 1

Reviewed October 22, 2026, Asia/Shanghai. Workspace: `/Users/lukie/Documents/ChatGPT/hackthon`.

## Decision

**Changes requested: two reproducible client defects (P2).** No fund-drain, arithmetic, unauthorized spending or partial-settlement defect was found in the reviewed contract. That is a bounded review conclusion, not a security audit or certification. Real Arc integration and competition eligibility remain unverified; the project cannot currently be described as ready for hackathon submission.

This review independently read the implementation, the full `docs/splitlink-design-v1.1.md`, the earlier development prompt and relevant tests/scripts. It did not rely on the implementation report as evidence of passing tests. No product or CI files were edited. All reviewer broadcasts were isolated mock transactions on localhost:18545, chain 31337; browser repros used localhost:4281. Ports 8545 and 4173 were not used. No external signer, chain transaction, deployment, publication or submission was performed.

Line numbers below refer to the source read during this review, before coordinator fixes; use the function names if later edits move them.

## F1 — P2: Interrupted postreceipt verification cannot resume through the application's recovery entry point

**Primary location:** `/Users/lukie/Documents/ChatGPT/hackthon/src/App.tsx:181–191` (`recover`).

**Related locations:** `/Users/lukie/Documents/ChatGPT/hackthon/src/core/chain.ts:516–546` (`reconcile`), `/Users/lukie/Documents/ChatGPT/hackthon/src/core/journal.ts:73–81` (restore), and the Activity display of stored verification results.

### Trigger and impact

`reconcile` durably saves `txState="confirmed"`, `receiptStatus="success"`, and `businessVerification="pending"` **before** awaiting the canonical request/event verification. Closing/reloading the tab during that await is a normal interruption point. On restart, `recover` skips confirmed records unless business verification is specifically `unavailable`. The restored `confirmed/pending` record is therefore never reconciled, including when the user clicks **Reconcile**. For creation, `requestId` can remain null and the activity never exposes the verified created-request link. The separate My requests scan can discover the request, but does not repair the journal entry.

The same selection rule also accepts restored `confirmed/verified` entries without any renewed chain validation. The journal schema checks shape, not authenticity. Thus terminal activity claims are trusted from browser storage despite the specification's trust boundary; a structurally valid modified record can render an unverified "Open verified created request" link. The payment receipt view independently verifies settlement, so this observation is **not** a forged chain receipt or a demonstrated loss of funds.

### Reproduction actually run

1. Deploy the existing compiled SplitLink and LocalMockUSDC to isolated Hardhat RPC `http://127.0.0.1:18545`.
2. Create `Independent recovery fixture` with total 10001 units, two recipients and shares `[5000,5000]`; retain the real successful creation hash/calldata/receipt.
3. Before opening the client, seed `splitlink.transactions.v1` with an otherwise valid record for that real transaction at the interruption checkpoint: `txState=confirmed`, `receiptStatus=success`, `businessVerification=pending`, `requestId=null`. This reproduces the exact persisted state from `chain.ts:516` before the later read completes; it is not an invented transaction outcome.
4. Serve the source client on port 4281 with an intercepted local manifest pointing only to port 18545. Connect the fixture account, open `/create`, and click **Reconcile**. Count receipt requests and inspect the journal.

Observed output:

```json
{"receiptReads":0,"journal":"pending","verifiedLink":0}
```

The real request was present in My requests while the journal stayed pending. Existing integration tests call `reconcile` directly and do not test this `recover` predicate, which is why those tests do not detect the restart defect.

### Suggested fix

Reconcile restored records whose business verification is incomplete, including `pending` and `notChecked` where applicable, rather than using only receipt-state terminality as completion. Independently revalidate any restored success claim before displaying it as verified; a one-time per-session restore validation is sufficient and need not reread every historical success on every five-second tick. Keep rejected and verified changed-call replacements correctly distinguished. Preserve original-chain context and never resubmit automatically.

### Acceptance

- Browser test the real successful creation checkpoint above, reload, then exercise the actual application recovery entry point: it must verify events/terms, recover ID and expose the verified link without a new signature.
- Repeat an interrupted confirmation for pay/cancel/approval and verify operation-specific recovery rather than assuming the receipt alone completes the action.
- Seed a valid-shape terminal success record whose hash/call/terms disagree with the chain: the client must not render an unverified success label or verified-created link. A legitimate restored terminal record should regain verified status after a chain check.
- Keep RPC failures honest (`unavailable`/unknown as appropriate) and retain records for retry.

## F2 — P2: Wallet chain changes leave My requests polling bound to an obsolete context

**Primary location:** `/Users/lukie/Documents/ChatGPT/hackthon/src/App.tsx:438–449` (history polling effect).

**Related locations:** `src/App.tsx:142–144` (`contextKey`), `src/App.tsx:302–304` (`scanHistory` context guard), `src/App.tsx:428–437` (initial history effect).

### Trigger and impact

`scanHistory` closes over `contextKey`, which contains the wallet's `chainId`. A wallet-only `chainChanged` event changes that key while keeping the account and selected application deployment (`m`) unchanged. Both history effects omit the wallet chain from their dependencies. Their old `scanHistory` closure remains installed, and every polling call immediately returns at the obsolete-context guard. Unlike public request polling, which depends on `contextKey`, My requests silently stops updating. Previously displayed statuses remain presented without a stale/refreshing indicator until the user manually refreshes or another dependency changes.

This can hide a new request, external payment or cancellation while the app is open. Signing preflight still rereads chain state, and wrong-network signing is disabled, so this is a history freshness defect rather than demonstrated unauthorized settlement.

### Reproduction actually run

1. On the same isolated deployment, connect account 0 at wallet chain 31337, open `/create` and wait for the one existing request to appear.
2. Emit only `chainChanged` to `0x1`, retaining the same account and leaving the app's selected network/deployment unchanged.
3. From the isolated local signer, create a second request titled `Independent chain-switch fixture` on chain 31337.
4. Wait 16.5 seconds, beyond the 15-second history timer; then click **Refresh history**.

Observed output:

```text
after automatic timer: {"newTitle":0,"rows":1}
after manual refresh:  {"newTitle":1,"rows":2}
```

The same underlying read-only RPC and deployment were available throughout. Manual refresh uses the new render's closure and discovers the row immediately.

### Suggested fix

Make the history effects depend on every context value captured by their callback, or stabilize the callback around an explicit history-context snapshot/ref. Do not let wallet signing-network changes disable public history reads for the selected supported deployment. Explicitly invalidate or mark stale history on context changes until reads succeed. Preserve generation guards against obsolete responses and keep pending transactions on their original chain.

### Acceptance

- A browser test switches only the wallet chain, retaining account/selected manifest, and then creates/pays/cancels a request from another session on that selected chain. The next automatic history refresh must update its row or explicitly display a supported stale/error state; it must not silently cease polling.
- Switching back, disconnecting, changing accounts and changing selected deployment must not leak old-context rows or late async results.
- Verify this through the real timer/effect path, not only by directly invoking a helper.

## Non-blocking observation — overlapping initial history scan and timer

The initial history effect and the history timer have separate in-flight guards. With more than 4000 historical blocks and an injected **8-second delay per log page** (below the RPC's 10-second request timeout), three pages take over 15 seconds. The timer starts a second scan and invalidates the first generation. In a clean-browser reproduction, after 35 seconds there were 6 log requests, 0 rendered rows and a loading label; removing delay and manually refreshing immediately produced the request and complete history. A previously populated history loses its loaded statuses during a refresh until the whole scan completes.

This demonstrates duplicate scan work and delayed availability, **not proven permanent starvation**: the timer's own `working` guard can eventually allow a scan to finish. Consider one shared single-flight/abort policy for all history triggers and publishing verified pages progressively, retaining honest partial/stale labels. Do not describe this observation as an infinite-loop defect without a stronger reproduction.

## Checks independently executed

The shell initially lacked Node in PATH. Plain `pnpm test` stopped before tests with `node: command not found`; this was an environment issue, not a product test failure. Subsequent commands used:

```sh
export PATH="/Users/lukie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
```

| Check | Actual result | Scope |
|---|---|---|
| `./node_modules/.bin/hardhat test --no-compile` | 8 groups passed | In-process isolated Hardhat; mock token, no external RPC |
| `./node_modules/.bin/tsx --test tests/core.test.ts` | 9 groups passed | Exact parsing/allocation/fees, pagination, journal and replacement helpers |
| `./node_modules/.bin/tsc --noEmit` | Passed | Current TypeScript sources |
| Independent in-memory solc compilation with optimizer 200 / Cancun | Passed; ABI and creation bytecode matched both existing tested artifacts | No source/ABI/artifact files written; solc 0.8.30 |
| Custom Playwright + isolated 18545 RPC repro of F1 | Reproduced | Actual application recovery selection, real local creation receipt |
| Custom Playwright + isolated 18545 RPC repro of F2 | Reproduced | Actual wallet event, React effects, automatic and manual history paths |
| Slow-page browser observation | Reproduced latency/duplicate work | Not classified as permanent starvation |

The custom reproductions ran directly as inline Node scripts, intercepted only `/local-manifest.json`, and injected a mock EIP-1193 wallet; no tracked test/product/CI file or existing manifest was changed. Test output excerpts and exact steps above provide the coordinator a regression recipe. Existing integration/browser suite source was reviewed but those full suites were **not rerun by this reviewer**, to avoid coordinator-owned chain/preview ports. Coordinator CI results are separate evidence. A complete CI rerun and focused reviewer recheck are needed after fixes/dependency updates.

## Reviewed controls and practical limits

- **Precision/allocation:** six-decimal principal and string-to-bps parsing use bigint; contract bounds prevent multiplication overflow; final-recipient remainder preserves the total; recipient order is immutable. The frontend compares canonical allocations before using them.
- **Authorization/atomicity:** payment pulls only from `msg.sender`, state updates precede SafeERC20 calls, every write is guarded, and transfer failures revert the full settlement. All three writes are nonpayable; no owner, rescue, proxy or arbitrary payer parameter was found. Actual canonical token semantics are still untested here.
- **Self-recipient:** implementation executes self-transfer and retains gross allowance/funding; isolated mock tests pass. This does not establish Arc canonical self-transfer/reset behavior, shared native balance or real fee accounting.
- **Races/receipts:** contract prevents second payment and pay/cancel races; client preflight rereads status and wallet context. Settlement validation checks success, actual sender/target/value/call, canonical payer/status and matching RequestPaid/RecipientPaid events. Approval/reverted/unrelated receipts are not accepted as settlement proof in the reviewed path. F1 concerns journal trust/recovery, not bypassing this receipt validator.
- **History:** inclusive range shrinking/retry/dedup and bounded reads were reviewed; generic helper tests pass. UI orchestration has F2 and the latency observation. A tiny successful public log probe cannot certify long-range provider retention/capacity.
- **Allowlist/network gates:** URL targets must match manifest entries. Default Arc manifests are absent; local fixtures require loopback opt-in and chain 31337. `verifyDeployment` currently throws for **all non-local manifests**, including when reached by `readRequest`; adding an Arc manifest alone will therefore not make the real public app work. This is an explicit development gate, not a bypass recommendation: split read validation from release-controlled write enablement when G3/G4 are actually resolved, and test it before publishing.
- **Scope:** this is a targeted source/test review, not a formal audit, exhaustive wallet/browser compatibility test, dependency security review or review of the coordinator's concurrent CI changes. No actual intended public host or real wallet recovery/replacement UX was tested here.

## External blockers to the requested final hackathon result

The local defects above are repairable without external credentials. Fixing them and passing CI **does not** complete submission. Preserve the authoritative G1–G5 register:

1. **G1:** actual authorized Studio account/project/quota and build/test/export provenance are absent from this review.
2. **G2:** complete authoritative competition rules and acceptance of external/local work and the Studio-export/separate-mainnet path remain unverified. Studio's documented testnet deployment scope cannot be assumed to satisfy mainnet evidence requirements.
3. **G3:** no real canonical USDC write integration was performed: approval/reset, self-transfer in both orders, gross allowance consumption, shared native/USDC balance/gas, reproducible failure rollback and real-wallet behavior still need evidence. Default-skipped runners are not pass evidence.
4. **G4:** no reviewed real deployment/manifest/deploymentBlock, controlled external wallets/funds/signatures or actual public HTTPS deep-link/CORS acceptance was established. Current Arc frontend gate needs an evidence-backed release change, not merely filling an address.
5. **G5:** exact submission rules/cutoff/timezone, eligibility, final Studio/video/repository/public-app/mainnet evidence and payout/verification terms have not been established. Nothing was submitted by this reviewer.

**Requested coordinator action:** repair F1/F2, add regression tests through the actual React recovery/timer paths, run the complete isolated CI after all fixes and dependency changes, and request a focused independent recheck. Keep the final outcome described as local until the remaining real integration/release/submission evidence exists.

## Recheck 1 addendum — October 22, 2026

The original findings above are preserved as historical evidence. A focused independent recheck now closes **F1 and F2** for source fingerprint `5d6443c4aca7655799c411be914e13231acb00f36aef0ccb5b9cd7d19be2166d`: **approved-local**, zero remaining blocking local findings within this review scope. This supersedes the original local changes-requested decision for that fingerprint only.

The recheck independently confirmed all five operations recover through the actual App, automatic history polling continues after wallet-only chain changes in both directions, and no-hash forged cached successes lose their verified claim. A residual no-hash branch discovered during recheck was repaired and retested before closure. See `outputs/splitlink-review-recheck.md` for source scope, test evidence and limitations. Complete matching CI is separate coordinator evidence; G1–G5 external integration, hosting and submission gates remain open. This is not formal security audit or hackathon submission approval.
