# SplitLink live wallet application

This directory matches the runtime source published as Site version 9 on 2026-10-29 (Site source commit `960884a6e1306f0d42816b43e963e3eb53e0588c`).

- Public app: https://splitlink.wiryfig6.chatgpt.site
- Mainnet contract (chain 5042): `0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010`
- Verified actual Request 1 payment: https://explorer.arc.io/tx/0x2d8daad1340b548fc101745ba159bfcf1fcead6c365ccf8499f02bbb18a829d1
- Request: https://splitlink.wiryfig6.chatgpt.site/pay/5042/0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010/1

## Run

Use Node 24 and pnpm 11.25.0. From `web/`: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm preview`. Host `dist/` with SPA fallback for `/create`, `/pay/*`, and `/receipt/*`. `.env.production` contains public chain configuration only. Never add wallet files, passwords, keys, tokens or local transaction journals.

`pnpm typecheck` and `node checks/run.mjs` cover the frontend and focused regressions. `node checks/run.mjs --public-readonly` only reads chain identity. `--preview-timing` was the recorded approve-preview diagnostic before settlement; it is state-dependent and should not be used as a post-payment acceptance test. Legacy contract/test scripts in package.json refer to the repository root fixtures; this directory is the browser frontend.

## Current behavior

The accepted blue/white interface supports wallet connection, create/share, exact total approval, payment preview and canonical receipt recovery. Mainnet is the default; existing Testnet routes keep their chain. Reset and cancel stay disabled. RPC reads use bounded JSON-RPC batches, serialized transport, cooldown on explicit rate limit, and reduced background polling. Prior funded-wallet transactions are located without scanning every 2,000-block range.

Before requesting the wallet, the app rechecks chain/account/request/nonce/simulation/funding. Live gas and fee requirements may move inside the exact reviewed transaction envelope; it never automatically raises that envelope. The 30-second quote deadline is checked before handing the transaction to the wallet. Fee recheck, wallet confirmation and chain confirmation are displayed separately. Unknown outcomes retain records and do not automatically re-sign or resend.

The funded demonstration has a finite nonce1 create / nonce2 exact approve / nonce3 pay sequence, gross 0.010001 USDC and gas cap 0.02 USDC per operation. It has now completed. Incoming funds or cleared browser storage do not authorize repeating this project-wallet sequence. Other wallets use their own funds. The app cannot constrain unrelated wallet actions or fee overrides made by the wallet owner.

## Evidence and limitations

`RELEASE-MANIFEST-20261029.json` binds the current source blobs. Older `manifest.json`, report and independent review files describe their dated candidate snapshots; they are retained as history and do not claim a new independent review of this release. Latest local validation: typecheck/build and 16 focused checks passed. The batched public-readonly approval preview measured 5,808 ms; the browser review was observed within 12,369 ms. These are observations, not latency guarantees or live-signature benchmarks.

`evidence/live-release-20261029.json` links genuine deployment/create/approve/pay transactions and records settlement verification. Full canonical acceptance and whole-block balance attribution are not inferred from these tests. Genuine video and personal final submission remain pending. Studio export06 was partial; later remediation and interface changes were external supplements, and organizer acceptance has not been established.
