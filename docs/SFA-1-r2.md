# SFA-1 / A8 external repair — revision 2

Base is the fixed 136-file Studio-derived candidate SHA-256 `64f5afcab80f62f29c4159bec4cd9e332b11422db40c1fc968ffd14329e08565`. The original candidate and its reports/audit are preserved. This revision is external development after Studio export/quota interruption, not an additional Studio run or eligibility approval.

## Defect

Overlapping `HistoryCursor.scan` calls constructed ranges from shared head/gap state, then committed after unrelated awaits. A delayed older gap success could clear a newer unread suffix. Page-level generation checks after `scan` returned could not undo that coverage mutation.

## Product repair

- `src/lib/history.ts`: every cursor scan now enters a per-cursor FIFO. Range snapshots, successful-page accumulation and head/gap commits execute exclusively. A failed or aborted queued operation releases its successor without discarding outstanding coverage. Results remain individual snapshots; the next caller constructs ranges from the preceding committed state, not the state when it first called scan.
- `src/components/MyRequests.tsx`: all initial/revision/manual/focus/timer triggers share a context-scoped scan queue spanning the head fetch, cursor work, bounded canonical row reads and UI commit. Changing wallet/context starts a new queue/cursor; stale queued callbacks retain the existing early context guard. Old context results cannot mutate a new cursor. Existing partial rows and stale-action disabling remain in place.

The fix does not change the complete label, fabricate empty history, skip unread blocks, reset on every retry or require a reload. The underlying missing suffix is actually fetched before completion.

## New tests of production code

- `tests/production.test.ts`: establishes gap1..100 through a real failed scan, holds an older retry, queues head200 with an actual failed suffix, releases the old gap, then requires a successful fetch covering101..200 before complete. No cursor fields are manually edited. FIFO correctly prevents the invalid old/new commit ordering itself. A second regression checks rejection/abort releases the queue and older captured heads do not regress committed head.
- `tests/browser/product.spec.ts`: uses the mounted app, actual local chain/token, and injected RPC faults. Initial history fails, an old-gap retry response is held, a new request advances the chain, focus and manual refresh overlap, then the suffix remains inaccessible. It requires retained old rows, honest partial state and no new row until a later successful RPC retry covers the missing suffix, after which the request appears and history becomes complete without reload.

All previous boundary/shrink/row-failure/wallet-context regressions remain. Original root implementation and fixed candidate are not modified. Full final commands/results/hashes are in the separate r2 development report/result outside this candidate.
