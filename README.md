# SplitLink

One fixed USDC payment, atomically split among 2–5 team members. Immutable ordered terms, public single-use requests, creator cancellation, zero platform fee, verified public receipts, event-based My requests and a browser-local transaction journal.

**Current provenance: local implementation.** Arc canonical integration, Studio origin, public-host acceptance, release readiness and competition eligibility are not established. The public source repository is https://github.com/Lukie516516/splitlink. No external chain transactions, real wallet signatures or competition submission have been performed. See [implementation report](outputs/splitlink-v1.1-implementation-report.md) and [release gates](docs/release-plan.md).

## Toolchain

Validated here with Node 24.19.0, pnpm 11.25.0, Hardhat 2.26.3, solc 0.8.30 (`73712a01`), optimizer 200, Cancun EVM target. Node 22–24 is accepted. Direct dependencies and `pnpm-lock.yaml` are pinned; use `pnpm install --frozen-lockfile`. No global Solidity compiler or wallet secrets are required. `pnpm-workspace.yaml` permits build scripts only for esbuild and keccak.

This machine's Node is bundled outside PATH. If needed:

```sh
export PATH="/Users/lukie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
```

## Install and verify

```sh
pnpm install --frozen-lockfile
pnpm compile
pnpm test
pnpm build
```

For the complete isolated CI run (including automatic local-chain lifecycle and browser tests), install Chromium and run `pnpm ci:local`. See [CI and review workflow](docs/ci-workflow.md). The GitHub workflow runs on pushes and pull requests in the public repository; consult its Actions page for the actual latest hosted result. The original tool versions and results below describe the first implementation run; current exact dependencies are in `package.json` and the current CI report.

`pnpm delivery:local` requires both CI and independent review approval for the exact current source fingerprint. `pnpm submission:check` additionally lists missing external evidence and fails until supplied; complete fields alone do not certify eligibility. English entry copy, recording plan and the evidence register are in `submission/`. No submission receipt currently exists.

`pnpm test` compiles once, runs contract integration/property tests against an isolated Hardhat EVM, then exact-math/journal/history tests. `pnpm build` includes strict TypeScript checking. Hardhat artifacts are generated; the frontend's generated ABI is tracked. The design source is copied unmodified under `docs/` with source/hash attribution in [architecture](docs/architecture.md).

## Run locally

For a public-read UI with unconfigured Arc writes:

```sh
pnpm dev
```

Open `http://127.0.0.1:5173/create`. Without a verified deployment, the app explicitly disables writes. No sample deployment pretends to be Arc.

For the complete **LOCAL MOCK ONLY** integration, use two terminals:

```sh
# Terminal 1 — isolated loopback EVM, chain 31337
pnpm local:chain
```

```sh
# Terminal 2 — deploy only to hardcoded loopback/chain 31337
pnpm compile
pnpm local:deploy
VITE_ENABLE_LOCAL=true pnpm dev
```

The local token is an unrestricted test fixture. Local test ETH and mock ERC20 balances are separate; this does not validate Arc's shared balance semantics. Local test accounts must never hold real assets. The app expects an injected EIP-1193 wallet for manual signing; automated browser tests inject a fixture forwarding only to unlocked loopback accounts. The fixture is test code, not a production simulated-wallet UI.

## Browser checks against a production build

Keep the isolated local chain running and deploy its local fixtures first:

```sh
pnpm exec playwright install chromium
VITE_ENABLE_LOCAL=true pnpm build
pnpm test:local
pnpm test:browser
```

Playwright starts a Vite production preview on `http://127.0.0.1:4173`; test wallet fixtures and private browser contexts are labeled local. Tests include create/new-context approval/payment/public receipt/refresh, cancellation, refusal, wrong chain, raw percentage edits, storage/RPC/log failures, attribution and history reconstruction. Results are written to `outputs/browser-results.json`. No real wallet is used. Stop the local chain when finished. `pnpm test:local` exercises actual viem HTTP preflight/reconciliation against the same loopback deployment with an additional loopback fault proxy.

## Arc and release preparation

```sh
pnpm check:arc     # public reads only; writes dated JSON evidence
pnpm test:arc      # explicit SKIPPED/BLOCKED until authorized canonical integration
pnpm deploy:plan   # unsigned constructor/bytecode plan only; never broadcasts
```

[Release plan](docs/release-plan.md) covers actual Arc token tests, traceable gas hints, review, allowlist configuration, explicit deployment/signature authorization and hosting. Arc writes remain blocked even if somebody manually fills a manifest: runtime review must precede a reviewed code change. No canonical reset behavior or self-transfer behavior is assumed from local mocks.

For static hosting serve `dist/`; `public/_redirects` and `vercel.json` provide SPA routing. Test `/create`, `/pay/:chainId/:contract/:id` and `/receipt/:chainId/:contract/:id` directly and after hard refresh on the intended HTTPS host. Local preview does not establish actual public HTTPS/CORS/deep-link behavior. Do not deploy local fixtures. Never put private RPC keys, wallet keys or credentials in `.env`/frontend code.

## Behavior and limitations

Principal uses six-decimal bigint integers; native fees use eighteen. Shares use integer bps from raw decimal strings. The last recipient receives the exact remainder. Add/delete does not rebalance other rows. All transfers, including payer-as-recipient, execute; gross approval/funding rules remain conservative. A cap is not actual gas spend. The app never adds Arc native and ERC20 balance views.

A successful transaction receipt is separate from verified business completion. Current payer attribution uses canonical state and matching settlement evidence, never the current browser's assumption. Public requests/receipts work without a wallet when a deployment is configured. Missing logs show Paid with unresolved evidence.

[Recovery limits](docs/recovery-limitations.md) explain unknown hashes, replacements, browser-close/clear-storage limits and RPC gaps. No automatic resubmission/next step, background process or cross-device recovery is promised. Unsolicited transfers to SplitLink are unsupported and cannot be rescued. Canonical issuer restrictions can fail payments; gas may still be consumed. Payment proves movement, not work delivery or identity.

No backend, database, escrow, administrator, fees, expiry, partial payments, refunds, subscriptions, cross-chain flow or relayer.
