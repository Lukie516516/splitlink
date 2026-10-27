import { test, expect } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import { recoverRecord } from "../src/lib/journal";
const abi = parseAbi(["function payRequest(uint256 requestId)"]);
const account = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const hash = `0x${"3".repeat(64)}` as const;
const opts = {
  expectedTarget: target,
  expectedSender: account,
  expectedCallData: encodeFunctionData({
    abi,
    functionName: "payRequest",
    args: [1n],
  }),
  abi,
};
test("recovery rejects same selector with a different request ID", async () => {
  const client = {
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 12n,
    }),
    getTransaction: async () => ({
      to: target,
      from: account,
      value: 0n,
      input: encodeFunctionData({
        abi,
        functionName: "payRequest",
        args: [2n],
      }),
    }),
  };
  const result = await recoverRecord(client as never, hash, opts);
  expect(result.state).toBe("unknown");
});
test("missing transaction identity cannot establish confirmed operation", async () => {
  const client = {
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 12n,
    }),
    getTransaction: async () => {
      throw new Error("RPC temporarily unavailable");
    },
  };
  const result = await recoverRecord(client as never, hash, opts);
  expect(result.state).toBe("unknown");
});
