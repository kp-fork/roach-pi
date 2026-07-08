# Milestone: Final security/qa review panel + completion gate + fix recycling

**ID:** M6 | **Status:** pending | **Dependencies:** M5 | **Risk:** Medium-High | **Effort:** Large

## Goal
Review gate at goal completion (autostart sets `gates.review`) with FIXED ordering: verifier PASS → `open_panel`(review) → security+qa parallel → all-PASS ⇒ `complete_target`; any FAIL ⇒ blocking findings materialize as fix subgoals (driven via M5's loop) + re-request continuation, NO `complete_target` call. Recycling requires a FRESH post-fix `request_completion` → verifier PASS before the FULL panel re-run (fix subgoals do not stale the old goal-verifier receipt — checked). Goal SKILL.md completion language aligned.

## Success Criteria
- [ ] goal-state tests: with `gates.review`, `complete_target` throws unless the review panel is all-PASS (the completion invariant's THIRD edit — named work); flag absent ⇒ unchanged.
- [ ] goal-workflow tests: review FAIL ⇒ fix subgoals + recycling (NOT a thrown complete_target error); after fixes, a fresh request_completion → verifier PASS precedes the FULL panel re-run; both-PASS completes; same-finding third failure escalates; phase held at goal_active; a trivial-escape goal still requires review PASS.
- [ ] skill-docs tests: goal SKILL.md completion language references validator/review gates (old "Goal PASS: stop" semantics gone); legacy negative list holds.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/index.ts`, `goal-state.ts`, `goal-continuation.ts` (re-request continuation reason if needed), `skills/agentic-goal/SKILL.md`, `tests/goal-state.test.ts`, `tests/goal-workflow.test.ts`, `tests/skill-docs.test.ts`

## User Value
Self-terminating pipeline: security/qa gate completion; FAILs recycle into fixes; escalation instead of loops. Manual flow still ungated.

## Abort Point
Yes — completes brief Success Criterion 1.

## Notes
Split candidate if plan-time task count exceeds 12 (recycling is the seam). Accepted residual: a model that never re-requests completion leaves the goal active until user intervention (today's failure mode; no turn-end hook).
