# Milestone: Re-entrant worker→validator loop + goal-level ownership + 3-strike halt

**ID:** M5 | **Status:** pending | **Dependencies:** M2, M4b, M7 | **Risk:** High | **Effort:** Large

## Goal
Implement draft-v4 decision #10 for `gates.validator` goals (autostart sets the flag): a RE-ENTRANT runtime loop dispatches worker subagent → information-isolated validator per subgoal, applies `record_validator_receipt` + `complete_target` itself, and queues a self-continuation (new continuation reason) that re-enters next turn — for the next subgoal AND, after the last, for goal-level completion (verifier gate). The worker loop is the SOLE retry driver (accumulated feedback; no `verifier_fail` follow-up for flagged subgoals; `buildVerifierFailureContinuationPrompt` branches on the flag). Main-agent prompts for flagged goals use pinned orchestrator literals. 3-strike budget halts with a blocker-summary escalation. Task-0 of the plan cycle: cheap conformance check of the re-entrant seam decision.

## Success Criteria
- [ ] goal-workflow tests: flagged goal — worker→validator dispatch order per subgoal (mock call sequence); runtime applies receipt + completion; self-continuation re-enters for the next subgoal and, after the last, drives goal-level completion (verifier gate) — the full flagged chain reaches goal completion (or review-pending post-M6) with ZERO main-agent implement instructions; unflagged goal keeps today's prompts byte-compatible (golden), including BOTH continuation builders.
- [ ] Isolation (call-site): worker mock emits a sentinel; the validator's runAgent args contain the subgoal objective/criteria/evidence verbatim, do NOT contain the sentinel, and use contextMode:"fresh".
- [ ] goal-workflow tests: validator FAIL re-dispatches the worker with ALL prior verdict feedback and queues NO verifier_fail follow-up (exactly one retry driver); goal-level verifier FAIL routes blockers into fix subgoals via the loop or escalates; flagged prompts contain the pinned orchestrator marker and NOT "Implement the current active subgoal"; a trivial-escape goal still requires validator PASS.
- [ ] goal-continuation tests (existing 265-line file): legacy line-152 "keeps retrying … without a max failure budget" case REPLACED by the 3-strike halt (exercised via the validator dispatch path) with blocker-summary escalation.
- [ ] Mini-chain smoke: contract → panel ×3 APPROVE → confirm → autostart → subgoal worker→validator PASS → completed. `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/index.ts`, `goal-continuation.ts` (halt read + new self-continuation reason + both prompt builders' who-implements branches), `skills/agentic-goal/SKILL.md` (orchestrator language + recommend manual /goal for small tasks), `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts`, `tests/skill-docs.test.ts`
- Create: `subgoal-validator.ts` (exported prompt builder + PASS/FAIL parsing into the M2 receipt shape), `tests/subgoal-validator.test.ts`

## User Value (tradeoff stated)
Flagged goals gain isolated implement→validate autonomy with self-halting retries. COST: live steerability and per-subgoal subprocess latency — implementation moves out of the conversation. Unflagged/manual goals unchanged.

## Abort Point
Yes — informed: stop at M4b for interactive execution + vetted front half; stop here for the full autonomous loop minus the final review panel.

## Notes
Validator parsing uses the existing PASS/FAIL verifier grammar, NOT M3's panel module. Reference implementation for programmatic dispatch: runGoalVerifier (index.ts:1872-1917).
