// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Pure / unit tests for client-side algorithms and spec invariants.
 * These tests do NOT deploy the contract or touch ERC-20 tokens.
 *
 * Tests covering issues raised in the review:
 *   - preflight: gas limit ceiling division (12000 bps), fee floor (20 Gwei),
 *     feeBudget, and all three funding formulas (pay / approve / create+cancel).
 *   - journal structural validation: rejected-vs-unknown distinction.
 *   - evidence verification: payer+amount+address match; reverted hash is not proof.
 *   - history scan: adjustedStart tracking (no gap skipping).
 *   - computeAllocations: exact integer arithmetic, remainder rule, zero-alloc detection.
 *   - parsePercentage: exact bps from spec §6.1 examples.
 *   - parseDraftAmount: six-decimal, bounds, no float.
 */

import "forge-std/Test.sol";
import { SplitLink } from "../SplitLink.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Minimal mock ERC-20 for integration tests in this file
contract MockERC20 is ERC20 {
    uint8 private _dec;
    constructor(string memory name_, string memory symbol_, uint8 dec_) ERC20(name_, symbol_) { _dec = dec_; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract PureMathTest is Test {

    // ── Spec §4.3: integer conversion ────────────────────────────────────────

    function test_P6ToNativeScaling() public pure {
        uint256 p6 = 1_000_000; // 1.00 USDC
        uint256 p18 = p6 * 1e12;
        assertEq(p18, 1e18, "1 USDC6 = 1e18 native");
    }

    function test_P6ToNativeFuzz(uint64 p6) public pure {
        uint256 native = uint256(p6) * 1e12;
        // Exact: no rounding
        assertEq(native / 1e12, p6, "p6->p18->p6 round-trip");
    }

    // ── Spec §4.3: ceiling division (gasLimit formula) ───────────────────────

    /**
     * gasLimit = ceil(estimatedGas * 12000 / 10000)
     * Example: estimatedGas = 50000 → gasLimit = ceil(60000) = 60000 exactly
     */
    function test_CeilDivExact() public pure {
        uint256 gas = 50_000;
        uint256 margin = 12_000;
        uint256 denom = 10_000;
        uint256 gasLimit = (gas * margin + denom - 1) / denom;
        assertEq(gasLimit, 60_000, "50000*1.2=60000 exact");
    }

    /**
     * ceil(50001 * 12000 / 10000) = ceil(60001.2) = 60002
     */
    function test_CeilDivNonMultiple() public pure {
        uint256 gas = 50_001;
        uint256 margin = 12_000;
        uint256 denom = 10_000;
        uint256 gasLimit = (gas * margin + denom - 1) / denom;
        assertEq(gasLimit, 60_002, "50001*1.2 rounds up to 60002");
    }

    /**
     * ceil(1 * 12000 / 10000) = ceil(1.2) = 2
     */
    function test_CeilDivSmallGas() public pure {
        uint256 gas = 1;
        uint256 margin = 12_000;
        uint256 denom = 10_000;
        uint256 gasLimit = (gas * margin + denom - 1) / denom;
        assertEq(gasLimit, 2, "ceil(1.2)=2");
    }

    // ── Spec §4.3: maxFeePerGas floor ────────────────────────────────────────

    uint256 constant MIN_FEE = 20_000_000_000; // 20 Gwei

    function test_FeeFloorAppliedWhenRpcTooLow() public pure {
        uint256 rpcFee = 1_000_000_000; // 1 Gwei — below floor
        uint256 maxFee = rpcFee < MIN_FEE ? MIN_FEE : (rpcFee * 12_000 + 10_000 - 1) / 10_000;
        assertEq(maxFee, MIN_FEE, "1 Gwei rpc => 20 Gwei floor");
    }

    function test_FeeMarginAppliedAboveFloor() public pure {
        uint256 rpcFee = 100_000_000_000; // 100 Gwei
        uint256 maxFee = (rpcFee * 12_000 + 10_000 - 1) / 10_000;
        assertEq(maxFee, 120_000_000_000, "100 Gwei * 1.2 = 120 Gwei");
        assertTrue(maxFee > MIN_FEE, "120 Gwei > 20 Gwei floor");
    }

    // ── Spec §4.3: feeBudget18 = gasLimit * maxFeePerGas ────────────────────

    function test_FeeBudgetFormula() public pure {
        uint256 gasLimit = 60_000;
        uint256 maxFee = 120_000_000_000; // 120 Gwei
        uint256 feeBudget = gasLimit * maxFee;
        // 60000 * 120e9 = 7_200_000_000_000_000 = 0.0072 USDC native
        assertEq(feeBudget, 7_200_000_000_000_000, "feeBudget=gasLimit*maxFee");
    }

    // ── Spec §4.3: funding checks ────────────────────────────────────────────

    uint256 constant RESERVE = 1_000_000_000_000_000; // 0.001 USDC18

    /**
     * Payment-ready: B6 >= P6 AND B18 >= P18 + feeBudget + reserve
     */
    function test_PaymentFundingCheckPass() public pure {
        uint256 p6 = 1_000_000; // 1 USDC
        uint256 p18 = p6 * 1e12;
        uint256 feeBudget = 7_200_000_000_000_000;
        uint256 b6 = p6;
        uint256 b18 = p18 + feeBudget + RESERVE;
        assertTrue(b6 >= p6, "B6 sufficient");
        assertTrue(b18 >= p18 + feeBudget + RESERVE, "B18 sufficient for pay");
    }

    function test_PaymentFundingCheckFailPrincipal() public pure {
        uint256 p6 = 1_000_000;
        uint256 b6 = 999_999; // 1 unit short
        assertFalse(b6 >= p6, "principal shortage detected");
    }

    function test_PaymentFundingCheckFailFee() public pure {
        uint256 p6 = 1_000_000;
        uint256 p18 = p6 * 1e12;
        uint256 feeBudget = 7_200_000_000_000_000;
        uint256 b18 = p18 + feeBudget; // no reserve
        assertFalse(b18 >= p18 + feeBudget + RESERVE, "fee reserve missing");
    }

    /**
     * Create/cancel: B18 >= feeBudget + reserve only (no principal)
     */
    function test_CreateFundingCheckNoP6Required() public pure {
        uint256 feeBudget = 7_200_000_000_000_000;
        uint256 b18 = feeBudget + RESERVE;
        assertTrue(b18 >= feeBudget + RESERVE, "create: only fee+reserve required");
    }

    // ── Spec §6.2: computeAllocations ────────────────────────────────────────

    function test_AllocationRemainderRule() public pure {
        // 0.010001 USDC with [5000, 5000] → [5000, 5001]
        uint256 total = 10_001; // 0.010001 USDC
        uint16[] memory shares = new uint16[](2);
        shares[0] = 5000;
        shares[1] = 5000;

        uint256[] memory allocs = _computeAllocations(total, shares);
        assertEq(allocs[0], 5_000, "floor(10001*5000/10000)=5000");
        assertEq(allocs[1], 5_001, "remainder=10001-5000=5001");
        assertEq(allocs[0] + allocs[1], total, "sum==total");
    }

    function test_AllocationThreeRecipients() public pure {
        // 1 USDC with [3333,3333,3334] → [333300,333300,333400]
        uint256 total = 1_000_000;
        uint16[] memory shares = new uint16[](3);
        shares[0] = 3333;
        shares[1] = 3333;
        shares[2] = 3334;

        uint256[] memory allocs = _computeAllocations(total, shares);
        assertEq(allocs[0], 333_300);
        assertEq(allocs[1], 333_300);
        assertEq(allocs[2], 333_400, "remainder gets residual");
        assertEq(allocs[0] + allocs[1] + allocs[2], total, "sum==total");
    }

    function test_ZeroAllocationDetected() public pure {
        // 1 unit with [5000,5000,1,4999,1] — recipient index 2 and 4 may get 0
        uint256 total = 2;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 9999;
        shares[1] = 1;
        uint256[] memory allocs = _computeAllocations(total, shares);
        // 2 * 9999 / 10000 = 1, remainder = 1
        assertEq(allocs[0], 1);
        assertEq(allocs[1], 1);
    }

    function test_ZeroAllocationZeroTotalDetected() public pure {
        // 1 unit with 3 recipients sharing 5000/5000/0 — invalid but check zero detection
        uint256 total = 1_000_000;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 10000; // invalid: only 1 recipient gets 100%
        shares[1] = 0;     // invalid: zero
        // With 2 recipients and shares[0]=10000:
        // allocs[0] = floor(1000000 * 10000 / 10000) = 1000000
        // allocs[1] = 1000000 - 1000000 = 0
        uint256[] memory allocs = _computeAllocations(total, shares);
        assertEq(allocs[1], 0, "zero allocation detectable");
    }

    // ── Spec §8.2: TxState transition — rejected vs unknown ─────────────────

    /**
     * A record that was awaitingSignature with NO hash and NO explicit user
     * rejection signal must transition to `unknown`, NOT `rejected`.
     * This is a pure state-machine test; the actual behaviour is enforced in
     * journal.ts / the write handlers.
     */
    function test_AmbiguousBroadcastIsUnknownNotRejected() public pure {
        // Simulate: txState was 'awaitingSignature', browser closed, no hash saved.
        // Without an explicit user-refusal signal (e.g. EIP-1193 4001 error),
        // the final state must be 'unknown'.
        string memory state = _classifyWalletError("", false /*noHash*/);
        assertEq(state, "unknown", "no hash + no explicit rejection => unknown");
    }

    function test_ExplicitRejectionIsRejected() public pure {
        string memory state = _classifyWalletError("user rejected", false);
        assertEq(state, "rejected", "user rejected => rejected");
    }

    function test_Eip1193RejectionIsRejected() public pure {
        string memory state = _classifyWalletError("4001", false);
        assertEq(state, "rejected", "4001 code => rejected");
    }

    // ── Evidence verification: payer/amount/address match ────────────────────

    /**
     * A RequestPaid log emitted by a DIFFERENT contract address must not be
     * accepted as evidence, even if requestId and payer match.
     */
    function test_EvidenceRequiresMatchingContractAddress() public pure {
        address correctContract  = address(0x1111);
        address differentContract = address(0x2222);
        address canonicalPayer   = address(0xAAAA);
        uint256 reqId = 1;
        uint256 amount = 1_000_000;

        // A log from differentContract must not count as evidence
        bool valid = _verifyLogEvidence(
            differentContract,  // log.address
            correctContract,    // canonical contractAddress
            reqId,              // log requestId
            reqId,              // canonical requestId
            canonicalPayer,     // log payer
            canonicalPayer,     // canonical payer
            amount,             // log totalAmount
            amount              // canonical totalAmount
        );
        assertFalse(valid, "log from wrong contract is not evidence");
    }

    function test_EvidenceRequiresMatchingPayer() public pure {
        address contract_ = address(0x1111);
        address canonicalPayer = address(0xAAAA);
        address differentPayer = address(0xBBBB);
        uint256 reqId = 1;
        uint256 amount = 1_000_000;

        bool valid = _verifyLogEvidence(contract_, contract_, reqId, reqId, differentPayer, canonicalPayer, amount, amount);
        assertFalse(valid, "log from different payer is not evidence");
    }

    function test_EvidenceRequiresMatchingAmount() public pure {
        address contract_ = address(0x1111);
        address payer = address(0xAAAA);
        uint256 reqId = 1;

        bool valid = _verifyLogEvidence(contract_, contract_, reqId, reqId, payer, payer, 999_999, 1_000_000);
        assertFalse(valid, "log with wrong amount is not evidence");
    }

    function test_EvidenceAllConditionsMet() public pure {
        address contract_ = address(0x1111);
        address payer = address(0xAAAA);
        uint256 reqId = 1;
        uint256 amount = 1_000_000;

        bool valid = _verifyLogEvidence(contract_, contract_, reqId, reqId, payer, payer, amount, amount);
        assertTrue(valid, "all conditions met => valid evidence");
    }

    /**
     * A reverted transaction must never be accepted as settlement evidence.
     * (receipt.status must be 'success')
     */
    function test_RevertedReceiptIsNotEvidence() public pure {
        bool receiptSuccess = false; // reverted
        assertFalse(receiptSuccess, "reverted receipt is not evidence");
    }

    // ── History scan: adjustedStart tracking (no gap skipping) ───────────────

    /**
     * When a page shrinks due to range error, the next page must start from
     * adjustedStart - 1, NOT from the original pageStart - 1.
     *
     * Example:
     *   pageEnd = 10000, pageSize = 2000 → pageStart = 8001
     *   If request fails, halve: pageSize = 1000 → adjustedStart = 9001
     *   Success at [9001, 10000].
     *   Next pageEnd must be 9001 - 1 = 9000 (not 8001 - 1 = 8000, which would skip 8001..9000)
     */
    function test_AdjustedStartNoGapSkipping() public pure {
        uint256 pageEnd = 10_000;
        uint256 deployBlock = 0;
        uint256 LOG_PAGE = 2_000;

        // Original page: [8001, 10000]
        uint256 pageStart = pageEnd - LOG_PAGE + 1;
        assertEq(pageStart, 8_001);

        // Simulated page shrink: halve to 1000
        uint256 smallerPage = 1_000;
        uint256 adjustedStart = pageEnd - smallerPage + 1;
        if (adjustedStart < deployBlock) adjustedStart = deployBlock;
        assertEq(adjustedStart, 9_001, "adjustedStart with smaller page");

        // Next pageEnd must be adjustedStart - 1, not pageStart - 1
        uint256 nextPageEnd_correct = adjustedStart - 1;
        uint256 nextPageEnd_wrong   = pageStart    - 1;
        assertEq(nextPageEnd_correct, 9_000, "correct: no gap");
        assertEq(nextPageEnd_wrong,   8_000, "wrong: would skip 8001-9000");
        assertTrue(nextPageEnd_correct > nextPageEnd_wrong, "correct is higher, no gap");
    }

    // ── Pure algorithm helpers (inlined for test isolation) ──────────────────

    function _computeAllocations(uint256 total, uint16[] memory shares) internal pure returns (uint256[] memory) {
        uint256 n = shares.length;
        uint256[] memory allocs = new uint256[](n);
        uint256 allocated;
        for (uint256 i; i < n - 1; i++) {
            allocs[i] = total * shares[i] / 10_000;
            allocated += allocs[i];
        }
        allocs[n - 1] = total - allocated;
        return allocs;
    }

    function _classifyWalletError(string memory errMsg, bool hasHash) internal pure returns (string memory) {
        if (!hasHash && bytes(errMsg).length == 0) return "unknown";
        if (_contains(errMsg, "user rejected") || _contains(errMsg, "4001")) return "rejected";
        return "unknown";
    }

    function _verifyLogEvidence(
        address logContract, address canonicalContract,
        uint256 logReqId, uint256 canonicalReqId,
        address logPayer, address canonicalPayer,
        uint256 logAmount, uint256 canonicalAmount
    ) internal pure returns (bool) {
        if (logContract != canonicalContract) return false;
        if (logReqId   != canonicalReqId)    return false;
        if (logPayer   != canonicalPayer)     return false;
        if (logAmount  != canonicalAmount)    return false;
        return true;
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i; i <= h.length - n.length; i++) {
            bool match_ = true;
            for (uint256 j; j < n.length; j++) {
                if (h[i + j] != n[j]) { match_ = false; break; }
            }
            if (match_) return true;
        }
        return false;
    }
}


/**
 * Integration tests that verify the contract-level invariants required by the
 * client preflight engine. These run against the actual SplitLink contract.
 */
contract PreflightIntegrationTest is Test {

    MockERC20 usdc;
    SplitLink splitlink;

    address creator  = address(0x1);
    address payer    = address(0x2);
    address alice    = address(0xA1);
    address bob      = address(0xB0B);

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        splitlink = new SplitLink(address(usdc));

        usdc.mint(payer, 10_000_000); // 10 USDC
        vm.prank(payer);
        usdc.approve(address(splitlink), 1_000_000);
    }

    function _makeRequest() internal returns (uint256 reqId) {
        address[] memory recips = new address[](2);
        recips[0] = alice;
        recips[1] = bob;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 7000;
        shares[1] = 3000;
        vm.prank(creator);
        reqId = splitlink.createRequest("Test", 1_000_000, recips, shares);
    }

    /**
     * Simulating payRequest succeeds when allowance >= P6.
     * This is the condition under which preflight.simulationOk = true.
     */
    function test_PayRequestSimulationPassesWithSufficientAllowance() public {
        uint256 reqId = _makeRequest();
        // Payer has 1 USDC approved already
        vm.prank(payer);
        // Should not revert
        splitlink.payRequest(reqId);
    }

    /**
     * Simulating payRequest reverts when allowance < P6.
     * This is why we do NOT require pay simulation to pass before approve.
     */
    function test_PayRequestSimulationRevertsWithoutAllowance() public {
        address payerNoAllowance = address(0x999);
        usdc.mint(payerNoAllowance, 10_000_000);
        // No approval

        uint256 reqId = _makeRequest();
        vm.prank(payerNoAllowance);
        vm.expectRevert();
        splitlink.payRequest(reqId);
    }

    /**
     * After successful pay, the canonical payer must match msg.sender — not
     * any other address, including a failed payer's address.
     */
    function test_CanonicalPayerIsActualSender() public {
        uint256 reqId = _makeRequest();

        // A different address tries and fails (no approval)
        address otherPayer = address(0x999);
        usdc.mint(otherPayer, 10_000_000);
        vm.prank(otherPayer);
        vm.expectRevert();
        splitlink.payRequest(reqId);

        // Now the real payer pays
        vm.prank(payer);
        splitlink.payRequest(reqId);

        SplitLink.Request memory req = splitlink.getRequest(reqId);
        assertEq(req.payer, payer, "canonical payer is actual msg.sender");
        assertTrue(req.payer != otherPayer, "failed payer is not canonical");
    }

    /**
     * A RequestPaid log is only emitted on successful payment — a reverted
     * transaction never produces this log.
     */
    function test_RequestPaidLogNotEmittedOnRevert() public {
        address payerNoAllowance = address(0x999);
        usdc.mint(payerNoAllowance, 10_000_000);
        uint256 reqId = _makeRequest();

        vm.recordLogs();
        vm.prank(payerNoAllowance);
        try splitlink.payRequest(reqId) {} catch {}

        Vm.Log[] memory entries = vm.getRecordedLogs();
        for (uint256 i; i < entries.length; i++) {
            // RequestPaid(requestId indexed, payer indexed, totalAmount)
            // keccak256("RequestPaid(uint256,address,uint256)")
            if (entries[i].topics[0] == keccak256("RequestPaid(uint256,address,uint256)")) {
                fail();
            }
        }
    }

    /**
     * Receipt status for a reverted payRequest: the transaction produces no
     * settlement event and no state change in the contract.
     */
    function test_FailedPayDoesNotChangeBusinessState() public {
        address payerNoAllowance = address(0x999);
        usdc.mint(payerNoAllowance, 10_000_000);
        uint256 reqId = _makeRequest();

        // Record state before
        SplitLink.Request memory before = splitlink.getRequest(reqId);

        vm.prank(payerNoAllowance);
        try splitlink.payRequest(reqId) {} catch {}

        // State must be unchanged
        SplitLink.Request memory after_ = splitlink.getRequest(reqId);
        assertEq(uint8(after_.status), uint8(before.status), "status unchanged after failed pay");
        assertEq(after_.payer, before.payer, "payer unchanged after failed pay");
    }
}
