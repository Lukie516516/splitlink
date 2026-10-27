# External post-export candidate validation

This directory is an external continuation of Studio export06-partial, not a completed Studio round3 result. Original Studio build claims are preserved only as historical data in `studio-build-report-preserved.md`. Current executable evidence is generated under `evidence/`; the complete dated report and machine-readable result are `../../studio-local-development-report.md` and `../../studio-local-development-result.json` relative to this document's directory.

The shared production runner, exact journal/evidence verifier, mandatory manifest checks, public reads, mounted recovery activity and incremental history have been externally repaired. TypeScript tests call production modules; browser tests run the mounted app on actual isolated Anvil/ERC20 fixtures. The root reviewed implementation is unchanged. Current pinned dependency audit and reproducible CI belong to this candidate alone.

Unverified: real canonical token operations and Arc protocol balance/gas behavior; all live external wallet replacement UX; real host TLS/routing/CORS; hosted execution of this new CI; event acceptance of mixed provenance; release/mainnet/submission. A local pass does not close those gates. The local package is for independent review, with exact file/digest provenance supplied outside the candidate tree.
