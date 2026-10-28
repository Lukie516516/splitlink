# SplitLink wallet web delivery

Preserves the accepted blue/white wallet interface and enables personally confirmed injected-wallet create/exact-approve/pay for the exact reviewed Arc Testnet deployment. Mainnet, reset and cancel are disabled in this release.

Run this standalone frontend from web/: Node 24, pnpm 11.25.0; pnpm install --frozen-lockfile; pnpm build; pnpm preview. Serve dist with SPA fallback for /create, /pay/* and /receipt/*. .env.production contains public chain configuration only. Never add keys or credentials. The inherited package also lists legacy contract/local-test scripts whose fixtures remain in the repository root; this directory is the frontend delivery.

manifest.json binds the exact 39 reviewed source files (aggregate 0f5766cf5a16eba4114f05c54a8c08b60dd7d7f69716b8c524a00e3de4a0c280) and seven validation artifacts. This README, manifest and independent review are publication metadata outside that source aggregate. Focused independent review PASS: typecheck/build, seven focused synthetic checks and three independent regression groups. No new browser interaction QA, real-wallet transaction, hosting or mainnet acceptance claimed.

The existing Sites address still serves the earlier private preview. Source publication does not publish or transfer that Site. Restore the original owner account before a reviewed Site update.

Real Testnet deployment, Request1 creation and allowance10001 exist; actual Request1 payment, mainnet flow, public final app, video and submission receipt remain pending. Studio export06 was partial, with substantial later external work; contest eligibility is unresolved and must be disclosed.
