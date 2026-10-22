# SplitLink

**One customer payment. Every team member paid directly.**

## Problem

Small freelance teams often receive a single customer payment through one coordinator, who must redistribute funds and explain the resulting transfers. That creates extra work and a gap between what the customer paid and what each contributor received.

## Solution

SplitLink creates a public, fixed-amount USDC payment link for two to five recipients. The creator sets immutable ordered shares and sends one link. A customer reviews the exact allocations and signs one payment. The contract transfers directly to each recipient in one atomic transaction: every allocation succeeds or the payment reverts. There is no platform fee or intermediary balance.

Creators can recover their requests from public events and cancel open requests. Public receipts identify the actual payer and verify settlement events; they do not mistake a token approval or a failed attempt for a payment. Amounts use integer arithmetic, with an explicit last-recipient remainder. Browser recovery preserves unknown attempts and never automatically resubmits them.

## Technical implementation

An immutable Solidity contract uses SafeERC20 and reentrancy protection. The English React/TypeScript client uses viem, an allowlisted deployment manifest and read-only public RPC access. There is no backend database or signing service. The repository includes contract property tests, fault-injected local RPC tests, browser payment/cancellation/recovery scenarios, production route configuration and a repeatable CI command.

## Current evidence statement

The current artifact is a local implementation with isolated EVM/mock-token evidence. It is not yet an Arc-mainnet deployment or a competition-qualified submission. Studio provenance, actual canonical-token validation, intended public-host verification, entrant eligibility and current official rules must be established before replacing this statement with production claims.

## Arc Studio usage statement

An actual Studio project has not been created yet. The present source was implemented locally. Do not describe it as Studio-built, and do not imply that a later import retroactively establishes acceptable competition provenance. The organizer must accept the actual workflow and the final release must trace to its genuine Studio build/test/export history.

## Next steps after verification

Complete the authorized Studio workflow, validate the canonical token and shared gas balance, deploy the reviewed source, verify public links from a clean browser, and record a real USDC settlement. The demonstration must show the actual Studio history and mainnet transaction separately from any local development footage.
