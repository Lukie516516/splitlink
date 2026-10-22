# Recovery limits

The same-origin transaction journal is a convenience, not a background service, custody system or cross-device sync. Clearing storage, private browsing, another browser/device or storage quota denial can lose attempts. Storage failure is shown explicitly; a known hash stays visible in the live page. An interrupted prompt without a saved hash remains unknown. Check wallet activity before trying again. Unknown requests are not automatically resent.

The app polls only while active and reconciles on reopening/focus. Public request/history reads do not need a wallet. Public history recovery depends on usable RPC logs from the deployment block. My requests is reconstructed from chain; labels are not an index of everything in a wallet.

JSON-RPC does not universally support sender+nonce lookup. A higher nonce cannot identify the call. While the current page is waiting, viem's replacement callback offers candidates which are independently verified; reopening may lack that callback/candidate. Unknown attempts remain visible. No automatic signing, approval, reset, payment or resubmission occurs.

`confirmed` means successful execution only; `businessVerification=verified` separately establishes the expected result. A successful cancellation whose status read fails remains unverified. The canonical payer can differ from the current wallet and the local attempt. The receipt screen never uses an approval/failed/unrelated attempt hash as settlement proof.

An RPC failure is unknown, not a zero balance, unpaid request, empty history or failed transaction. Successful simulations cannot prevent another wallet's payment/cancellation or unrelated spending before execution. Wallet gas overrides can change the final cap; the wallet remains responsible for final fee validation.

Unsolicited transfers to SplitLink are unsupported. There is no rescue/withdrawal mechanism. Canonical issuer controls may reject transfers. Settlement proves payment, not delivery, verified identity or legal acceptance.
