# Milestone: Panel-verdict reducer machinery + gates profile

**ID:** M1 | **Status:** pending | **Dependencies:** None | **Risk:** High | **Effort:** Large

## Goal
Add the fail-closed all-of-N panel primitive (top-level `GoalState.panels: PanelState[]` = `{panelId, purpose, expectedMembers[], round, verdicts[]}` via `open_panel`/`record_panel_verdict`/`activate_goal_gated`) and the reducer-materialized per-goal `gates?: {panel?, validator?, review?}` profile — replay-safe, clone-safe, upgrade-safe, zero live behavior change (no caller sets flags yet).

## Success Criteria
- [ ] goal-state tests: all-of-N approves ONLY when every expected member has APPROVE; zero/partial verdicts rejected (missing = NO); `activate_goal_gated` throws without a satisfied panel, succeeds with one; plain `activate_goal` unconditional — the 5 existing caller test files (session-replay, goal-command, goal-continuation, compaction, goal-state) pass unmodified.
- [ ] goal-state tests: `create_goal` MATERIALIZES `goals[].gates`; malformed `gates` rejected by `isGoalCommand`; gates-absent `complete_target` branch behavior-identical (golden pre-gates sequence).
- [ ] goal-state tests: `createGoalState` initializes `panels`; `cloneState` deep-clones it (mutation-isolation test).
- [ ] goal-events tests: new commands + gates-carrying create_goal round-trip replay; pre-gates fixture log (no snapshot) reconstructs statuses; MIXED resume (snapshot mid-panel + verdict event on top); UPGRADE test — pre-panels snapshot (no panels/gates) loaded via the real restore path + one legacy command ⇒ no throw.
- [ ] `schemaVersion` still `1`; `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `tests/goal-state.test.ts`, `tests/goal-events.test.ts`

## User Value
None visible by design — a unit-proven, dormant gate vocabulary all later milestones consume.

## Abort Point
Yes (safe-merge; no user-visible value).

## Notes
Long-pole: mixed-resume + upgrade fixtures. PanelState shape pinned in draft-v4 decision #3 — do not rediscover mid-cycle. Forward-compat: new commands replayed on older code are dropped (downgrade unsupported — accepted risk). Panel round-cap (3) lives in PanelState, SEPARATE from the failure budget.
