# Milestone: Contract critic panel orchestration (panel-first single approval)

**ID:** M4b | **Status:** pending | **Dependencies:** M1, M3, M4a | **Risk:** High | **Effort:** Large

## Goal
Insert the 3-critic panel BEFORE the approval: `open_panel` → parallel dispatch (reviewer-feasibility/architecture/risk) → verdicts via M3 parser → on any REJECT a findings follow-up drives model revision (phase `goal_drafting`, persisted rounds, cap 3, deadlock ⇒ escalate) → on convergence present the converged contract for the ONE confirm → `activate_goal_gated` (sets `gates.panel`). Trivial escape: `suggestedSubgoals<=1 && successCriteria<=2 && !high-risk` skips the panel only.

## Success Criteria
- [ ] goal-workflow tests (mocked runAgent, M3-format verdicts): non-trivial contract dispatches 3 critics in parallel; activation only via `activate_goal_gated` after 3 APPROVEs AND the post-convergence confirm; confirm fires EXACTLY once per run, always on the converged contract text; subgoals then complete via the existing verifier gate.
- [ ] goal-workflow tests: REJECT ⇒ findings follow-up; re-entry re-runs the FULL panel with incremented persisted round; 4th round escalates without activation; trivial contract skips the panel but still confirms.
- [ ] goal-workflow tests: killed-and-restored mid-panel session reconstructs panel state and re-enters on the next goal-routed user turn (one-turn resume residual); tests do NOT assert consecutiveFailures emptiness (M2 populates it in the parallel wave).
- [ ] verdict-format + extension tests green (parser consumed; registration pins updated — named work).
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts`

## User Value
Contracts adversarially vetted before start; the single approval is of the exact artifact that activates (no post-approval drift).

## Abort Point
Yes — full forge-equivalent front half with familiar interactive execution (the recommended stop for users who want vetting without autonomous execution).

## Notes
Mid-panel restarts are PRE-approval, so "no input after approval" holds. Post-confirm/pre-activation crash window re-confirms on restart (tiny, documented).
