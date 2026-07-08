# Milestone: Binary-checklist agent roster + panel verdict-format contract

**ID:** M3 | **Status:** pending | **Dependencies:** None | **Risk:** Low-Medium | **Effort:** Medium

## Goal
Reframe reviewer-feasibility/architecture/risk into binary contract-granularity critics (feasibility/integration/coverage lenses), add security-reviewer + qa-reviewer (implementation-critic fraud checks folded into qa), and create `verdict-format.ts` — the panel APPROVE/REJECT grammar constant + parser both the .md bodies and the runtime consume.

## Success Criteria
- [ ] agents tests: pinned roster holds (three reviewer-* names unchanged; security-reviewer/qa-reviewer added; synthesis/reviewer-dependency/reviewer-user-value absent); every reviewer body contains the mechanical verdict rule ("unchecked is NO"; APPROVE/PASS iff every check YES or N/A) and the `VERDICT:` line spec; no graded scales; qa-reviewer contains the folded fraud checks (genuine bodies / no criteria-shaped hardcoding / tests can fail / no swallowed failures).
- [ ] agents tests: each contract-critic body contains the `ASSUMPTION:` recognition rule (assumption-marked defaults are valid content, not invented decisions/placeholders).
- [ ] new verdict-format tests: APPROVE fixture in the exact .md-prescribed format parses to APPROVE; REJECT to REJECT; malformed input errors; drift assertion pins each .md's VERDICT-line spec to the shared exported constant.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

## Files Affected
- Modify: `extensions/agentic-harness/agents/reviewer-feasibility.md`, `reviewer-architecture.md`, `reviewer-risk.md`, `tests/agents.test.ts`
- Create: `agents/security-reviewer.md`, `agents/qa-reviewer.md`, `verdict-format.ts`, `tests/verdict-format.test.ts`

## User Value
Reviewable binary-checklist roster with a machine-verified output contract. Source checklists (verbatim): planning/critiques + glm-hammer agents/*.md (see problem brief Lens G).

## Abort Point
Yes.

## Notes
`verdict-format.ts` scope = panel APPROVE/REJECT ONLY; validator/verifier keep the existing `Verdict: PASS|FAIL` grammar (goal-verifier.ts).
