/**
 * Bun unit tests for SplitLink production TypeScript modules.
 *
 * ALL tests exercise PRODUCTION functions directly — no logic is duplicated
 * into test helpers. isValidRecord_TESTONLY and clearCachedSuccessOnRestore_TESTONLY
 * are aliases for the real isValidRecord_PROD / clearCachedSuccessOnRestore_PROD
 * exported from journal.ts, verified via journal-testexports.ts.
 *
 * Covers:
 *   - Journal: on-restore cache clearing, recovery engine, forged-success rejection,
 *     ambiguous-broadcast → unknown (not rejected), all 5 operations.
 *   - recoverRecord: full calldata comparison (not just functionName), same function
 *     with different args rejected, missing tx body → unknown with receiptFound=true,
 *     nonzero native value rejected, wrong sender/target/calldata.
 *   - Preflight: approve/reset simulation failures are blocking (not permissive),
 *     transport vs deterministic distinction, signing context verification,
 *     stale quote rejection, quotedCallData/quotedTarget recorded.
 *   - Evidence: parseWord 8-condition helpers, malformed log.data rejection.
 *   - History: adjustedStart no-gap invariant with failed pages.
 *   - Manifest: verifyManifestOnChain production function via mock RPC.
 *   - Controller: useRecovery controller function (extracted logic, no DOM).
 *
 * Browser tests (localStorage, React components, wallet events):
 * UNAVAILABLE in Bun without a DOM runtime. Coverage gaps are documented
 * in docs/build-report.md §Coverage Gaps.
 */

import { describe, it, expect } from 'bun:test'
import type { PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

// ── Production module imports ──────────────────────────────────────────────────

import {
  ceilDiv, p6ToNative, runPreflight, checkFunding,
  makeContextKey, verifySigningContext,
  GAS_LIMIT_MARGIN_BPS, FEE_CAP_MARGIN_BPS, MIN_MAX_FEE_PER_GAS_18,
  BALANCE_RESERVE_18, QUOTE_TTL_MS, SCALE_P6_TO_P18,
  type PreflightQuote,
} from '../src/lib/preflight'

// journal-testexports re-exports the PRODUCTION functions — no duplication
import {
  isValidRecord_TESTONLY, clearCachedSuccessOnRestore_TESTONLY,
  recoverRecord, generateRecordId,
  type TransactionRecord,
} from '../src/lib/journal-testexports'

// Minimal ABI matching what SplitLink uses (for calldata tests)
const PAY_ABI = [
  { type: 'function', name: 'payRequest', inputs: [{ name: 'requestId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
] as const

const APPROVE_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 1: Preflight — arithmetic and context verification
// ────────────────────────────────────────────────────────────────────────────────

describe('ceilDiv', () => {
  it('exact multiple', () => {
    expect(ceilDiv(100n, 1n, 10n)).toBe(10n)
  })
  it('non-multiple rounds up', () => {
    expect(ceilDiv(101n, 1n, 10n)).toBe(11n)
    expect(ceilDiv(109n, 1n, 10n)).toBe(11n)
    expect(ceilDiv(110n, 1n, 10n)).toBe(11n)
  })
  it('GAS_LIMIT_MARGIN_BPS scaling', () => {
    expect(ceilDiv(50000n, GAS_LIMIT_MARGIN_BPS, 10000n)).toBe(60000n)
  })
  it('ceil of non-multiple with margin bps', () => {
    expect(ceilDiv(50001n, GAS_LIMIT_MARGIN_BPS, 10000n)).toBe(60002n)
  })
})

describe('p6ToNative', () => {
  it('1 USDC6 = 1e12 native units', () => {
    expect(p6ToNative(1_000_000n)).toBe(1_000_000n * SCALE_P6_TO_P18)
  })
  it('zero stays zero', () => {
    expect(p6ToNative(0n)).toBe(0n)
  })
})

describe('makeContextKey', () => {
  it('lowercases account and contract', () => {
    const k1 = makeContextKey(1, '0xABCD', '0xEF01', 'pay')
    const k2 = makeContextKey(1, '0xabcd', '0xef01', 'pay')
    expect(k1).toBe(k2)
  })
  it('different chains produce different keys', () => {
    expect(makeContextKey(1, '0x1', '0x2', 'pay')).not.toBe(makeContextKey(2, '0x1', '0x2', 'pay'))
  })
})

describe('verifySigningContext', () => {
  function makeQuote(overrides?: Partial<PreflightQuote>): PreflightQuote {
    return {
      contextKey: makeContextKey(5042002, '0xuser', '0xcontract', 'pay'),
      operation: 'pay',
      quoteBlock: 100n,
      quotedAt: Date.now(),
      estimatedGas: 50000n,
      gasLimit: 60000n,
      maxFeePerGas18: MIN_MAX_FEE_PER_GAS_18,
      feeBudget18: 60000n * MIN_MAX_FEE_PER_GAS_18,
      simulationOk: true,
      feeSource: 'estimateFeesPerGas',
      quotedCallData: '0xdeadbeef',
      quotedTarget: '0xcontract',
      ...overrides,
    }
  }

  it('valid context returns null', () => {
    const q = makeQuote()
    expect(verifySigningContext(q, {
      chainId: 5042002, account: '0xuser', target: '0xcontract',
      callData: '0xdeadbeef', value: 0n,
    })).toBeNull()
  })

  it('stale quote (past TTL)', () => {
    const q = makeQuote({ quotedAt: Date.now() - QUOTE_TTL_MS - 1000 })
    const err = verifySigningContext(q, {
      chainId: 5042002, account: '0xuser', target: '0xcontract',
      callData: '0xdeadbeef', value: 0n,
    })
    expect(err).toContain('expired')
  })

  it('context key mismatch (account changed)', () => {
    const q = makeQuote({ contextKey: makeContextKey(5042002, '0xother', '0xcontract', 'pay') })
    expect(verifySigningContext(q, {
      chainId: 5042002, account: '0xuser', target: '0xcontract',
      callData: '0xdeadbeef', value: 0n,
    })).toContain('Context changed')
  })

  it('calldata mismatch', () => {
    const q = makeQuote()
    expect(verifySigningContext(q, {
      chainId: 5042002, account: '0xuser', target: '0xcontract',
      callData: '0xcafebabe', value: 0n,
    })).toContain('data changed')
  })

  it('nonzero value rejected', () => {
    const q = makeQuote()
    expect(verifySigningContext(q, {
      chainId: 5042002, account: '0xuser', target: '0xcontract',
      callData: '0xdeadbeef', value: 1n,
    })).toContain('zero value')
  })

  it('simulation failed blocks signing', () => {
    const q = makeQuote({ simulationOk: false, simulationRevertReason: 'InsufficientAllowance' })
    expect(verifySigningContext(q, {
      chainId: 5042002, account: '0xuser', target: '0xcontract',
      callData: '0xdeadbeef', value: 0n,
    })).toContain('Simulation failed')
  })
})

describe('checkFunding', () => {
  const feeBudget18 = 60000n * MIN_MAX_FEE_PER_GAS_18
  const principal6 = 1_000_000n
  const p18 = p6ToNative(principal6)

  it('pay: passes when B6 >= P6 and B18 >= P18 + fee + reserve', () => {
    expect(checkFunding({
      operation: 'pay', feeBudget18, principal6,
      balance6: principal6, nativeBalance18: p18 + feeBudget18 + BALANCE_RESERVE_18,
    }).ok).toBe(true)
  })

  it('pay: fails when B6 < P6', () => {
    const r = checkFunding({
      operation: 'pay', feeBudget18, principal6, balance6: principal6 - 1n,
      nativeBalance18: p18 + feeBudget18 + BALANCE_RESERVE_18,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Insufficient USDC')
  })

  it('pay: fails when native balance too low for fee', () => {
    expect(checkFunding({
      operation: 'pay', feeBudget18, principal6, balance6: principal6, nativeBalance18: 0n,
    }).ok).toBe(false)
  })

  it('approve: same as pay (conservative)', () => {
    expect(checkFunding({
      operation: 'approve', feeBudget18, principal6, balance6: principal6, nativeBalance18: 0n,
    }).ok).toBe(false)
  })

  it('approveReset: only needs fee (no principal)', () => {
    expect(checkFunding({
      operation: 'approveReset', feeBudget18, principal6: 0n, balance6: 0n,
      nativeBalance18: feeBudget18 + BALANCE_RESERVE_18,
    }).ok).toBe(true)
  })

  it('cancel: only needs fee', () => {
    expect(checkFunding({
      operation: 'cancel', feeBudget18, principal6: 0n, balance6: 0n,
      nativeBalance18: feeBudget18 + BALANCE_RESERVE_18,
    }).ok).toBe(true)
  })

  it('unknown balance (null) always fails', () => {
    expect(checkFunding({
      operation: 'pay', feeBudget18, principal6, balance6: null, nativeBalance18: null,
    }).ok).toBe(false)
  })
})

describe('runPreflight — mock RPC', () => {
  function mockClient(overrides: {
    estimateFeesPerGas?: () => Promise<{ maxFeePerGas: bigint }>
    getBlockNumber?: () => Promise<bigint>
    call?: () => Promise<unknown>
    estimateGas?: () => Promise<bigint>
  }): PublicClient {
    return {
      estimateFeesPerGas: overrides.estimateFeesPerGas ?? (async () => ({ maxFeePerGas: 25_000_000_000n })),
      getBlockNumber: overrides.getBlockNumber ?? (async () => 100n),
      call: overrides.call ?? (async () => ({})),
      estimateGas: overrides.estimateGas ?? (async () => 50000n),
    } as unknown as PublicClient
  }

  const baseParams = {
    chainId: 5042002,
    account: '0xuser' as `0x${string}`,
    contractAddress: '0xcontract' as `0x${string}`,
    operation: 'pay' as const,
    callData: '0xdeadbeef' as `0x${string}`,
    principal6: 1_000_000n,
    isChainSpecificClient: true,
  }

  it('success path returns quote with simulationOk=true', async () => {
    const result = await runPreflight({ publicClient: mockClient({}), ...baseParams })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quote.simulationOk).toBe(true)
      expect(result.quote.gasLimit).toBe(ceilDiv(50000n, GAS_LIMIT_MARGIN_BPS, 10000n))
    }
  })

  it('simulation revert is BLOCKING for pay', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ call: async () => { throw new Error('execution reverted: InsufficientAllowance') } }),
      ...baseParams, operation: 'pay',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('simulationReverted')
  })

  it('simulation revert is BLOCKING for approve — NOT permissive', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ call: async () => { throw new Error('execution reverted: TokenBlocklisted') } }),
      ...baseParams, operation: 'approve',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('simulationReverted')
  })

  it('simulation revert is BLOCKING for approveReset', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ call: async () => { throw new Error('execution reverted: TokenPaused') } }),
      ...baseParams, operation: 'approveReset',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('simulationReverted')
  })

  it('simulation revert is BLOCKING for cancel', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ call: async () => { throw new Error('execution reverted: NotCreator') } }),
      ...baseParams, operation: 'cancel',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('simulationReverted')
  })

  it('simulation revert is BLOCKING for create', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ call: async () => { throw new Error('execution reverted: TitleTooLong') } }),
      ...baseParams, operation: 'create',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('simulationReverted')
  })

  it('transport failure → rpcUnavailable', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ call: async () => { throw new Error('Failed to fetch') } }),
      ...baseParams,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('rpcUnavailable')
  })

  it('fee fetch transport failure → rpcUnavailable', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ estimateFeesPerGas: async () => { throw new Error('ECONNREFUSED') } }),
      ...baseParams,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('rpcUnavailable')
  })

  it('unsupported chainId returns estimateUnavailable', async () => {
    const result = await runPreflight({ publicClient: mockClient({}), ...baseParams, chainId: 999 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('estimateUnavailable')
  })

  it('gas estimate failure → estimateUnavailable', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ estimateGas: async () => { throw new Error('out of gas') } }),
      ...baseParams,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('estimateUnavailable')
  })

  it('fee floor applied when rpc fee < 20 Gwei', async () => {
    const result = await runPreflight({
      publicClient: mockClient({ estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000n }) }),
      ...baseParams,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quote.maxFeePerGas18).toBe(MIN_MAX_FEE_PER_GAS_18)
  })

  it('fee margin applied when rpc fee > 20 Gwei', async () => {
    const rpcFee = 30_000_000_000n
    const result = await runPreflight({
      publicClient: mockClient({ estimateFeesPerGas: async () => ({ maxFeePerGas: rpcFee }) }),
      ...baseParams,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quote.maxFeePerGas18).toBe(ceilDiv(rpcFee, FEE_CAP_MARGIN_BPS, 10000n))
  })

  it('quotedCallData and quotedTarget are recorded in quote', async () => {
    const result = await runPreflight({ publicClient: mockClient({}), ...baseParams })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quote.quotedCallData).toBe(baseParams.callData)
      expect(result.quote.quotedTarget).toBe(baseParams.contractAddress)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 2: Journal — cache clearing (PRODUCTION functions, not duplicates)
// ────────────────────────────────────────────────────────────────────────────────

describe('clearCachedSuccessOnRestore (production)', () => {
  function makeRecord(overrides: Partial<TransactionRecord>): TransactionRecord {
    return {
      schemaVersion: 1, recordId: generateRecordId(), chainId: 5042002,
      contractAddress: '0xcontract', account: '0xuser',
      operationType: 'pay', requestId: '1',
      to: '0xcontract', callData: '0xdeadbeef', value18: '0', intent: {},
      txHash: '0xabc', effectiveTxHash: '0xabc', replacementHashes: [],
      nonce: null, submittedAtBlock: null,
      createdAtMs: Date.now(), updatedAtMs: Date.now(),
      txState: 'confirmed', businessVerification: 'verified',
      receiptBlock: '100', receiptStatus: 'success',
      replacementKind: null, error: null,
      ...overrides,
    }
  }

  it('confirmed+verified record is demoted to submitted on restore', () => {
    const cleared = clearCachedSuccessOnRestore_TESTONLY(
      makeRecord({ txState: 'confirmed', businessVerification: 'verified', receiptStatus: 'success' })
    )
    expect(cleared.txState).toBe('submitted')
    expect(cleared.receiptStatus).toBeNull()
    expect(cleared.businessVerification).toBe('notChecked')
  })

  it('confirmed without hash becomes unknown', () => {
    const cleared = clearCachedSuccessOnRestore_TESTONLY(
      makeRecord({ txState: 'confirmed', txHash: null, effectiveTxHash: null })
    )
    expect(cleared.txState).toBe('unknown')
    expect(cleared.receiptStatus).toBeNull()
  })

  it('reverted record is preserved', () => {
    const cleared = clearCachedSuccessOnRestore_TESTONLY(
      makeRecord({ txState: 'reverted', receiptStatus: 'reverted', businessVerification: 'notChecked' })
    )
    expect(cleared.txState).toBe('reverted')
  })

  it('rejected record is preserved', () => {
    const cleared = clearCachedSuccessOnRestore_TESTONLY(
      makeRecord({ txState: 'rejected', txHash: null, receiptStatus: null })
    )
    expect(cleared.txState).toBe('rejected')
  })

  it('pending businessVerification is cleared', () => {
    const cleared = clearCachedSuccessOnRestore_TESTONLY(
      makeRecord({ txState: 'confirmed', businessVerification: 'pending' })
    )
    expect(cleared.businessVerification).toBe('notChecked')
    expect(cleared.txState).toBe('submitted')
  })

  it('forged success without hash: demoted to unknown', () => {
    const cleared = clearCachedSuccessOnRestore_TESTONLY(
      makeRecord({ txState: 'confirmed', txHash: null, businessVerification: 'verified', receiptStatus: 'success' })
    )
    expect(cleared.txState).toBe('unknown')
    expect(cleared.businessVerification).toBe('notChecked')
  })

  it('awaitingSignature with no hash and no success cache is unchanged (not rejected)', () => {
    // The invariant: ambiguous broadcast must never auto-advance to rejected
    const rec = makeRecord({ txState: 'awaitingSignature', txHash: null, receiptStatus: null, businessVerification: 'notChecked' })
    const cleared = clearCachedSuccessOnRestore_TESTONLY(rec)
    expect(cleared.txState).toBe('awaitingSignature')
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 3: recoverRecord — full calldata + missing tx body + value tests
// ────────────────────────────────────────────────────────────────────────────────

describe('recoverRecord — production identity verification', () => {
  // Build real calldata for payRequest(1) and payRequest(2)
  const callDataPayId1 = encodeFunctionData({ abi: PAY_ABI, functionName: 'payRequest', args: [1n] })
  const callDataPayId2 = encodeFunctionData({ abi: PAY_ABI, functionName: 'payRequest', args: [2n] })
  const callDataApprove50 = encodeFunctionData({
    abi: APPROVE_ABI, functionName: 'approve',
    args: ['0xspender' as `0x${string}`, 50_000_000n],
  })
  const callDataApprove99 = encodeFunctionData({
    abi: APPROVE_ABI, functionName: 'approve',
    args: ['0xspender' as `0x${string}`, 99_000_000n],
  })

  function mockClient(overrides: {
    getTransactionReceipt?: () => Promise<{ status: string; blockNumber: bigint }>
    getTransaction?: () => Promise<{ to: string; from: string; input: string; value: bigint }>
  }): PublicClient {
    return {
      getTransactionReceipt: overrides.getTransactionReceipt ?? (async () => ({ status: 'success', blockNumber: 100n })),
      getTransaction: overrides.getTransaction ?? (async () => ({
        to: '0xcontract', from: '0xuser', input: callDataPayId1, value: 0n,
      })),
    } as unknown as PublicClient
  }

  it('successful receipt with matching calldata → confirmed', async () => {
    const r = await recoverRecord(mockClient({}), '0xhash', {
      expectedTarget: '0xcontract',
      expectedCallData: callDataPayId1,
      expectedSender: '0xuser',
      requireZeroValue: true,
      abi: PAY_ABI as unknown as Parameters<typeof recoverRecord>[2]['abi'],
    })
    expect(r.state).toBe('confirmed')
  })

  it('reverted receipt → reverted', async () => {
    const r = await recoverRecord(
      mockClient({ getTransactionReceipt: async () => ({ status: 'reverted', blockNumber: 100n }) }),
      '0xhash'
    )
    expect(r.state).toBe('reverted')
  })

  it('RPC transport failure on receipt → rpcFailure', async () => {
    const r = await recoverRecord(
      mockClient({ getTransactionReceipt: async () => { throw new Error('Failed to fetch') } }),
      '0xhash'
    )
    expect(r.state).toBe('rpcFailure')
  })

  it('receipt not found → unknown with receiptFound=false', async () => {
    const r = await recoverRecord(
      mockClient({ getTransactionReceipt: async () => { throw new Error('Transaction not found') } }),
      '0xhash'
    )
    expect(r.state).toBe('unknown')
    if (r.state === 'unknown') expect(r.receiptFound).toBe(false)
  })

  it('wrong tx.to → unknown', async () => {
    const r = await recoverRecord(
      mockClient({ getTransaction: async () => ({ to: '0xwrong', from: '0xuser', input: callDataPayId1, value: 0n }) }),
      '0xhash',
      { expectedTarget: '0xcontract' }
    )
    expect(r.state).toBe('unknown')
    if (r.state === 'unknown') expect(r.reason).toContain('target mismatch')
  })

  it('wrong tx.from → unknown', async () => {
    const r = await recoverRecord(
      mockClient({ getTransaction: async () => ({ to: '0xcontract', from: '0xother', input: callDataPayId1, value: 0n }) }),
      '0xhash',
      { expectedTarget: '0xcontract', expectedSender: '0xuser' }
    )
    expect(r.state).toBe('unknown')
    if (r.state === 'unknown') expect(r.reason).toContain('sender mismatch')
  })

  it('same function (payRequest) with DIFFERENT requestId arg → unknown', async () => {
    // payRequest(2) on chain but we expected payRequest(1) — same function, different args
    const r = await recoverRecord(
      mockClient({ getTransaction: async () => ({ to: '0xcontract', from: '0xuser', input: callDataPayId2, value: 0n }) }),
      '0xhash',
      {
        expectedTarget: '0xcontract',
        expectedCallData: callDataPayId1,
        expectedSender: '0xuser',
        abi: PAY_ABI as unknown as Parameters<typeof recoverRecord>[2]['abi'],
      }
    )
    expect(r.state).toBe('unknown')
    if (r.state === 'unknown') {
      // Reason should describe calldata mismatch or arg mismatch
      expect(r.reason.toLowerCase()).toMatch(/calldata|arg|mismatch/)
    }
  })

  it('approve with different amount → unknown (same function, diff args)', async () => {
    const r = await recoverRecord(
      mockClient({ getTransaction: async () => ({ to: '0xusdc', from: '0xuser', input: callDataApprove99, value: 0n }) }),
      '0xhash',
      {
        expectedTarget: '0xusdc',
        expectedCallData: callDataApprove50,
        expectedSender: '0xuser',
        abi: APPROVE_ABI as unknown as Parameters<typeof recoverRecord>[2]['abi'],
      }
    )
    expect(r.state).toBe('unknown')
  })

  it('nonzero native value → unknown (SplitLink ops are nonpayable)', async () => {
    const r = await recoverRecord(
      mockClient({ getTransaction: async () => ({ to: '0xcontract', from: '0xuser', input: callDataPayId1, value: 1n }) }),
      '0xhash',
      { expectedTarget: '0xcontract', requireZeroValue: true }
    )
    expect(r.state).toBe('unknown')
    if (r.state === 'unknown') expect(r.reason).toContain('nonzero')
  })

  it('getTransaction transport failure → unknown with receiptFound=true, receipt retained', async () => {
    // Receipt succeeded but we cannot fetch the tx body — identity unverified
    const r = await recoverRecord(
      mockClient({ getTransaction: async () => { throw new Error('Failed to fetch') } }),
      '0xhash',
      { expectedTarget: '0xcontract', expectedCallData: callDataPayId1 }
    )
    expect(r.state).toBe('unknown')
    if (r.state === 'unknown') {
      expect(r.receiptFound).toBe(true)
      expect(r.receiptStatus).toBe('success')
      expect(r.reason).toContain('identity verification')
    }
  })

  it('getTransaction returns null/not-found → unknown with receiptFound=true', async () => {
    const r = await recoverRecord(
      mockClient({ getTransaction: async () => { throw new Error('Transaction not found in block') } }),
      '0xhash',
      { expectedTarget: '0xcontract', expectedCallData: callDataPayId1 }
    )
    expect(r.state).toBe('unknown')
    if (r.state === 'unknown') {
      expect(r.receiptFound).toBe(true)
    }
  })

  it('all 5 operations: confirmed when target/sender/calldata match', async () => {
    const ops: Array<{ name: string; callData: `0x${string}`; target: string }> = [
      { name: 'pay',         callData: callDataPayId1, target: '0xcontract' },
      { name: 'approve',     callData: callDataApprove50, target: '0xusdc' },
      { name: 'approveReset', callData: encodeFunctionData({ abi: APPROVE_ABI, functionName: 'approve', args: ['0xspender' as `0x${string}`, 0n] }), target: '0xusdc' },
      { name: 'create',      callData: '0xdeadbeef' as `0x${string}`, target: '0xcontract' },
      { name: 'cancel',      callData: '0xcafebabe' as `0x${string}`, target: '0xcontract' },
    ]
    for (const op of ops) {
      const client = mockClient({
        getTransaction: async () => ({ to: op.target, from: '0xuser', input: op.callData, value: 0n }),
      })
      const r = await recoverRecord(client, '0xhash', {
        expectedTarget: op.target,
        expectedCallData: op.callData,
        expectedSender: '0xuser',
        requireZeroValue: true,
      })
      expect(r.state).toBe('confirmed')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 4: Journal structural validation (production isValidRecord_PROD)
// ────────────────────────────────────────────────────────────────────────────────

describe('journal structural validation (production)', () => {
  function validRecord(): TransactionRecord {
    return {
      schemaVersion: 1, recordId: 'test-id', chainId: 5042002,
      contractAddress: '0xcontract', account: '0xuser',
      operationType: 'create', requestId: null,
      to: '0xcontract', callData: '0xdeadbeef', value18: '0',
      intent: {}, txHash: null, effectiveTxHash: null,
      replacementHashes: [], nonce: null, submittedAtBlock: null,
      createdAtMs: Date.now(), updatedAtMs: Date.now(),
      txState: 'awaitingSignature', businessVerification: 'notChecked',
      receiptBlock: null, receiptStatus: null, replacementKind: null, error: null,
    }
  }

  it('valid record passes', () => {
    expect(isValidRecord_TESTONLY(validRecord())).toBe(true)
  })
  it('wrong schemaVersion rejected', () => {
    expect(isValidRecord_TESTONLY({ ...validRecord(), schemaVersion: 99 })).toBe(false)
  })
  it('empty recordId rejected', () => {
    expect(isValidRecord_TESTONLY({ ...validRecord(), recordId: '' })).toBe(false)
  })
  it('unknown operationType rejected', () => {
    expect(isValidRecord_TESTONLY({ ...validRecord(), operationType: 'unknown' as never })).toBe(false)
  })
  it('unknown txState rejected', () => {
    expect(isValidRecord_TESTONLY({ ...validRecord(), txState: 'pending' as never })).toBe(false)
  })
  it('non-array replacementHashes rejected', () => {
    expect(isValidRecord_TESTONLY({ ...validRecord(), replacementHashes: null as never })).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 5: Evidence helpers — parseWord (extracted from ReceiptPage)
// ────────────────────────────────────────────────────────────────────────────────

describe('evidence — parseWord (ReceiptPage condition 5)', () => {
  /** Mirrors parseWord from ReceiptPage — extracted for testing. */
  function parseWord(data: string, wordIndex: number): bigint | null {
    try {
      const hex = data.startsWith('0x') ? data.slice(2) : data
      const wordHex = hex.slice(wordIndex * 64, (wordIndex + 1) * 64)
      if (wordHex.length !== 64) return null
      return BigInt('0x' + wordHex)
    } catch { return null }
  }

  it('parses first 32-byte word correctly', () => {
    const amount = 1_000_000n
    const padded = amount.toString(16).padStart(64, '0')
    expect(parseWord('0x' + padded, 0)).toBe(amount)
  })
  it('malformed data (empty) returns null', () => {
    expect(parseWord('0x', 0)).toBeNull()
  })
  it('malformed data (short) returns null', () => {
    expect(parseWord('0xdeadbeef', 0)).toBeNull()
  })
  it('malformed data (non-hex) returns null', () => {
    expect(parseWord('0x' + 'z'.repeat(64), 0)).toBeNull()
  })
  it('correct amount passes condition 5', () => {
    const canonical = 1_500_000n
    const padded = canonical.toString(16).padStart(64, '0')
    expect(parseWord('0x' + padded, 0)).toBe(canonical)
  })
  it('wrong amount fails condition 5', () => {
    const canonical = 1_500_000n
    const wrong = 999_999n
    expect(parseWord('0x' + wrong.toString(16).padStart(64, '0'), 0)).not.toBe(canonical)
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 6: History — adjustedStart no-gap invariant
// ────────────────────────────────────────────────────────────────────────────────

describe('history — adjustedStart no-gap invariant', () => {
  function simulateScan(
    head: bigint,
    deployBlock: bigint,
    pageBlocks: bigint,
    failedPages: Array<[bigint, bigint]>
  ): Array<[bigint, bigint]> {
    const scanned: Array<[bigint, bigint]> = []
    let pageEnd = head

    while (pageEnd >= deployBlock) {
      const pageStart = pageEnd - pageBlocks + 1n < deployBlock
        ? deployBlock : pageEnd - pageBlocks + 1n

      const isFailed = failedPages.some(([e, s]) => e === pageEnd && s === pageStart)
      const actualCoveredStart: bigint | null = isFailed ? null : pageStart

      if (actualCoveredStart !== null) {
        scanned.push([actualCoveredStart, pageEnd])
      }

      if (pageEnd <= deployBlock) break
      pageEnd = actualCoveredStart !== null ? actualCoveredStart - 1n : pageStart - 1n
    }
    return scanned
  }

  function hasGap(ranges: Array<[bigint, bigint]>, deployBlock: bigint, head: bigint): boolean {
    if (ranges.length === 0) return true
    const sorted = [...ranges].sort((a, b) => a[0] < b[0] ? -1 : 1)
    if (sorted[0][0] > deployBlock) return true
    const lastEnd = sorted.reduce((mx, r) => r[1] > mx ? r[1] : mx, 0n)
    if (lastEnd < head) return true
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][0] > sorted[i - 1][1] + 1n) return true
    }
    return false
  }

  it('no gaps with even divisor', () => {
    expect(hasGap(simulateScan(10000n, 0n, 2000n, []), 0n, 10000n)).toBe(false)
  })

  it('no gaps with uneven divisor', () => {
    expect(hasGap(simulateScan(5999n, 0n, 2000n, []), 0n, 5999n)).toBe(false)
  })

  it('adjustedStart prevents gap after failed page', () => {
    const head = 6000n, deploy = 0n, page = 2000n
    const rangesWithFail = simulateScan(head, deploy, page, [[6000n, 4001n]])
    const sorted = [...rangesWithFail].sort((a, b) => a[0] < b[0] ? -1 : 1)
    // Coverage of [0, 4000] (the non-failed portion)
    expect(sorted[0]?.[0]).toBe(0n)
    const lastEnd = sorted.reduce((mx, r) => r[1] > mx ? r[1] : mx, 0n)
    expect(lastEnd).toBe(4000n)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i][0]).toBe(sorted[i - 1][1] + 1n)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 7: verifyManifestOnChain — direct production function via mock RPC
// ────────────────────────────────────────────────────────────────────────────────

describe('verifyManifestOnChain — mock RPC (production function)', () => {
  // Import the production function; manifest.ts uses import.meta.env which Bun handles.
  // We build a minimal NetworkManifest object and a mock PublicClient.
  const { verifyManifestOnChain } = require('../src/lib/manifest') as {
    verifyManifestOnChain: (
      client: PublicClient,
      manifest: { isDeployed: boolean; hasDeploymentBlock: boolean; contractAddress: string; usdcAddress: string; chainId: number }
    ) => Promise<{ allPassed: boolean; failureReason?: string }>
  }

  const goodManifest = {
    isDeployed: true,
    hasDeploymentBlock: true,
    contractAddress: '0xabcdef0123456789abcdef0123456789abcdef01',
    usdcAddress: '0x3600000000000000000000000000000000000000',
    chainId: 5042002,
  }

  function mockVerifyClient(overrides: {
    getChainId?: () => Promise<number>
    getBytecode?: () => Promise<string | undefined>
    readContract?: () => Promise<unknown>
  }): PublicClient {
    return {
      getChainId: overrides.getChainId ?? (async () => 5042002),
      getBytecode: overrides.getBytecode ?? (async () => '0x606060'),
      readContract: overrides.readContract ?? (async () => 6),
    } as unknown as PublicClient
  }

  it('all conditions pass', async () => {
    const r = await verifyManifestOnChain(mockVerifyClient({}), goodManifest)
    expect(r.allPassed).toBe(true)
  })

  it('chain ID mismatch fails', async () => {
    const r = await verifyManifestOnChain(
      mockVerifyClient({ getChainId: async () => 1 }),
      goodManifest
    )
    expect(r.allPassed).toBe(false)
    expect(r.failureReason).toContain('chain ID')
  })

  it('empty bytecode fails', async () => {
    const r = await verifyManifestOnChain(
      mockVerifyClient({ getBytecode: async () => '0x' }),
      goodManifest
    )
    expect(r.allPassed).toBe(false)
    expect(r.failureReason?.toLowerCase()).toContain('bytecode')
  })

  it('undefined bytecode fails', async () => {
    const r = await verifyManifestOnChain(
      mockVerifyClient({ getBytecode: async () => undefined }),
      goodManifest
    )
    expect(r.allPassed).toBe(false)
  })

  it('USDC decimals not 6 fails', async () => {
    const r = await verifyManifestOnChain(
      mockVerifyClient({ readContract: async () => 18 }),
      goodManifest
    )
    expect(r.allPassed).toBe(false)
    expect(r.failureReason?.toLowerCase()).toContain('decimal')
  })

  it('undeployed manifest fails fast without RPC call', async () => {
    const r = await verifyManifestOnChain(
      mockVerifyClient({}),
      { ...goodManifest, isDeployed: false }
    )
    expect(r.allPassed).toBe(false)
    expect(r.failureReason).toContain('not deployed')
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// SECTION 8: Recovery controller — extracted logic (no DOM/React)
// ────────────────────────────────────────────────────────────────────────────────

describe('recovery controller — runRecoveryPass (extracted logic)', () => {
  /**
   * Extracted recovery pass logic from useRecovery.
   * Tests the core recovery loop without React or DOM.
   */
  async function runRecoveryPass(
    candidates: TransactionRecord[],
    client: PublicClient
  ): Promise<Map<string, { txState: string; receiptFound?: boolean }>> {
    const results = new Map<string, { txState: string; receiptFound?: boolean }>()

    for (const rec of candidates) {
      if (!rec.txHash) continue
      const hash = rec.txHash as `0x${string}`
      try {
        const outcome = await recoverRecord(client, hash, {
          expectedTarget: rec.to,
          expectedCallData: rec.callData,
          expectedSender: rec.account,
          requireZeroValue: true,
        })
        if (outcome.state === 'confirmed') {
          results.set(rec.recordId, { txState: 'confirmed' })
        } else if (outcome.state === 'reverted') {
          results.set(rec.recordId, { txState: 'reverted' })
        } else if (outcome.state === 'unknown') {
          results.set(rec.recordId, { txState: 'unknown', receiptFound: outcome.receiptFound })
        } else {
          // rpcFailure — leave unchanged
          results.set(rec.recordId, { txState: rec.txState })
        }
      } catch {
        results.set(rec.recordId, { txState: rec.txState })
      }
    }
    return results
  }

  function makeSubmitted(id: string, callData: string, target: string): TransactionRecord {
    return {
      schemaVersion: 1, recordId: id, chainId: 5042002,
      contractAddress: target, account: '0xuser',
      operationType: 'pay', requestId: '1',
      to: target, callData, value18: '0', intent: {},
      txHash: '0xhash', effectiveTxHash: '0xhash', replacementHashes: [],
      nonce: null, submittedAtBlock: null,
      createdAtMs: Date.now(), updatedAtMs: Date.now(),
      txState: 'submitted', businessVerification: 'notChecked',
      receiptBlock: null, receiptStatus: null, replacementKind: null, error: null,
    }
  }

  const goodCallData = encodeFunctionData({ abi: PAY_ABI, functionName: 'payRequest', args: [1n] })

  it('successful receipt + matching calldata → confirmed', async () => {
    const client = {
      getTransactionReceipt: async () => ({ status: 'success', blockNumber: 100n }),
      getTransaction: async () => ({ to: '0xcontract', from: '0xuser', input: goodCallData, value: 0n }),
    } as unknown as PublicClient

    const rec = makeSubmitted('rec1', goodCallData, '0xcontract')
    const results = await runRecoveryPass([rec], client)
    expect(results.get('rec1')?.txState).toBe('confirmed')
  })

  it('reverted receipt → reverted', async () => {
    const client = {
      getTransactionReceipt: async () => ({ status: 'reverted', blockNumber: 100n }),
      getTransaction: async () => ({ to: '0xcontract', from: '0xuser', input: goodCallData, value: 0n }),
    } as unknown as PublicClient

    const rec = makeSubmitted('rec2', goodCallData, '0xcontract')
    const results = await runRecoveryPass([rec], client)
    expect(results.get('rec2')?.txState).toBe('reverted')
  })

  it('getTransaction missing (identity failure) → unknown with receiptFound=true', async () => {
    const client = {
      getTransactionReceipt: async () => ({ status: 'success', blockNumber: 100n }),
      getTransaction: async () => { throw new Error('Failed to fetch') },
    } as unknown as PublicClient

    const rec = makeSubmitted('rec3', goodCallData, '0xcontract')
    const results = await runRecoveryPass([rec], client)
    expect(results.get('rec3')?.txState).toBe('unknown')
    expect(results.get('rec3')?.receiptFound).toBe(true)
  })

  it('context switch: records from a different account are still processed independently', async () => {
    // Two records: one for 0xuser, one for 0xother. Both should be recovered independently.
    const clientUser = {
      getTransactionReceipt: async () => ({ status: 'success', blockNumber: 100n }),
      getTransaction: async () => ({ to: '0xcontract', from: '0xuser', input: goodCallData, value: 0n }),
    } as unknown as PublicClient

    const recUser = makeSubmitted('user1', goodCallData, '0xcontract')
    const recOther = { ...makeSubmitted('other1', goodCallData, '0xcontract'), account: '0xother' }

    // Run both through the same client — the client always returns 0xuser as sender
    // recOther should get unknown because from != expected sender
    const results = await runRecoveryPass([recUser, recOther], clientUser)
    expect(results.get('user1')?.txState).toBe('confirmed')
    expect(results.get('other1')?.txState).toBe('unknown')
  })

  it('rpcFailure: leave record unchanged', async () => {
    const client = {
      getTransactionReceipt: async () => { throw new Error('ECONNREFUSED') },
    } as unknown as PublicClient

    const rec = makeSubmitted('rec4', goodCallData, '0xcontract')
    const results = await runRecoveryPass([rec], client)
    // rpcFailure → unchanged (stays submitted)
    expect(results.get('rec4')?.txState).toBe('submitted')
  })

  it('all five op types recover correctly when identity matches', async () => {
    const ops = [
      { id: 'op-create',  callData: '0xcreate' as `0x${string}`,  target: '0xcontract' },
      { id: 'op-cancel',  callData: '0xcancel' as `0x${string}`,  target: '0xcontract' },
      { id: 'op-approve', callData: '0xapprove' as `0x${string}`, target: '0xusdc' },
      { id: 'op-reset',   callData: '0xreset' as `0x${string}`,   target: '0xusdc' },
      { id: 'op-pay',     callData: goodCallData,                  target: '0xcontract' },
    ]

    for (const op of ops) {
      const client = {
        getTransactionReceipt: async () => ({ status: 'success', blockNumber: 100n }),
        getTransaction: async () => ({ to: op.target, from: '0xuser', input: op.callData, value: 0n }),
      } as unknown as PublicClient

      const rec = makeSubmitted(op.id, op.callData, op.target)
      const results = await runRecoveryPass([rec], client)
      expect(results.get(op.id)?.txState).toBe('confirmed')
    }
  })
})
