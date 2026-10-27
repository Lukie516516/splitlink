// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @dev LOCAL MOCK ONLY. Does not reproduce Arc shared native/ERC20 balance.
contract LocalToken is ERC20{
 address public blocked;
 constructor()ERC20("LOCAL MOCK USDC","MOCK"){}
 function decimals()public pure override returns(uint8){return 6;}
 function mint(address to,uint256 n)external{_mint(to,n);}
 function setBlocked(address a)external{blocked=a;}
 function transferFrom(address from,address to,uint256 amount)public override returns(bool){require(to!=blocked,"LOCAL recipient blocked");return super.transferFrom(from,to,amount);}
}
