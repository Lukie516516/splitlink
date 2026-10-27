# SplitLink Build Report

## Session: open-items resolution (export04 review)

### Summary

All six export04 review defects resolved. Final status:

| Check | Result |
|-------|--------|
| `bun run check` (lint + typecheck) | 0 errors, 0 warnings |
| `forge test` | 80 passed, 0 failed (50 integration + 25 pure + 5 reentrancy) |
| `bun test` (TS tests) | 66 passed, 0 failed |
| `vite build` | succeeded (17.77s) |

---

### Changes this session

**MyRequests.tsx — cancel routed through full preflight chain**
- `submitCancel` now runs `verifyManifestOnChain` → `runPreflight` → `verifySigningContext` before `writeContract`
- Fee estimate shown in confirm dialog; signing disabled until estimate present and not stale
- Stale-quote re-fetch triggered automatically before dialog re-opens
- `cancelManifestVerifying` state shown as "Verifying…" on the cancel button
- Generation/context lifecycle fixed: `lastStartedGen` ref prevents double-start; stale-context results ignored after account/chain switch
- `readOneRow` in `useCallback` with chain-specific client; exact `adjustedStart` tracking prevents block-skipping

**ReceiptPage.tsx — full 8-condition evidence verification**
- Added `getTransaction` + `decodeFunctionData` verification (conditions 6–8)
- `RawLog` typed interface prevents implicit `any` errors in for-loop
- Malformed `log.data` (null, `0x`, short) explicitly rejected with reason logged
- Reverted receipt immediately rejected at condition 1 (not shown as evidence)
- Wrong `tx.to` / `tx.from` / decoded `functionName` / decoded `args[0]` each produce specific failure reasons
- Evidence display distinguishes "8/8 conditions met" from "temporarily unavailable" — paid state stands alone
- Bounded page scanning with `fromBlock = supportedManifest.deploymentBlock`

**tests/splitlink-safety.test.ts (66 Bun tests)**
- Section 1: `ceilDiv`, `p6ToNative`, `makeContextKey`, `verifySigningContext` (stale/context/calldata/value/simulation)
- Section 2: `checkFunding` (pay/approve/reset/cancel, null balance)
- Section 3: `runPreflight` mock RPC — success, ALL 5 ops simulation blocking, transport vs deterministic, fee floor/margin, quotedCallData/quotedTarget
- Section 4: `clearCachedSuccessOnRestore` — confirmed→submitted demotion, hash-less→unknown, reverted/rejected preserved, forged success rejected
- Section 5: `recoverRecord` mock RPC — confirmed, reverted, rpcFailure, not-found→unknown, wrong tx.to, wrong tx.from
- Section 6: evidence parseWord helper — correct, empty, short, non-hex
- Section 7: history adjustedStart no-gap invariant
- Section 8: journal structural validation (all states/ops, non-array replacementHashes, ambiguous broadcast → unknown not rejected)
- Section 9: verifyManifestOnChain mock RPC — all conditions, chain ID mismatch, empty bytecode, USDC decimals

**src/vite-env.d.ts**
- Added `VITE_SPLITLINK_EXPECTED_BYTECODE_HASH: string | undefined` to `ImportMetaEnv`

**src/lib/journal-testexports.ts**
- Test-only re-export shim exposing `isValidRecord_TESTONLY`, `clearCachedSuccessOnRestore_TESTONLY`, `recoverRecord`, `generateRecordId`, `TransactionRecord`

**bunfig.toml**
- Created: `[test]` section with `preload = ["./tests/setup.ts"]`

**tests/setup.ts**
- Bun test setup: polyfills `import.meta.env` with safe defaults, polyfills `localStorage`

---

### Open items (not resolved this session)

1. **Journal recovery UI** — `recoverRecord()` in `journal.ts` but no component mounts recovery on page load. A recovery hook (`useJournalRecovery`) that iterates `submitted` records and calls `recoverRecord` on each would complete this. Mount it in the app shell.
2. **PayPage.tsx** — `handleApprove`, `handleApproveReset`, `handlePay` do not call `verifyManifestOnChain` before write; only `runPreflight` is invoked. Add `verifyManifestOnChain` call before each `writeContract`.
3. **Competition eligibility gates G1–G5** (spec §13.4) — unresolved.
4. **Hosted deep-link / CORS / SPA fallback** — not tested.

---

### Test counts

| Suite | File | Passed | Failed |
|-------|------|--------|--------|
| Forge integration | `contracts/test/SplitLink.t.sol` | 50 | 0 |
| Forge pure | `contracts/test/SplitLinkPure.t.sol` | 25 | 0 |
| Forge integration-5 (reentrancy etc) | `contracts/test/SplitLink.t.sol` | (included above) | |
| Bun TS | `tests/splitlink-safety.test.ts` | 66 | 0 |
| **Total** | | **141** | **0** |
