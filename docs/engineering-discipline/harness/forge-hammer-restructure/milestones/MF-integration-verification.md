# Milestone: Integration Verification

**ID:** MF | **Status:** pending | **Dependencies:** M1, M2, M3, M4a, M4b, M5, M6, M7 | **Risk:** Medium | **Effort:** Small

## Goal
Validate that all milestones compose into the brief's single-gate autonomous pipeline with no regressions.

## Success Criteria
- [ ] Full-chain integration case in tests/goal-workflow.test.ts (scripted runAgent mock; FRESH goal — frozen-gates policy): contract → panel APPROVE×3 → confirm asserted EXACTLY once → autostart → two subgoals worker→validator PASS via re-entrant continuations → goal verifier PASS → review both-PASS → goal `completed`; zero other user-input calls.
- [ ] Same chain with one injected validator-FAIL round and one review-FAIL round (incl. post-fix fresh verifier PASS) converges within the failure budget.
- [ ] Cross-file literal check: clarification SKILL.md + the three critic .md files contain the identical `ASSUMPTION:` literal.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` passes in full; each milestone's named test files re-run green.

## Files Affected
- Modify: `tests/goal-workflow.test.ts` (test-only; no production code)

## User Value
Confidence the system works as a whole — brief Success Criterion 1 demonstrated in CI.

## Abort Point
No — this is the final gate.
