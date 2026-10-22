// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @dev LOCAL TEST FIXTURE ONLY. Does not model Arc shared native/ERC20 balance.
contract LocalMockUSDC is ERC20 {
    address public blocked;
    address public hookTarget;
    bytes public hookData;
    bool public hookBlocked;
    constructor() ERC20("LOCAL MOCK USDC", "MOCK") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBlocked(address to) external { blocked = to; }
    function setHook(address target, bytes calldata data) external { hookTarget = target; hookData = data; hookBlocked = false; }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(to != blocked, "MOCK recipient blocked");
        if (hookTarget != address(0)) {
            (bool success,) = hookTarget.call(hookData);
            require(!success, "MOCK reentrancy succeeded");
            hookBlocked = true;
        }
        return super.transferFrom(from, to, amount);
    }
}
