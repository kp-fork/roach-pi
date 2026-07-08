# M7 — Forge-style clarification rewrite + kickoff prompt ownership

> **Worker note:** Execute strictly in task order. Task 0 locks the test surface first (some assertions FAIL, some PASS — read Task 0 carefully). After each task passes its stated verification, flip its checkbox. `clarification-state.ts` and `clarification-events.ts` (the source modules) MUST NOT be edited — this milestone is a documentation/prompt rewrite plus test additions only. If any step tempts you to add a reducer command or state field, STOP: the value-prefix convention (`ASSUMPTION: ` inside `mark_checklist_item.value`) is deliberately zero-code.

**Goal:** Rewrite the clarification skill AND the three runtime clarify-kickoff prompt strings so live clarify behavior is recon-first + ONE bundled ≤4-question round with defensible `ASSUMPTION:`-prefixed defaults, replacing the hardcoded one-question-at-a-time behavior — keeping the `agentic-clarification` name, adding no reducer commands, and leaving the Goal Contract gate mechanics untouched.

**Architecture:** The one-question-at-a-time behavior is NOT in the skill alone — it is hardcoded in three `index.ts` prompt strings that the runtime injects: the clarifying-phase system-guidance rule (`clarificationQuestionRule`, index.ts:1192-1194, consumed by `PHASE_GUIDANCE.clarifying` at :1211) and the two root-session `/clarify` kickoff delegation prompts (interactive-with-topic :1616, no-topic :1619). M7 rewrites `skills/agentic-clarification/SKILL.md` to forge-style (recon → one bundled round → defensible defaults) and surgically swaps the "Ask ONE question…" clause in each of the three strings for a canonical bundled-round instruction, preserving every other byte (delegation wrapper, conditional-explorer token-saving sentence, `clarification_state`/`Gate: PASS` sequence, `/goal` handoff). Defaults the agent can defend are recorded through the EXISTING `mark_checklist_item` command with values prefixed `ASSUMPTION: ` — a string convention, so `clarification-state.ts` needs no change and replay carries the prefix intact.

**Tech Stack:** TypeScript ESM, Pi extension API (`@mariozechner/pi-coding-agent`), Vitest, Markdown skill docs. No new runtime dependencies.

**Work Scope:**
- **In scope:** Rewrite `skills/agentic-clarification/SKILL.md`; edit the three `index.ts` kickoff prompt strings; update `tests/skill-docs.test.ts` and `tests/extension.test.ts` pins in the SAME tasks as the surfaces they pin; add `ASSUMPTION:`-value characterization assertions to `tests/clarification-state.test.ts` and `tests/clarification-events.test.ts`.
- **Out of scope (do NOT touch):** `clarification-state.ts`, `clarification-events.ts` (source modules — unchanged); `autoStartGoalRuntime` and the `/goal` handoff semantics (M4a owns the handoff-sentence rewrite later — leave the `/goal` handoff sentence in place); the `ask_user_question` tool `promptGuidelines` at index.ts:424-430 (see Scope Boundary Note); the non-root `/clarify` branches (index.ts:1194, :1617, :1620 — they already say "do not ask the user questions directly" and stay byte-identical); goal skill, agent roster, verdict-format, goal reducer.

**Verification Strategy:**
- **Level:** test-suite + build (the exact gate CI enforces on push to main).
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped command (per-task iteration):** `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts tests/extension.test.ts tests/clarification-state.test.ts tests/clarification-events.test.ts`
- **What passing proves:** rewritten SKILL.md pins hold and legacy/one-at-a-time language is gone; the three kickoff strings carry the bundled-round instruction and no longer say "Ask ONE question"; `ASSUMPTION:`-valued checklist items pass `canDraftGoalContract` and round-trip replay with the prefix intact and NO new command types; nothing else regressed.

**Success Criteria** (verbatim from milestone M7):
- [ ] skill-docs tests: rewritten SKILL.md pins — recon-before-questions, single bundled ≤4-question round, defensible-default language, literal `ASSUMPTION:`; one-question-at-a-time language absent; legacy negative list holds.
- [ ] extension tests: the three index.ts kickoff/delegation prompt strings no longer contain "Ask ONE question" and contain the bundled-round instruction (M7 owns these pins).
- [ ] clarification tests: `ASSUMPTION:`-prefixed values do not block `canDraftGoalContract` and are retrievable with the prefix intact; replay clean with NO new command types.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

---

## Canonical literals (use these EXACT strings in every touched surface so pins line up)

| Token | Exact literal |
|---|---|
| Bundled-round instruction (short form for prompt strings) | `Bundle up to 4 independent questions into ONE ask_user_question round after recon; prefer a defensible ASSUMPTION: default over asking, and never ask what the codebase can answer.` |
| Recon-first principle (SKILL.md) | `The user should never be asked something the codebase can answer.` |
| Defensible-default principle (SKILL.md) | `Prefer proposing a defensible default over asking.` |
| Assumption value prefix (reducer value, exact — trailing space then content) | `ASSUMPTION: ` |

The `ASSUMPTION:` substring (colon, no space required for the pin) is the literal cross-checked in M_final against the three critic `.md` files — keep it byte-stable.

---

## File Structure Mapping

**Modify (source):**
- `extensions/agentic-harness/skills/agentic-clarification/SKILL.md` — full forge-style rewrite (Task 1).
- `extensions/agentic-harness/index.ts` — three prompt strings only, anchored by symbol:
  - `clarificationQuestionRule` const (root branch of the ternary, ~:1193) — the clarifying-phase system-guidance rule consumed by `PHASE_GUIDANCE.clarifying`.
  - the `prompt` assignment inside the `/clarify` command handler (`commands` registration whose handler calls `applyAndPersistClarificationCommand(... start_interview ...)` then `pi.sendUserMessage(prompt)`): the `topic && isRootSession` branch (~:1616) and the `!topic && isRootSession` branch (~:1619).

**Modify (tests):**
- `extensions/agentic-harness/tests/skill-docs.test.ts` — `describe("clarification skill goal handoff")` block (Task 0 authors new pins; Task 1 turns green).
- `extensions/agentic-harness/tests/extension.test.ts` — `describe("/clarify Command")` block (~:819) for sites 1616/1619; add a clarifying-phase system-prompt assertion for site 1193 (Task 0 authors; Task 2 turns green).
- `extensions/agentic-harness/tests/clarification-state.test.ts` — add one `ASSUMPTION:`-value characterization test (Task 3).
- `extensions/agentic-harness/tests/clarification-events.test.ts` — add one `ASSUMPTION:`-value replay characterization test (Task 3).

**Must NOT change:** `clarification-state.ts`, `clarification-events.ts`, `index.ts:424-430`, index.ts non-root branches, autostart, goal modules.

---

## Scope Boundary Note (read before starting)

The `ask_user_question` tool's `promptGuidelines` at index.ts:424-430 contains `"Ask one focused question at a time. Do not bundle multiple questions."`. This is a **global tool guideline for every skill that uses the tool**, not a clarify kickoff/delegation prompt, and it is not one of the three sites the milestone owns. It is **out of M7 scope** and stays unchanged. Reconciliation: "bundle up to 4 independent questions into ONE round" is satisfiable as up to four *sequential* focused `ask_user_question` calls within a single pre-contract turn — each call is still one focused question — so the tool guideline and the new round-structure instruction are not in direct contradiction. This tension is recorded here so a downstream reviewer sees it was a deliberate boundary, not an oversight. If a later milestone wants the tool itself to support a multi-question payload, that is new scope.

---

## Task 0 — Baseline Lock (author the test surface first)

**Dependencies:** None
**Files:** Modify `tests/skill-docs.test.ts`, `tests/extension.test.ts`

Author the new/updated assertions BEFORE editing any source. Do NOT yet author the clarification-state/events characterization tests — those land in Task 3 (they pass at baseline, so keeping them separate keeps this task's FAIL signal clean).

- [ ] **Step 1 — skill-docs pins (will FAIL until Task 1).** In `tests/skill-docs.test.ts`, `describe("clarification skill goal handoff")`, ADD to the existing `it(...)` (keep every existing assertion in that block intact — they must still hold after the rewrite):
  ```ts
  // recon-before-questions
  expect(src).toContain("The user should never be asked something the codebase can answer.");
  // single bundled ≤4-question round
  expect(src).toContain("ONE ask_user_question round");
  expect(src).toContain("up to 4 independent questions");
  // defensible defaults + ASSUMPTION literal
  expect(src).toContain("Prefer proposing a defensible default over asking.");
  expect(src).toContain("ASSUMPTION:");
  // one-question-at-a-time language must be gone
  expect(src).not.toContain("One question per message");
  expect(src).not.toContain("Never bundle multiple questions");
  expect(src).not.toContain("Ask user ONE question");
  expect(src).not.toContain("Ask ONE question");
  expect(src).not.toContain("Five questions in one message");
  ```
- [ ] **Step 2 — extension pins for sites 1616/1619 (will FAIL until Task 2).** In `tests/extension.test.ts`, `describe("/clarify Command")` (~:819), ADD to the existing `it(...)` after the current `prompt` assertions (keep all existing assertions — the surgical swap does not disturb them):
  ```ts
  expect(prompt).not.toContain("Ask ONE question");
  expect(prompt).toContain("Bundle up to 4 independent questions into ONE ask_user_question round after recon");
  expect(prompt).toContain("ASSUMPTION:");
  ```
- [ ] **Step 3 — extension pin for site 1193 (clarifying-phase system guidance; will FAIL until Task 2).** Add a NEW `it(...)` in `tests/extension.test.ts` that drives the clarifying phase and inspects the injected system prompt, following the existing phase/system-prompt pattern (see the `before_agent_start` handler usage at :807-812 and the `Active Workflow:` assertions at :676-812). Preferred mechanism: invoke `commands.get("clarify").handler("<topic>", mockCtx)` (which sets `currentPhase = "clarifying"` at index.ts:1603), then call the `before_agent_start` handler and assert on `result?.systemPrompt`. If the handler-then-`before_agent_start` sequencing is awkward in a single test, fall back to firing `session_compact` with `details.phase = "clarifying"` then `before_agent_start` (as :793-810 does for a phase). Assertions:
  ```ts
  expect(result?.systemPrompt).toContain("Active Workflow: Runtime-Enforced Deep Clarification");
  expect(result?.systemPrompt).not.toContain("Ask ONE question per message");
  expect(result?.systemPrompt).toContain("Bundle up to 4 independent questions into ONE ask_user_question round after recon");
  ```
- [ ] **Step 4 — Run and record the baseline.** Run:
  `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts tests/extension.test.ts`
  **Expected:** the added skill-docs assertions FAIL (old SKILL.md still has one-at-a-time language and lacks the new phrases) and the added extension assertions FAIL (old prompt strings still say "Ask ONE question", lack the bundled-round instruction). No PRE-EXISTING assertion should fail — if one does, you disturbed a pinned substring; revert and redo surgically.

**Acceptance:** the newly added assertions fail for the stated reasons; all previously-green assertions in both files still pass.

---

## Task 1 — Rewrite SKILL.md forge-style

**Dependencies:** Task 0
**Files:** Modify `skills/agentic-clarification/SKILL.md`

Rewrite the skill so its behavior matches forge Phase 1 (Deep Recon) + Phase 2 (Minimal Question Round), while keeping the `agentic-clarification` name, the `clarification_state` runtime-gate mechanics, and the Goal Contract as the sole output. The frontmatter `name: agentic-clarification` and a trigger/description compatible with skill-docs discovery MUST be preserved (discovery is directory-name based; keep the dir `agentic-clarification`).

Behavioral spec to encode (every bullet is a requirement of the rewritten prose):
- [ ] **Step 1 — Recon FIRST for implementation requests.** Replace the "One question per message" hard gate and Two-Track framing with: for implementation/codebase-touching requests, dispatch recon explorer subagent(s) FIRST, before asking anything. Keep the EXISTING conditional-explorer token-saving rule verbatim in spirit and in the pinned substrings: `Use explorer only when needed`, `non-code/product/wording clarification` (skip explorer to save tokens/latency), `technical context is missing/uncertain` (dispatch when missing/uncertain). State the core principle line `The user should never be asked something the codebase can answer.`
- [ ] **Step 2 — ONE bundled question round.** Replace the iterative one-question-per-message loop with a single bundled round: after recon, list remaining ambiguities, drop every one recon can answer, and `Bundle up to 4 independent questions into ONE ask_user_question round` (`up to 4 independent questions`, independent only, each grounded in a recon finding). If nothing survives, ask nothing and proceed. Remove the dot-graph "Ask user ONE question" loop nodes and rewrite the diagram to: recon → bundled round (≤4) → contract. Ensure NONE of these phrases survive anywhere in the file: `One question per message`, `Never bundle multiple questions`, `Ask user ONE question`, `Ask ONE question`, `Five questions in one message`.
- [ ] **Step 3 — Defensible defaults recorded as assumptions.** State `Prefer proposing a defensible default over asking.` For every checklist item the agent can reasonably fill itself (rather than ask), record it via `clarification_state` `mark_checklist_item` with the value prefixed `ASSUMPTION: ` (exact literal: the word `ASSUMPTION`, a colon, a space, then the assumed content). Document that these fill checklist items so the gate can pass without a question, and that filling a checklist item with an assumption is preferred over adding a blocking ambiguity. Include the literal `ASSUMPTION:` in the prose.
- [ ] **Step 4 — Carry assumptions into the contract.** Require that every `ASSUMPTION: `-prefixed default is surfaced verbatim in the Goal Contract (e.g. under `### Risks` or a new `### Assumptions` block) so downstream critics can see what was assumed rather than confirmed. Keep the existing Goal Contract format and field words intact (`Objective`, `Scope`, `Non-goals`/`non-goals`, `Success Criteria`/`success criteria`, `Constraints`, `Evidence Required`/`evidence required`, `Risks`, `Technical Context`, `Edge cases`, `Suggested Initial Subgoals`, `Handoff` with `/goal`).
- [ ] **Step 5 — Gate mechanics unchanged.** Keep the `Runtime Gate` section and its `Gate: PASS` / `action=status` / `action=draft_goal_contract` sequence exactly as the reducer expects (the gate/`canDraftGoalContract` logic is unchanged; assumptions pass the gate by completing checklist items). Keep `clarification_state` references. Do NOT reintroduce any legacy routing string: the file must still contain none of `agentic-plan-crafting`, `agentic-milestone-planning`, `/plan`, `milestones`, `run-plan`, `long-run`, and must still not contain `Always use subagents`, `Immediately after asking the user a question`, `Run in parallel with user Q&A`.
- [ ] **Step 6 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts`.
  **Expected:** the entire `clarification skill goal handoff` block (existing + Task 0 additions) PASSES; the `agentic-goal` and discovery blocks still pass.

**Acceptance:** `tests/skill-docs.test.ts` green in full; no one-at-a-time phrase remains in SKILL.md (`grep -nE "One question per message|Never bundle multiple questions|Ask (user )?ONE question|Five questions in one message" skills/agentic-clarification/SKILL.md` returns nothing).

---

## Task 2 — Rewrite the three index.ts kickoff prompt strings

**Dependencies:** Task 0 (Task 1 optional but recommended first so the skill and prompts agree)
**Files:** Modify `index.ts`

Surgical swaps only — change the "Ask ONE question…" clause in each of the three root-session strings; leave every other byte (delegation wrapper, explorer conditional sentence, `clarification_state`, `Gate: PASS`, `draft_goal_contract`, `/goal` handoff sentence) untouched. Anchor by symbol, not line number.

- [ ] **Step 1 — Site 1193 (`clarificationQuestionRule`, root branch).** In the `const clarificationQuestionRule = isRootSession ? … : …` ternary, replace the root-branch string
  `"- Ask ONE question per message using the ask_user_question tool."`
  with
  `"- Bundle up to 4 independent questions into ONE ask_user_question round after recon; prefer a defensible ASSUMPTION: default over asking, and never ask what the codebase can answer."`
  Leave the non-root branch (`"- Do not ask the user questions directly. …"`) unchanged.
- [ ] **Step 2 — Site 1616 (`topic && isRootSession` kickoff).** In that template literal, replace exactly the clause
  `Ask ONE question using the ask_user_question tool.`
  with
  `Bundle up to 4 independent questions into ONE ask_user_question round after recon; prefer a defensible ASSUMPTION: default over asking, and never ask what the codebase can answer.`
  Do NOT alter the surrounding sentences (the `Use the subagent tool with agent 'explorer' only when …` conditional-explorer sentence and the `clarification_state` / `Gate: PASS` / `draft_goal_contract` / `/goal handoff and stop.` tail stay byte-identical — extension.test.ts pins those).
- [ ] **Step 3 — Site 1619 (`!topic && isRootSession` kickoff).** Replace exactly the clause
  `Ask ONE question using the ask_user_question tool to understand what the user wants to accomplish.`
  with
  `Bundle up to 4 independent questions into ONE ask_user_question round after recon to understand what the user wants to accomplish; prefer a defensible ASSUMPTION: default over asking, and never ask what the codebase can answer.`
  Leave the rest of that string byte-identical.
- [ ] **Step 4 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/extension.test.ts`.
  **Expected:** the `/clarify Command` block (existing + Task 0 sites-1616/1619 additions) and the new site-1193 clarifying-phase test all PASS. Confirm no other extension assertion regressed.

**Acceptance:** `tests/extension.test.ts` green in full; `grep -n "Ask ONE question" index.ts` returns nothing (the four occurrences of the old clause across the two kickoff branches and the system-guidance rule are gone — note index.ts:424-430's `"Ask one focused question at a time"` is a DIFFERENT string and intentionally remains).

---

## Task 3 — `ASSUMPTION:`-value characterization (clarification-state + events)

**Dependencies:** Task 0 (independent of Tasks 1–2)
**Files:** Modify `tests/clarification-state.test.ts`, `tests/clarification-events.test.ts`. **Source modules stay unchanged.**

These tests characterize (lock in) that the value-prefix convention works with ZERO reducer change — they PASS at authoring time. Their job is to guarantee no future edit breaks the convention and to satisfy SC3.

- [ ] **Step 1 — State gate + retrievability.** In `tests/clarification-state.test.ts` add an `it("carries ASSUMPTION-prefixed defaults through the gate with the prefix intact", …)` that:
  - creates state, then for every `id` in `REQUIRED_CLARIFICATION_CHECKLIST` applies `mark_checklist_item` with `value: \`ASSUMPTION: ${id} default\``;
  - asserts `canDraftGoalContract(state)` is `true` (assumptions do not block the gate);
  - asserts the stored checklist value is retrievable with the prefix intact, e.g. `expect(state.checklist.find(i => i.id === "objective")?.value).toBe("ASSUMPTION: objective default")` and `expect(state.checklist.every(i => i.value?.startsWith("ASSUMPTION: "))).toBe(true)`;
  - drafts the contract and asserts `status === "contract_drafted"` (an all-assumptions interview can still hand off).
- [ ] **Step 2 — Replay with no new command types.** In `tests/clarification-events.test.ts` add an `it("replays ASSUMPTION-valued mark_checklist_item events with the prefix intact", …)` that builds `mark_checklist_item` replay events (via `createClarificationStateReplayEvent`) with `ASSUMPTION: `-prefixed values, extracts + replays them onto a fresh state, and asserts `restored.errors` is empty and the replayed checklist value still equals the `ASSUMPTION: `-prefixed string. The command `type` used is the existing `mark_checklist_item` — assert (by construction/comment) that no new command literal is introduced.
- [ ] **Step 3 — Verify + guard the source is untouched.** Run
  `cd extensions/agentic-harness && npm test -- tests/clarification-state.test.ts tests/clarification-events.test.ts`
  **Expected:** all PASS (including the new tests, at authoring time). Then run `git diff --stat extensions/agentic-harness/clarification-state.ts extensions/agentic-harness/clarification-events.ts` and confirm **zero** changes to both source modules.

**Acceptance:** both scoped test files green; `git diff --stat` shows clarification-state.ts and clarification-events.ts unchanged; the replay path uses only the pre-existing `mark_checklist_item` command.

---

## Task 4 (Final) — Full verification gate + diff sanity

**Dependencies:** Tasks 0–3
**Files:** None (fix only failures this task surfaces)

- [ ] **Step 1 — Full gate.** Run `cd extensions/agentic-harness && npm test && npm run build`. **Expected:** entire suite green (71 test files) and typecheck clean.
- [ ] **Step 2 — One-at-a-time audit.** Run `grep -rn "Ask ONE question\|One question per message\|Ask user ONE question" extensions/agentic-harness/skills/agentic-clarification/SKILL.md extensions/agentic-harness/index.ts`. **Expected:** no matches (index.ts:424-430's `"Ask one focused question at a time"` is a different phrase and is not matched by these patterns; confirm it is still present and untouched separately).
- [ ] **Step 3 — Diff sanity (only M7's files).** Run `git diff --stat`. **Expected:** the ONLY changed files are `skills/agentic-clarification/SKILL.md`, `index.ts`, `tests/skill-docs.test.ts`, `tests/extension.test.ts`, `tests/clarification-state.test.ts`, `tests/clarification-events.test.ts` (all under `extensions/agentic-harness/`), plus this plan doc. Confirm `clarification-state.ts` and `clarification-events.ts` are NOT in the diff. Any other changed file is out of scope — revert it.

**Acceptance:** all four milestone Success Criteria checkboxes satisfied; `npm test && npm run build` green; diff limited to the six source/test files above.

---

## Rollback Plan

Each task is independently revertible and the milestone touches only docs, prompt strings, and tests (no reducer/state change), so blast radius is small.
1. If the full gate fails late and the cause is isolated, revert the offending file to `HEAD` (`git checkout -- <file>`) and re-run the scoped command; the other tasks stand alone.
2. If the SKILL.md rewrite (Task 1) is the problem, `git checkout -- skills/agentic-clarification/SKILL.md` and revert its Task 0 skill-docs additions — the three prompt-string swaps (Task 2) are still valid on their own.
3. If a prompt-string swap (Task 2) breaks a pinned extension substring you did not intend to touch, restore `index.ts` from `HEAD` and redo the swap surgically (change ONLY the "Ask ONE question…" clause).
4. Because `clarification-state.ts`/`clarification-events.ts` are never edited, there is no persistence/replay migration to roll back and no schemaVersion concern.
5. Full abort: `git checkout -- extensions/agentic-harness/` restores everything; M7 is an abort-point milestone (standalone UX improvement) and can be dropped without affecting other waves.

## Self-Review

- **Spec coverage:** Maps 1:1 to the four milestone SCs — SC1 (skill-docs) → Tasks 0/1; SC2 (three kickoff strings) → Tasks 0/2 covering all three symbol-anchored sites; SC3 (ASSUMPTION replay, no new command types) → Task 3; SC4 (full gate) → Task 4. Recon-first + conditional-explorer token-saving rule + bundled ≤4 round + defensible defaults + assumptions-into-contract are all encoded in Task 1's behavioral steps.
- **Pinning discipline:** Every pinned surface is updated in the SAME task as the prose/prompt change (Task 0 authors the pins; Tasks 1/2 turn them green — the team-lead-mandated failing-tests-first ordering). Existing pins are preserved, not replaced, so the conditional-explorer substrings and Goal Contract field words keep holding.
- **Zero-code convention honored:** `ASSUMPTION: ` is a `mark_checklist_item.value` string; the events validator already accepts any string value (`isClarificationCommand` case `mark_checklist_item` requires only `typeof value.value === "string"`), so replay needs no allowlist change and `canDraftGoalContract` is prefix-agnostic. `clarification-state.ts`/`clarification-events.ts` are asserted unchanged in Tasks 3 and 4.
- **Known tension recorded:** index.ts:424-430's `ask_user_question` tool guideline ("Do not bundle multiple questions") is a global tool-level UX rule, deliberately left out of scope with a documented reconciliation (up to 4 sequential focused questions in one round). Flagged so a reviewer sees the boundary was intentional.
- **Handoff residual:** the `/goal` handoff sentence in the two kickoff strings is intentionally left in place — M4a rewrites the handoff semantics later; touching it here would collide with M4a and break `tests/goal-workflow.test.ts` pins that M4a owns.
- **Risk:** Medium — the only non-mechanical judgment is authoring the site-1193 clarifying-phase system-prompt test; two concrete mechanisms are given, and the binary acceptance (assertion passes) removes ambiguity. Everything else is surgical string replacement guarded by exact-substring pins.
