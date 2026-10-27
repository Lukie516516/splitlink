/**
 * Test-only re-exports of unexported journal internals.
 * Imported exclusively by tests/splitlink-safety.test.ts.
 * Do NOT import from production code outside tests.
 *
 * These are the ACTUAL PRODUCTION functions exported with test-visible names.
 * There are NO duplicated implementations here — the functions live only in
 * journal.ts and are exercised directly by tests.
 */

export {
  recoverRecord,
  generateRecordId,
  isValidRecord_PROD as isValidRecord_TESTONLY,
  clearCachedSuccessOnRestore_PROD as clearCachedSuccessOnRestore_TESTONLY,
  type TransactionRecord,
  type RecoveryOutcome,
} from "./journal";
