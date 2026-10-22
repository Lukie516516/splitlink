# SplitLink — submission draft (not submitted)

SplitLink is a single-use USDC payment link for teams of two to five. A customer pays one fixed total; an immutable smart contract transfers each ordered allocation directly from the payer to its recipient in one atomic transaction. The platform fee is zero. Anyone can inspect the public terms and a successful settlement receipt without connecting a wallet.

The client preserves exact percentage inputs, displays six-decimal allocations and the final-recipient rounding remainder, distinguishes approvals from payments, and identifies the canonical payer independently from the current browser's attempt. Creators can discover their requests from indexed chain events and cancel open requests. Transaction recovery is local to the browser and never automatically resubmits.

Current status: local implementation and local mock validation. Real Arc integration, Studio provenance, public hosting, eligibility and mainnet evidence remain pending. Standard local EVM mocks do not prove Arc USDC self-transfer, reset or shared funding behavior.

Fields to complete only with actual evidence: entrant eligibility; verified rules/cutoff timezone; Studio app URL and provenance; reviewed export revision; public repository/app URL; reviewed contract/deployment block; canonical-token testnet and authorized mainnet settlement hashes; video; verification and payment terms. These values are intentionally absent, not sample evidence.
