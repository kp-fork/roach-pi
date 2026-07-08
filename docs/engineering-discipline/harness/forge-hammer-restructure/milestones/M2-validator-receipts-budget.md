# Milestone: Validator receipts + failure budget reducer machinery

**ID:** M2 | **Status:** pending | **Dependencies:** M1 | **Risk:** Medium | **Effort:** Medium

## Goal
Add per-subgoal validator receipts as a DISTINCT receipt type (identity literal, `validator_pass`/`validator_fail` ledger types, `isValidatorReceipt` replay clause) with the flag-conditional replaces-verifier subgoal precondition (incl. the completion invariant's ledger-type lookup widening), and wire the dormant `consecutiveFailures` budget — gated on `gates.validator`, zero live behavior change.

## Success Criteria
- [ ] goal-state tests: with `gates.validator`, subgoal `complete_target` succeeds with exactly {validator PASS receipt + validator_pass ledger row} and throws without either (FULL invariant incl. ledger cross-check); gates absent ⇒ existing verifier rule byte-identical.
- [ ] `npm run build` green with the distinct validator receipt type; `isValidatorReceipt` keyed on command type AND pinned to the validator identity literal; `isVerifierReceipt` stays identity-strict; forward negative tests both directions (verifier-identity receipt rejected by the validator gate, and vice versa).
- [ ] goal-state tests: `bumpFailureBudget` fires only for targets whose goal has `gates.validator` — FAIL increments / PASS resets for `record_verifier_result` + `record_validator_receipt`; survives the clear_continuation-before-record ordering; an UNGATED FAIL leaves `consecutiveFailures` untouched. Panel verdicts NEVER touch the budget.
- [ ] goal-events tests: pre-validator-era fixture replay reconstructs completions; validator receipt round-trips replay.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/goal-state.ts`, `goal-events.ts`, `tests/goal-state.test.ts`, `tests/goal-events.test.ts`

## User Value
None visible by design; dormant until M5.

## Abort Point
Yes (safe-merge; no user-visible value).

## Notes
Gate precedence (decided): flagged subgoal ⇒ validator PASS replaces verifier at subgoal level; verifier remains the goal-level gate. Optional plan-crafting choice: hoist consecutiveFailures to top-level GoalState (currently nested but preserved through clear_continuation — SC is the regression guard).
