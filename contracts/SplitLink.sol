// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Immutable public, single-use, atomic USDC split requests. No custody or administrator.
contract SplitLink is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable USDC;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MIN_AMOUNT = 10000;
    uint256 public constant MAX_AMOUNT = 1000000000000;
    uint256 public constant MAX_RECIPIENTS = 5;
    uint256 public nextRequestId = 1;
    enum Status { None, Open, Paid, Cancelled }
    struct Request {
        address creator;
        string title;
        uint256 totalAmount;
        address[] recipients;
        uint16[] sharesBps;
        Status status;
        uint64 createdAt;
        address payer;
        uint64 paidAt;
    }
    mapping(uint256 => Request) private requests;
    error RequestNotFound();
    error InvalidTitle();
    error InvalidAmount();
    error InvalidRecipientCount();
    error InvalidRecipient();
    error DuplicateRecipient();
    error ArrayMismatch();
    error InvalidShares();
    error ZeroAllocation();
    error RequestNotOpen();
    error UnauthorizedCancellation();
    error InvalidToken();
    event RequestCreated(uint256 indexed requestId, address indexed creator, uint256 totalAmount);
    event RecipientPaid(uint256 indexed requestId, address indexed recipient, uint256 amount);
    event RequestPaid(uint256 indexed requestId, address indexed payer, uint256 totalAmount);
    event RequestCancelled(uint256 indexed requestId, address indexed creator);
    constructor(address token) {
        if (token == address(0) || token == address(this)) revert InvalidToken();
        // Arc's canonical system ERC-20 may not have ordinary deployed bytecode.
        USDC = IERC20(token);
    }
    function createRequest(string calldata title, uint256 totalAmount, address[] calldata recipients, uint16[] calldata sharesBps) external nonReentrant returns (uint256 id) {
        if (bytes(title).length == 0 || bytes(title).length > 120) revert InvalidTitle();
        if (totalAmount < MIN_AMOUNT || totalAmount > MAX_AMOUNT) revert InvalidAmount();
        uint256 n = recipients.length;
        if (n < 2 || n > MAX_RECIPIENTS) revert InvalidRecipientCount();
        if (n != sharesBps.length) revert ArrayMismatch();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (recipients[i] == address(0) || recipients[i] == address(this)) revert InvalidRecipient();
            for (uint256 j; j < i; ++j) if (recipients[i] == recipients[j]) revert DuplicateRecipient();
            if (sharesBps[i] == 0) revert InvalidShares();
            sum += sharesBps[i];
        }
        if (sum != BPS_DENOMINATOR) revert InvalidShares();
        _allocate(totalAmount, sharesBps);
        id = nextRequestId++;
        requests[id] = Request(msg.sender, title, totalAmount, recipients, sharesBps, Status.Open, uint64(block.timestamp), address(0), 0);
        emit RequestCreated(id, msg.sender, totalAmount);
    }
    function getRequest(uint256 id) public view returns (Request memory) {
        if (requests[id].status == Status.None) revert RequestNotFound();
        return requests[id];
    }
    function getAllocations(uint256 id) external view returns (uint256[] memory) {
        Request memory r = getRequest(id);
        return _allocate(r.totalAmount, r.sharesBps);
    }
    function _allocate(uint256 total, uint16[] memory shares) private pure returns (uint256[] memory amounts) {
        amounts = new uint256[](shares.length);
        uint256 used;
        for (uint256 i; i < shares.length; ++i) {
            uint256 amount = i + 1 == shares.length ? total - used : total * shares[i] / BPS_DENOMINATOR;
            if (amount == 0) revert ZeroAllocation();
            amounts[i] = amount;
            used += amount;
        }
    }
    function payRequest(uint256 id) external nonReentrant {
        Request memory r = getRequest(id);
        if (r.status != Status.Open) revert RequestNotOpen();
        uint256[] memory amounts = _allocate(r.totalAmount, r.sharesBps);
        requests[id].status = Status.Paid;
        requests[id].payer = msg.sender;
        requests[id].paidAt = uint64(block.timestamp);
        for (uint256 i; i < r.recipients.length; ++i) {
            USDC.safeTransferFrom(msg.sender, r.recipients[i], amounts[i]);
            emit RecipientPaid(id, r.recipients[i], amounts[i]);
        }
        emit RequestPaid(id, msg.sender, r.totalAmount);
    }
    function cancelRequest(uint256 id) external nonReentrant {
        Request memory r = getRequest(id);
        if (r.status != Status.Open) revert RequestNotOpen();
        if (r.creator != msg.sender) revert UnauthorizedCancellation();
        requests[id].status = Status.Cancelled;
        emit RequestCancelled(id, msg.sender);
    }
}
