# Delivery and review workflow

The workflow is design → executable development task → implementation → automated checks → independent review → fix → recheck → local acceptance → external release/submission gates.

## Reproducible automated checks

Install Node 24.19.0 and pnpm 11.25.0, then run:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm ci:local
```

On Linux use `pnpm exec playwright install --with-deps chromium`.

The same command runs in `.github/workflows/ci.yml` on pushes, pull requests and manual dispatch. It checks frozen installation, dependency advisories (high/critical findings fail), compiler/ABI, contract and client tests, formatting, actual loopback RPC integration, a fixture production build, browser flows, and a default release build with no local deployment manifest. It starts its own isolated local EVM, refuses occupied ports 8545/9545/4173, stops owned processes, records a source SHA-256 inventory, and fails if source changes during verification. No wallet secrets or external writes are needed. Logs and the summary are under `outputs/ci/`; GitHub retains diagnostic artifacts for 14 days.

There is no configured remote repository at present. The workflow file is prepared and the equivalent local runner is executable; a hosted GitHub run and protected-branch enforcement cannot be claimed until a repository exists. On that repository require `local-validation` and independent review before merging; do not use `pull_request_target` or give checks write credentials.

External network observations run separately. `RUN_ARC_READONLY=true pnpm test:browser --grep "production browser can read real Arc"` needs the local fixture/preview; `pnpm check:arc` performs public RPC reads. A failed requested observation fails; an unrequested probe is explicitly skipped. Neither is canonical-token write validation.

## Independent review and repairs

The reviewer reads the original design and source independently of the implementer's report. Each finding records severity, reproduction, affected source, consequence and acceptance test. Blocking findings return to implementation. Recheck the actual changed paths and relevant regressions, then run full local CI against the final source. A reviewer must close findings explicitly. Two unsuccessful repair cycles require a concrete escalation rather than an infinite agent loop.

Keep original findings in `outputs/splitlink-independent-review.md`; fixes and reviewer disposition are recorded separately. Local acceptance is bound to the source fingerprint, CI summary and reviewer turn. A changed source invalidates local acceptance until rechecked.

## Release and submission

Local acceptance, canonical Arc integration, actual-host acceptance, Studio provenance and competition eligibility are separate statuses. A green local CI run does not enable an Arc deployment, certify competition rules or authorize funds movement. No deployment is a side effect of CI.

`submission/` holds the English entry copy, recording plan and honest evidence register. Missing user-account, Studio, repository, hosted app or chain evidence remains a submission blocker. Account creation/terms, wallet signatures and real-funds actions must use the user's actual identity and authorization. Never invent links, addresses, hashes, provenance or successful submission receipts.
