// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Test.sol";
import "../SplitLink.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @dev External supplemental tests execute the actual Studio SplitLink contract.
contract CallbackToken is ERC20 {
 address public target;bytes public callback;bool public blockedReentry;address public restricted;
 constructor()ERC20("LOCAL callback mock","LOCAL"){}
 function mint(address a,uint256 n)external{_mint(a,n);}
 function configure(address a,bytes calldata data)external{target=a;callback=data;blockedReentry=false;}
 function restrict(address a)external{restricted=a;}
 function createAsToken(SplitLink s,address[] memory recipients,uint16[] memory shares)external returns(uint256){return s.createRequest("token-created",10001,recipients,shares);}
 function transferFrom(address from,address to,uint256 amount)public override returns(bool){require(to!=restricted,"local restriction");if(target!=address(0)){(bool ok,)=target.call(callback);require(!ok,"reentrant call unexpectedly succeeded");blockedReentry=true;}return super.transferFrom(from,to,amount);}
}
contract ExternalContractRegression is Test {
 CallbackToken token;SplitLink split;address payer=address(0x1234);address first=address(0x4567);address last=address(0x8910);
 function setUp()public{token=new CallbackToken();split=new SplitLink(address(token));token.mint(payer,1000000);vm.prank(payer);token.approve(address(split),1000000);}
 function recipients()internal view returns(address[] memory r){r=new address[](2);r[0]=first;r[1]=last;}
 function shares()internal pure returns(uint16[] memory s){s=new uint16[](2);s[0]=5000;s[1]=5000;}
 function test_AllThreeMutationEntrypointsRejectReentry()public{
  for(uint256 method;method<3;method++){
   uint256 id=split.createRequest("outer",10001,recipients(),shares());
   uint256 nested=token.createAsToken(split,recipients(),shares());
   bytes memory data=method==0?abi.encodeCall(split.createRequest,("nested",10001,recipients(),shares())):method==1?abi.encodeCall(split.payRequest,(nested)):abi.encodeCall(split.cancelRequest,(nested));
   token.configure(address(split),data);vm.prank(payer);split.payRequest(id);assertTrue(token.blockedReentry());assertEq(uint256(split.getRequest(nested).status),1);
  }
 }
 function test_FirstAndLaterRestrictionRevertEveryBalanceAndState()public{
  for(uint256 i;i<2;i++){uint256 id=split.createRequest("rollback",10001,recipients(),shares());token.restrict(i==0?first:last);uint256 balance=token.balanceOf(payer);uint256 allowance=token.allowance(payer,address(split));vm.prank(payer);vm.expectRevert();split.payRequest(id);assertEq(token.balanceOf(payer),balance);assertEq(token.balanceOf(first),0);assertEq(token.balanceOf(last),0);assertEq(token.allowance(payer,address(split)),allowance);assertEq(uint256(split.getRequest(id).status),1);}
 }
 function testFuzz_FiveRecipientAllocationsPreserveExactTotal(uint64 raw)public{
  uint256 total=bound(uint256(raw),10000,1000000000000);address[] memory r=new address[](5);uint16[] memory s=new uint16[](5);for(uint256 i;i<5;i++){r[i]=address(uint160(0x100+i));s[i]=2000;}
  uint256 id=split.createRequest("five",total,r,s);uint256[] memory allocations=split.getAllocations(id);uint256 sum;for(uint256 i;i<5;i++){assertGt(allocations[i],0);sum+=allocations[i];if(i<4)assertEq(allocations[i],total*2000/10000);}assertEq(sum,total);
 }
}
