# Checkpoint: M2 — Validator receipts + failure budget reducer machinery

**Completed:** 2026-07-08 12:18 | **Duration:** ~35m | **Attempts:** 1

## Plan File
`docs/engineering-discipline/plans/2026-07-08-m2-validator-receipts-budget.md`
## Review File
`docs/engineering-discipline/reviews/2026-07-08-m2-review.md` (VERDICT: PASS)

## Test Results
Worktree gate: 72 files / 775 tests green, tsc clean. Post-merge integrated suite: 72 / 779 green.

## Files Changed
Modified (additive-only, +619/-0): goal-state.ts, goal-events.ts, tests/goal-state.test.ts, tests/goal-events.test.ts

## Interface Contracts Established
- `GOAL_VALIDATOR_AGENT = "plan-validator"`; DISTINCT `GoalValidatorReceipt {…, validatorAgent, recordedAt}` in `SubgoalItem.validatorReceipts?` (optional; `? map : undefined` clone — no phantom []).
- Command `record_validator_receipt` (subgoal-only) + ledger types `validator_pass`/`validator_fail` (data.receiptId).
- Gated precedence: parent goal `gates.validator` ⇒ subgoal completion via `assertValidatorCompletionInvariant` (top-of-function early return; latest validator PASS + validator_pass ledger row + fresh objectiveHash; NO verifier receipt needed); gates absent ⇒ verifier body byte-identical.
- `bumpFailureBudget(state, targetId, verdict)`: gated-only; wired into `record_verifier_result` + `record_validator_receipt`; FAIL increments `continuation.consecutiveFailures[targetId]`, PASS resets; survives clear_continuation ordering; panels never touch it.
- `isValidatorReceipt` allowlist branch (command type + identity literal, both-direction negatives); `isVerifierReceipt` untouched. schemaVersion 1.

## State After Milestone
Dormant validator gate + live-but-gated failure budget. Nothing sets gates.validator until M5.
