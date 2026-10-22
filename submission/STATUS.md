# Submission status — not submitted

Updated October 22, 2026 (Asia/Shanghai).

The project is SplitLink. User confirmed there is no existing Arc Studio project, event enrollment or source repository. No submission receipt exists. Do not present the local implementation as an already accepted or eligible competition entry.

## Confirmed public sources

The DoraHacks organizer's Eventbrite listing identifies the round as “Arc Microgrants: Built with Arc Studio”, asks builders to start in Studio and finish with a live mainnet app moving real USDC, and lists November 1, 2026 as the submission date. A date in an event listing is not a verified exact cutoff timezone. Source rechecked October 22: https://www.eventbrite.com/e/httpsdorahacksiohackathonarc-microgrants-2detail-tickets-2003559137314?aff=ebdssbdestsearch

Official Studio docs support testnet deployment and GitHub export, and explicitly exclude deploying mainnet on the user's behalf: https://docs.arc.io/ai/arc-studio . The official CLI supports browser device-link login, genuine remote Studio sessions and file round trips: https://docs.arc.io/ai/arc-studio-cli . The present local session does not establish Studio provenance.

The full DoraHacks page currently returns HTTP 405 to both the web reader and direct public HTTPS fetch. Its rules, exact cutoff timezone, accepted external-work/import workflow and entrant requirements have not been authoritatively verified. Third-party summaries are useful leads only, not eligibility approval.

Local browser interaction was unavailable: cua.createBrowserTab returned “Local browser use is disabled in Work settings.” This prevents using an authenticated Studio/DoraHacks browser session through the enabled UI tools. No attempt was made to bypass that setting, create an identity, accept account terms or use a wallet without the user.

## Concrete remaining actions

1. Establish the actual user's Studio and DoraHacks access, verify authoritative rules and obtain the acceptable build/provenance route. Record actual Studio project/build/test/export history. A local upload must not be described as having originally been built there.
2. Use an explicitly controlled and funded testnet wallet to validate canonical USDC and gas semantics; produce a reviewed Arc-ready manifest and separate read/write enablement after evidence. The present code deliberately refuses nonlocal runtime use.
3. Publish reviewed source to an actual public repository and host the production app. Establish actual HTTPS deep-link, fresh-browser and CORS acceptance. No remote is configured yet, so hosted GitHub CI has not run.
4. Review the exact mainnet operation and funding limits, then obtain the user's wallet signatures and record a real controlled settlement. Do not send real funds or imitate a transaction hash merely to fill evidence.
5. Record the genuine Studio/mainnet walkthrough, fill submission/evidence.json with verified links, confirm eligibility/terms and submit using the actual user account. Preserve the real platform submission receipt.

English description and walkthrough are prepared in PROJECT.md and DEMO-SCRIPT.md. Local CI and review acceptance are recorded separately and cannot close these external gates.
