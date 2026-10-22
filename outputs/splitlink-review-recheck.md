# SplitLink independent recheck 1

Date: October 22, 2026 (Asia/Shanghai).

**Status: approved-local. Blocking local findings: 0. F1 closed; F2 closed.** This is approval of the reviewed local implementation within the targeted independent review scope, not a formal security audit, production release approval, Arc integration certification or hackathon submission/eligibility approval. The coordinator's complete CI result remains a separate required artifact for the same source fingerprint.

## Reviewed source fingerprint

```json
{
  "status": "approved-local",
  "sourceSha256": "5d6443c4aca7655799c411be914e13231acb00f36aef0ccb5b9cd7d19be2166d",
  "blockingFindings": 0,
  "closedFindings": ["F1", "F2"]
}
```

Generated using the repository's `sourceDigest()` in `scripts/source-fingerprint.mjs`; it covers source/contracts/scripts/tests/CI/dependency locks and listed configurations/specification. Reports under `outputs/` are outside that digest. Approval applies to this fingerprint; later source or dependency changes require assessment and matching CI evidence. No reviewer product/CI changes were made.

## F1 closure: interruption recovery and browser-cache trust

Read and verified the final `Journal` restore loop, `App.recover`, the no-hash branch of `reconcile`, the Activity verified-link condition and the corresponding added core/browser tests.

- All restored records lose cached business verification, receipt fields and actual-fee evidence before classification, including no-hash records and records labeled rejected/changed-call replacement. A cached success cannot authenticate itself.
- Hashed unresolved records are rechecked on their original manifest chain. Confirmed-but-pending/notChecked entries are eligible for recovery rather than being skipped solely because a receipt was once confirmed.
- No-hash records remain unresolved with a wallet-history warning and cannot retain verified business state. Explicit rejection remains distinguishable; no automatic signature or resubmission is introduced.
- The created-request link additionally requires confirmed execution, a successful receipt, an effective hash and independently verified business state.

### Independent actual-App verification

On isolated localhost:18545 / chain 31337, deployed the existing compiled mock token and SplitLink, minted fixture tokens, and executed actual local creation, reset, approval, payment and cancellation operations. Seeded each real record at the persisted `confirmed/pending` interruption checkpoint, then loaded the actual React application on localhost:4281. All five entries were reconciled without requesting a signature:

```text
create        confirmed verified requestId=1
approveReset  confirmed verified requestId=1
approve       confirmed verified requestId=1
pay           confirmed verified requestId=1
cancel        confirmed verified requestId=2
```

A residual no-hash cached-success branch was found during the first part of this recheck: an earlier intermediate restore implementation cleared evidence only when `effectiveTxHash` existed. The coordinator fixed it during the recheck by clearing evidence for every restored record and adding the no-hash reconciliation/render safeguards above. **The final conclusion uses the corrected current code, not that intermediate snapshot.**

Repeated the actual-App test at the final fingerprint, then seeded a valid-shape forged creation record with both hashes null, `confirmed/verified` and nonexistent request ID 999999998. On reload:

```json
{"links":0,"state":["unknown","notChecked"]}
```

The final test recorded the same source digest before and after execution. The added core test also covers missing-hash claims in confirmed/unknown/prepared/rejected/cancelledByReplacement states. The browser regression source includes both changed terms with a known hash and a no-hash forged success. Existing mismatch validation remains in place; no settlement-receipt verification was relaxed.

**F1 is closed**, including its original journal-trust concern. The malformed cached record is retained as uncertainty, not converted into a fake failure or automatic recreation.

## F2 closure: history polling after wallet-only chain changes

Both the initial history effect and timer effect now depend on the full `contextKey`; their captured callback no longer remains bound to the old signing-chain key. Scan calls share a context-scoped in-flight promise, while generation checks still prevent obsolete scan results from becoming the current display. Pending transaction context remains independent and preserved.

Independently exercised real React effects and the 15-second history timer, not a direct call to the history helper:

1. Connect the injected fixture account on 31337 and load My requests.
2. Emit only `chainChanged` to `0x1`, retaining the same account and selected local deployment.
3. Create another real request from the separate localhost signer; make no Refresh click. The request appears through automatic polling.
4. Emit only `chainChanged` back to `0x7a69`; create another separate request. It also appears through automatic polling.

This sequence was performed once during the initial recheck and repeated against the final fingerprint. In both directions the new title appeared within the 22-second wait allowed for the 15-second timer. No reviewer transaction or request touched 8545/4173/9545.

**F2 is closed.** The old scan-overlap observation is addressed in source by the shared in-flight guard. This recheck did not rerun the earlier injected 8-second-per-page latency experiment against the final build, so it does not claim a new performance benchmark or progressive-per-page rendering guarantee. No new locally blocking issue was found in the reviewed fixes.

## Independent checks and execution limits

| Check | Result |
|---|---|
| `./node_modules/.bin/tsx --test tests/core.test.ts` | Final added tests included: 11 groups passed |
| `./node_modules/.bin/tsc --noEmit` | Passed after final restore changes |
| `./node_modules/.bin/hardhat test --no-compile` | 8 groups passed under upgraded local Hardhat |
| Actual-App five-operation interrupted recovery | Passed on isolated mock RPC; repeated at final fingerprint |
| Actual-App no-hash forged-success restoration | Passed at final fingerprint: zero verified link, unknown/notChecked |
| Actual-App automatic history polling after wallet-only switch and return | Passed; repeated at final fingerprint |
| Full coordinator CI / production browser suite / dependency audit | Separate coordinator evidence; not represented as independently rerun here |

Commands used the bundled Node directory in PATH. The Playwright upgrade initially lacked its matching downloaded Chromium executable, so the reviewer explicitly selected the installed Microsoft Edge executable for isolated repros; this is a browser/runtime selection, not a product failure. Source and new regression tests were independently read. No external RPC, wallet, signature, transaction, public deployment, account upload or submission was used in this recheck. Reviewer-owned chain/preview processes are stopped when verification finishes.

## External gates remain open

The original report's G1–G5 limitations remain in force. In particular, actual Studio project/provenance and accepted workflow, authoritative entrant/submission rules, canonical Arc USDC write integration and self-transfer/reset/shared-fee evidence, a reviewed real deployment and manifest, controlled funds/signatures, actual public HTTPS routes/CORS, and final submission materials/verification have not been established by this local review. The Arc frontend's deliberate release gate has not been lifted by approval.

The coordinator may record this fingerprint as **approved-local** once matching complete CI evidence is available. It must not relabel that status as submitted, competition compliant, mainnet tested, publicly hosted or audited.
