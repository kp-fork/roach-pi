# Checkpoint: M5 — Re-entrant worker→validator loop + goal-level ownership + 3-strike halt

**Completed:** 2026-07-08 13:20 | **Duration:** ~55m | **Attempts:** 1

## Plan File
`docs/engineering-discipline/plans/2026-07-08-m5-worker-validator-loop.md`
## Review File
`docs/engineering-discipline/reviews/2026-07-08-m5-review.md` (VERDICT: PASS)

## Test Results
Worktree gate: 73 files / 800 tests green, tsc clean. Post-merge integrated suite: 73 / 800 green, tsc clean.

## Files Changed
Modified: index.ts (+171/-27), goal-continuation.ts (+60), skills/agentic-goal/SKILL.md (+6), tests/goal-workflow.test.ts (+302), tests/goal-continuation.test.ts (+80), tests/skill-docs.test.ts (+5)
Created: subgoal-validator.ts, tests/subgoal-validator.test.ts

## Interface Contracts Established
- Autostart gates: non-trivial `{panel:true, validator:true}`; trivial `{validator:true}` (panel-only escape holds).
- `subgoal-validator.ts`: `buildSubgoalValidatorPrompt` (subgoal fields ONLY — isolation), parse via existing PASS/FAIL grammar, receipt in M2's GoalValidatorReceipt shape (objectiveHash matches buildGoalObjectiveHash).
- `runSubgoalWorkerCycle` (index.ts): karpathy-augmented worker → fresh isolated validator → record_validator_receipt; PASS ⇒ runtime complete_target + `validator_next` self-continuation (free-form queue_continuation reason — no reducer change); FAIL ⇒ next-turn worker re-dispatch with ALL accumulated feedback; ≥3 ⇒ escalation halt.
- `runGoalLevelCompletion`: after last subgoal, the loop drives goal-level completion through the VERIFIER gate. `buildVerifierFailureContinuationPrompt` branches on gates.validator (orchestrator wording; no "implement" instruction to the observer). Fix-subgoal materialization on goal-FAIL: deferred to M6 (escalation branch shipped here).
- `planGoalContinuation` new decision `escalate`/`failure_budget_exhausted` (reads consecutiveFailures; never writes). Legacy no-budget behavior REMOVED.
- Prompt literals: flagged prompts contain "The runtime is implementing subgoals", never "Implement the current active subgoal" (that literal survives only in unflagged buildGoalAutoPrompt — golden byte-compatible). SKILL.md "Who Implements" section + manual-/goal-for-small-tasks recommendation.

## State After Milestone
The hammer loop is live: flagged goals implement via worker subagents, validate in isolation, self-continue across turns, self-halt at 3 strikes. Goal completion still verifier-gated; review panel + recycling arrive in M6.
