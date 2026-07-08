# Milestone: Auto-chain bridge + approval gate (transitional)

**ID:** M4a | **Status:** pending | **Dependencies:** M7 | **Risk:** Medium | **Effort:** Medium

## Goal
Bridge `draft_goal_contract` → queued follow-up → user confirm + `autoStartGoalRuntime` (existing unconditional activation; no panel yet), fail-closed non-interactive, with contract→goal field byte-identity at the handoff.

## Success Criteria
- [ ] goal-workflow tests: drafting a contract leads — via the queued-follow-up path, not inline in the tool handler (ctx.ui.confirm availability verified for the chosen seam) — to a confirm; approval ⇒ auto-create/activate + auto prompt; decline ⇒ nothing activates; non-interactive ⇒ refuses (fail-closed). TRANSITIONAL: the activate-on-approval assertion is superseded by M4b's gated flow.
- [ ] goal-workflow tests: the autostart-created goal's objective/successCriteria/evidenceRequired equal the contract fields byte-for-byte (objectiveHash protection).
- [ ] goal-workflow + extension tests: pinned auto-chain/registration assertions updated (named work); manual `/goal create→activate→complete` remains untouched and ungated (explicit test).
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts`

## User Value
Removes the manual `/goal` step; adds a contract-review confirm (new for low-risk contracts). Old manual flow survives forever.

## Abort Point
Yes — today's pipeline + one approval gate, no manual `/goal`.
