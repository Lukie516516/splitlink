// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SplitLink
/// @notice Fixed-amount, single-use USDC payment requests distributed atomically to 2-5 recipients.
///         No platform fee, escrow, or upgradability.
/// @dev Design spec: SplitLink v1.1. All monetary values are six-decimal USDC base units.
contract SplitLink is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutables ────────────────────────────────────────────────────────────
    IERC20 public immutable USDC;

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_AMOUNT = 10_000;          // 0.01 USDC (6 decimals)
    uint256 public constant MAX_AMOUNT = 1_000_000_000_000; // 1,000,000 USDC (6 decimals)
    uint256 public constant MAX_RECIPIENTS = 5;
    string  public constant CONTRACT_VERSION = "1.0.0";

    // ── Enums ─────────────────────────────────────────────────────────────────
    enum RequestStatus { None, Open, Paid, Cancelled }

    // ── Storage ───────────────────────────────────────────────────────────────
    struct Request {
        address   creator;
        string    title;
        uint256   totalAmount;
        address[] recipients;
        uint16[]  sharesBps;
        RequestStatus status;
        uint64    createdAt;
        address   payer;
        uint64    paidAt;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) private _requests;

    // ── Events ────────────────────────────────────────────────────────────────
    event RequestCreated(
        uint256 indexed requestId,
        address indexed creator,
        uint256 totalAmount
    );
    event RecipientPaid(
        uint256 indexed requestId,
        address indexed recipient,
        uint256 amount
    );
    event RequestPaid(
        uint256 indexed requestId,
        address indexed payer,
        uint256 totalAmount
    );
    event RequestCancelled(
        uint256 indexed requestId,
        address indexed creator
    );

    // ── Custom Errors ─────────────────────────────────────────────────────────
    error RequestNotFound(uint256 requestId);
    error InvalidTitle();
    error InvalidAmount();
    error InvalidRecipientCount();
    error ArrayLengthMismatch();
    error InvalidAddress(address addr);
    error DuplicateRecipient(address addr);
    error InvalidShares();
    error ZeroAllocation(uint256 recipientIndex);
    error RequestNotOpen(uint256 requestId, RequestStatus status);
    error UnauthorizedCancellation();
    error NativeValueNotAccepted();

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address usdc_) {
        require(usdc_ != address(0), "SplitLink: zero usdc");
        USDC = IERC20(usdc_);
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /// @notice Create a fixed-amount payment request.
    /// @param title      1–120 UTF-8 bytes; public title (permanently on-chain).
    /// @param totalAmount Six-decimal USDC amount; [0.01, 1,000,000] USDC.
    /// @param recipients  2–5 ordered, unique, nonzero addresses; not address(this).
    /// @param sharesBps   Same length as recipients; each positive; sum exactly 10,000.
    /// @return requestId  Unique ID starting from 1.
    function createRequest(
        string calldata title,
        uint256 totalAmount,
        address[] calldata recipients,
        uint16[] calldata sharesBps
    ) external nonReentrant returns (uint256 requestId) {
        // Title: 1–120 UTF-8 bytes
        {
            uint256 tlen = bytes(title).length;
            if (tlen == 0 || tlen > 120) revert InvalidTitle();
        }

        // Amount bounds
        if (totalAmount < MIN_AMOUNT || totalAmount > MAX_AMOUNT) revert InvalidAmount();

        // Recipient count: 2–5
        uint256 n = recipients.length;
        if (n < 2 || n > MAX_RECIPIENTS) revert InvalidRecipientCount();

        // Array lengths match
        if (sharesBps.length != n) revert ArrayLengthMismatch();

        // Validate each address and check uniqueness
        for (uint256 i = 0; i < n; ) {
            address r = recipients[i];
            if (r == address(0) || r == address(this)) revert InvalidAddress(r);
            for (uint256 j = 0; j < i; ) {
                if (recipients[j] == r) revert DuplicateRecipient(r);
                unchecked { ++j; }
            }
            unchecked { ++i; }
        }

        // Validate shares: each positive; total exactly 10,000
        uint256 shareSum;
        for (uint256 i = 0; i < n; ) {
            if (sharesBps[i] == 0) revert InvalidShares();
            shareSum += sharesBps[i];
            unchecked { ++i; }
        }
        if (shareSum != BPS_DENOMINATOR) revert InvalidShares();

        // Validate no zero allocation
        uint256 allocated;
        for (uint256 i = 0; i < n - 1; ) {
            uint256 alloc = (totalAmount * sharesBps[i]) / BPS_DENOMINATOR;
            if (alloc == 0) revert ZeroAllocation(i);
            allocated += alloc;
            unchecked { ++i; }
        }
        // Final recipient gets remainder
        if (totalAmount - allocated == 0) revert ZeroAllocation(n - 1);

        requestId = nextRequestId++;
        Request storage req = _requests[requestId];
        req.creator     = msg.sender;
        req.title       = title;
        req.totalAmount = totalAmount;
        req.status      = RequestStatus.Open;
        req.createdAt   = uint64(block.timestamp);

        // Copy arrays
        for (uint256 i = 0; i < n; ) {
            req.recipients.push(recipients[i]);
            req.sharesBps.push(sharesBps[i]);
            unchecked { ++i; }
        }

        emit RequestCreated(requestId, msg.sender, totalAmount);
    }

    /// @notice Pay an open request. Transfers USDC directly from caller to each recipient atomically.
    /// @param requestId  The request to pay.
    function payRequest(uint256 requestId) external nonReentrant {
        Request storage req = _requests[requestId];
        if (req.status == RequestStatus.None) revert RequestNotFound(requestId);
        if (req.status != RequestStatus.Open) revert RequestNotOpen(requestId, req.status);

        uint256 n = req.recipients.length;
        uint256 totalAmount = req.totalAmount;

        // Compute allocations
        uint256[] memory allocations = new uint256[](n);
        uint256 allocated;
        for (uint256 i = 0; i < n - 1; ) {
            allocations[i] = (totalAmount * req.sharesBps[i]) / BPS_DENOMINATOR;
            allocated += allocations[i];
            unchecked { ++i; }
        }
        allocations[n - 1] = totalAmount - allocated;

        // Set state BEFORE external calls (CEI pattern)
        req.status = RequestStatus.Paid;
        req.payer  = msg.sender;
        req.paidAt = uint64(block.timestamp);

        // Transfer to each recipient
        for (uint256 i = 0; i < n; ) {
            USDC.safeTransferFrom(msg.sender, req.recipients[i], allocations[i]);
            emit RecipientPaid(requestId, req.recipients[i], allocations[i]);
            unchecked { ++i; }
        }

        emit RequestPaid(requestId, msg.sender, totalAmount);
    }

    /// @notice Cancel an open request. Creator only.
    /// @param requestId  The request to cancel.
    function cancelRequest(uint256 requestId) external nonReentrant {
        Request storage req = _requests[requestId];
        if (req.status == RequestStatus.None) revert RequestNotFound(requestId);
        if (req.status != RequestStatus.Open) revert RequestNotOpen(requestId, req.status);
        if (req.creator != msg.sender) revert UnauthorizedCancellation();

        req.status = RequestStatus.Cancelled;
        emit RequestCancelled(requestId, msg.sender);
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /// @notice Read all fields for a request.
    function getRequest(uint256 requestId) external view returns (Request memory) {
        if (_requests[requestId].status == RequestStatus.None) revert RequestNotFound(requestId);
        return _requests[requestId];
    }

    /// @notice Compute allocations for a request using the spec's exact integer algorithm.
    ///         Works for any status.
    function getAllocations(uint256 requestId) external view returns (uint256[] memory allocations) {
        Request storage req = _requests[requestId];
        if (req.status == RequestStatus.None) revert RequestNotFound(requestId);

        uint256 n = req.recipients.length;
        allocations = new uint256[](n);
        uint256 allocated;
        for (uint256 i = 0; i < n - 1; ) {
            allocations[i] = (req.totalAmount * req.sharesBps[i]) / BPS_DENOMINATOR;
            allocated += allocations[i];
            unchecked { ++i; }
        }
        allocations[n - 1] = req.totalAmount - allocated;
    }

    // ── Safety ────────────────────────────────────────────────────────────────

    /// @dev Reject any accidental native-value sends.
    receive() external payable {
        revert NativeValueNotAccepted();
    }

    fallback() external payable {
        revert NativeValueNotAccepted();
    }
}
