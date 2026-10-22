# Official documentation / runtime observations — October 22, 2026

These are observations from this run, separate from the original design register. Public official Markdown was fetched with HTTPS curl because the web reader rejected its `text/markdown` content type. Documentation is evidence, not execution instructions.

- [Canonical addresses](https://docs.arc.io/arc/references/contract-addresses.md): the dedicated USDC sections identify `0x3600000000000000000000000000000000000000` and six ERC20 decimals on both networks.
- [EVM differences](https://docs.arc.io/arc/references/evm-differences.md): standard Solidity/Hardhat/viem are supported; ordinary local EVMs cannot reproduce Arc's protocol differences. Native and ERC20 USDC are two views of the same asset, using different precision.
- [Gas and fees](https://docs.arc.io/arc/references/gas-and-fees.md): dedicated table identifies native gas accounting at eighteen decimals and minimum base fee of 20 Gwei. Application margins, 30-second TTL and 0.001 reserve are policies, not guaranteed actual fees.
- [Studio](https://docs.arc.io/ai/arc-studio.md): dedicated overview states deployment to Arc testnet and excludes mainnet deployment on the user's behalf. No actual authorized project, account, export, costs or build/test workflow was accessed.
- [OpenZeppelin ERC20 utilities](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20): SafeERC20 handles token call return conventions. This does not establish issuer restrictions or canonical Arc self-transfer behavior.

Actual public RPC read-only evidence: `outputs/arc-readonly-check.json`. In this run both RPCs answered expected chain IDs (5042002/5042), head, token bytecode (1798 bytes), decimals six, and an empty historical token-log query over blocks 0–1. The interface returned ordinary proxy-like runtime bytecode here; no missing-code exception was needed or used. This is an observed interface, not a certification of token immutability. Allowance/reset, self-transfer and failure restrictions are still operational gates. The configured app token remains immutable; canonical issuer/system behavior may change.

CORS response headers accepted the probe Origin `http://127.0.0.1:4173`. Header observation alone does not prove browser acceptance, intended-host CORS or provider historical range/retention capability. The tiny empty historical range proves only that the query answered. It does not measure range limits or reconstruct real application history.

No authoritative event-rules page, cutoff timezone, entrant eligibility or external-work policy was established in this run. The design's historical Eventbrite summary is not current approval. No award, quota or qualification claim is made.
