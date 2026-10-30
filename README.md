# SplitLink — live release

The current public wallet app source is in **[web/](web/README.md)**. Live app: https://splitlink.yongzhitangcn.chatgpt.site . Actual Arc Mainnet settlement: [Request 1 payment receipt](https://explorer.arc.io/tx/0x2d8daad1340b548fc101745ba159bfcf1fcead6c365ccf8499f02bbb18a829d1).

`web/RELEASE-MANIFEST-20261030.json` identifies Site v13 source: English interface, repeatable create / exact approval / pay for all wallets, and improved receipt verification feedback. The one-time funded demonstration restrictions have been removed. Each operation still uses current chain state, reviewed fees, exact allowance and wallet confirmation. The app charges no platform fee.

Studio export06 was partial; later remediation, UI and performance work were completed externally. Historical reviews and CI counts below apply to their named snapshots. A genuine video URL and final personal hackathon submission receipt remain pending; no organizer eligibility acceptance is claimed.

---

# SplitLink — Studio source, completed externally after export

This independent candidate continues the actual partial Studio export `studio-export-06-partial` with missing support files from `studio-snapshot-01`. The Studio account stopped at its daily quota during remediation round three. Subsequent modifications and tests are external local development, **not work executed in Studio**. The reviewed original root application is not copied into this candidate and stays unchanged. See `docs/external-base-provenance.json` and the top-level `outputs/studio-local-development-report.md`.

A fixed, public, single-use USDC link splits atomically among 2–5 recipients. Ordered terms never change; shares sum to 10000 bps; the final recipient gets the integer remainder. Any wallet may pay; the creator may cancel Open requests. There is no platform fee, owner, escrow, refund, relay, backend or database. Public requests and receipt evidence use dedicated public-chain reads without a wallet. The Studio-origin contract is retained byte-for-byte.

## Pinned environment

Node **24.19.0**, pnpm **11.25.0**, Bun **1.4.3**, Foundry Forge/Anvil **1.7.1**, Solidity **0.8.28**, optimizer 200, Paris bytecode. `pnpm-lock.yaml` pins all dependency resolutions. `pnpm-workspace.yaml` restricts allowed install builds and pins audited overrides for tmp/PostCSS. Native Forge/Anvil/Bun are installed as exact dev dependencies; no global tools or wallet keys are needed for local checks.

On this desktop:

```sh
export PATH="/Users/lukie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
cd /Users/lukie/Documents/ChatGPT/hackthon/outputs/studio-local-release
pnpm install --frozen-lockfile
```

## Verify everything locally

```sh
pnpm contracts:test
pnpm test
pnpm typecheck
pnpm format:check
pnpm audit --audit-level high
pnpm exec playwright install chromium
pnpm ci:local
pnpm build
```

`ci:local` refuses an occupied port, owns an isolated Anvil on **9547**, compiles the actual Studio contract and generated ABI, deploys a labeled local mock, tests the production runner, builds with the local fixture enabled, runs Chromium on production preview **4274**, and stops only its chain. Playwright owns/cleans the preview. No connection to root ports 8545/4173 is used. The workflow `.github/workflows/ci.yml` runs the same commands in a standalone repository tree; it has been executed locally, not pushed or run on hosted CI in this task. Browser evidence lands in `evidence/`.

Foundry's original 80 tests include 30 pure/model or supplementary integration cases and 50 main contract cases; they do not prove browser behavior. Additional external Solidity tests exercise the actual contract, including reentry and five-recipient fuzz allocation. Bun tests invoke production modules. The two independent export05 recovery regressions are included. Legacy Studio TS tests are preserved under `docs/original-tests/`, outside executable discovery, because their old mocks/model assumptions do not exercise the new shared controller. They are not counted as this candidate's passing suite.

## Run the app manually

```sh
# Terminal 1, candidate directory
pnpm local:chain

# Terminal 2, same directory
pnpm compile
pnpm local:deploy
VITE_ENABLE_LOCAL=true pnpm dev
```

Open `http://127.0.0.1:5274/create`. Use a wallet configured to **local chain31338** for manual signing. Tests inject a local unlocked-account fixture only in test contexts; there is no simulated production wallet. Never put real funds in local test accounts. Local mock ERC20 and test ETH are separate assets; they do not validate Arc's shared balance semantics.

`pnpm dev` without opt-in shows an unconfigured Arc Testnet release. No fabricated deployment is supplied. Canonical writes stay blocked until reviewed runtime integration is explicitly enabled after real tests. `.env.example` contains no secrets. The expected runtime hash is **keccak256**, mandatory. Runtime, chain, immutable USDC, token decimals/code, ABI version and exact deployment-code boundary are checked before writes; every write freshly simulates, estimates and checks funding.

## Transaction and evidence behavior

A shared runner handles create/reset/approve/pay/cancel. It freezes exact calldata, chain, account, target and value zero; persists intent before the prompt; persists each returned hash immediately; and binds the result to that operation's record. A live context ref plus explicit wallet context is checked after asynchronous preparation. A failed current simulation, funding check, quote TTL or changed context cannot sign.

Approval is a separate step with its own estimate. It does not require a payment estimate without allowance. Missing future fee hints are visibly unknown and require acknowledgment. Reset requires an explicit manifest policy and separate confirmation; both approval and reset retain gross principal funding. Native/token balance views are never added on Arc. Local separate assets stay separate in review. Fees displayed at six decimals round upward; actual fee is gasUsed × effectiveGasPrice.

Hydration clears all cached receipt/business claims, even terminal forged labels. Live reads do not repeatedly demote verified records. Recovery runs at startup/focus/poll/manual retry using the original allowlisted chain and effective hash. Exact sender/target/calldata/value/nonce, receipt identity and operation-specific canonical events/state are checked. Missing hashes/bodies remain unknown; elapsed time and nonce advance never prove failure. No background, cross-device or cleared-storage recovery guarantee. A local retry guard can only be dismissed explicitly after checking wallet activity; that does not cancel or resend a transaction.

Settlement proof requires a successful receipt's own RequestPaid and ordered RecipientPaid logs, exact payRequest call, zero native value and fresh canonical payer/terms. The actual payer may be another wallet/session even when this device's attempt fails. Paid with unavailable logs stays Paid, with unverified evidence and no fabricated explorer link.

## Release boundaries

Design v1.1 is copied unchanged to `docs/splitlink-design-v1.1.md`; protocol version remains 1.0.0. Real canonical Arc reset/self-transfer/shared balances/fees/restrictions remain unverified in this task. Studio quota, provenance acceptance, full event rules, actual HTTPS host/deep-link/CORS checks, external funds/signatures, mainnet release and submission remain separate gates. No external wallet signatures, chain writes, deployments, public hosting, pushes or submissions occurred.

`public/_redirects` and `vercel.json` prepare SPA fallback for `/create`, `/pay/...`, `/receipt/...`. Default release builds remove the local deployment manifest. Actual host acceptance is pending. A verified payment proves money movement, not delivery, identity or legal acceptance. Issuer restrictions may fail a transfer; consumed gas does not roll back. Unsolicited token transfers to SplitLink are unsupported, with no rescue mechanism.

## Final local evidence (October 26, 2026)

The fresh-copy validation under `evidence/clean-20261026/` passed 83 Solidity tests, 15 production-module TypeScript tests, 5 actual local-chain controller tests and 10 mounted Chromium browser tests, plus typecheck/format/production build. The current online audit returned zero advisories. Empty-source-tree installation initially hit registry TLS errors; a subsequent frozen-lockfile install passed the full supply-chain check without disabling it. Node/package/browser/compiler caches were reused; application node_modules/build artifacts were not copied into the fresh tree. Hosted CI execution and real canonical-token integration remain unverified.

## Revision 2 — SFA-1 history concurrency

This directory is the separate r2 repair candidate, copied from the verified 136-file fixed candidate SHA-256 `64f5afcab80f62f29c4159bec4cd9e332b11422db40c1fc968ffd14329e08565`. The fixed original is preserved. See `docs/SFA-1-r2.md` for the per-cursor FIFO and unified page scan queue, direct production interleaving regression and mounted overlap regression. Current r2 execution evidence and final source inventory are bound by the separate `outputs/studio-local-r2-development-result.json`. Earlier counts above describe the base candidate; r2 counts must be read from the new result/report. All work remains external post-export development with release/eligibility gates open.
