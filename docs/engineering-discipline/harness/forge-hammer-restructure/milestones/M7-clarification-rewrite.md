# Milestone: Forge-style clarification rewrite + kickoff prompt ownership

**ID:** M7 | **Status:** pending | **Dependencies:** None | **Risk:** Medium | **Effort:** Medium

## Goal
Rewrite the clarification skill AND the runtime clarify-kickoff prompts (one-question-at-a-time is hardcoded at index.ts:1193/1616/1619, NOT in the skill) to recon-first + ONE bundled ≤4-question round with defensible `ASSUMPTION:`-prefixed defaults; clarify name kept; no new reducer actions.

## Success Criteria
- [ ] skill-docs tests: rewritten SKILL.md pins — recon-before-questions, single bundled ≤4-question round, defensible-default language, literal `ASSUMPTION:`; one-question-at-a-time language absent; legacy negative list holds.
- [ ] extension tests: the three index.ts kickoff/delegation prompt strings no longer contain "Ask ONE question" and contain the bundled-round instruction (M7 owns these pins).
- [ ] clarification tests: `ASSUMPTION:`-prefixed values do not block `canDraftGoalContract` and are retrievable with the prefix intact; replay clean with NO new command types.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/skills/agentic-clarification/SKILL.md`, `index.ts` (kickoff prompt strings only), `tests/skill-docs.test.ts`, `tests/extension.test.ts`, `tests/clarification-state.test.ts`, `tests/clarification-events.test.ts`

## User Value
Live clarify behavior actually changes: recon-grounded defaults, at most one bundled round.

## Abort Point
Yes — standalone UX improvement.

## Notes
clarification-state.ts UNCHANGED (value-prefix convention). Byte-identity of the prefix into the goal is asserted at the M4a handoff, not here.
