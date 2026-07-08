# M4a — Auto-chain bridge + approval gate (transitional)

> **Worker note:** Execute strictly in task order. Task 0 locks the test surface first (some assertions FAIL, some PASS — read Task 0 carefully). After each task passes its stated verification, flip its checkbox. This milestone is **index.ts + two test files only** (`tests/goal-workflow.test.ts`, `tests/extension.test.ts`); `skills/agentic-clarification/SKILL.md` and `tests/skill-docs.test.ts` are **out of scope** — the justification is in the Design section and re-checked in the final task. Do NOT edit any goal reducer/state module (`goal-state.ts`, `goal-events.ts`, `goal-storage.ts`) or clarification module. If a step tempts you to add a reducer command or a state field, STOP: M4a is a **wiring** milestone — activation still runs through the existing unconditional `activate_goal` path (decision #4/#11); M4b later inserts the panel and `activate_goal_gated`. This is the **transitional pre-panel stage**: confirm + unconditional activation. Write every goal-workflow assertion knowing M4b will rewrite the activate-on-approval half.

**Goal:** Bridge `draft_goal_contract` (tool action) → a queued follow-up that drives the existing `/goal` auto flow → a **universal** user confirm → `autoStartGoalRuntime`'s existing unconditional activation, with contract→goal field byte-identity preserved at the handoff, and a fail-closed refusal when the session is non-interactive. Remove the manual `/goal` step by rewriting the M7-preserved kickoff handoff sentence. No panel, no `activate_goal_gated` — those are M4b.

**Architecture:** Two seams in `index.ts`, plus one prompt rewrite.
1. **Queue seam (tool handler → follow-up).** The `clarification_state` tool's `execute` handler, `case "draft_goal_contract"` (index.ts:558-562), currently applies the reducer command and sets `currentPhase = "goal_drafting"`. M4a adds one line: queue a follow-up via the existing `sendGoalContinuationFollowUp` helper (which wraps `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` with a plain-`sendUserMessage` fallback, index.ts:1662-1668) instructing the model to run `/goal`. The handler does **NOT** call `ctx.ui.confirm` — see the seam finding below.
2. **Confirm seam (universal, in `autoStartGoalRuntime`).** The model runs `/goal` (no args) → `parsed.kind === "auto"` (index.ts:1940) → `autoStartGoalRuntime(ctx, …)` with an `ExtensionCommandContext`. The current high-risk-only gate (index.ts:1777-1784) is generalized to an **unconditional** confirm over every drafted contract, fail-closed when `ctx.ui.confirm` is absent or `hasUI === false`. Activation stays the existing unconditional `activate_goal` (index.ts:1824) — transitional.
3. **Handoff-sentence rewrite.** The two root-session `/clarify` kickoff prompt strings (sites index.ts:1616, :1619) end with `"…produce a Goal Contract with an exact /goal handoff and stop."`. M7 preserved this deliberately; M4a rewires it to reflect auto-start (the runtime queues `/goal` for the user — no manual `/goal` needed). The phase-guidance line (:1218) and the triage prompt (:1728) carry the same stale "/goal handoff" tail and are updated for consistency (index.ts-only, no pin repair required).

**Confirmed seam finding (queue vs. direct invocation — DECIDED):** The pi extension types show the tool `execute` receives an `ExtensionContext` (`dist/core/extensions/types.d.ts:354`) which **does** expose both `ui: ExtensionUIContext` with `confirm()` (types:67-71, 207-209) and `hasUI` (types:211). So confirming inside the tool handler is *technically possible*. It is nonetheless **rejected**. M4a queues a follow-up that makes the model run `/goal`, and the confirm runs inside `autoStartGoalRuntime` reached through the `/goal` command handler (`ExtensionCommandContext`, types:241/773). Rationale: (a) a tool `execute` should return its result promptly, not block on a modal dialog mid-tool-call; (b) the confirm belongs at the **activation seam**, exactly where M4b will insert the panel and move the confirm to *after* panel convergence — putting it there now means M4b edits one call site, not two; (c) every other interactive confirm in index.ts lives in a command handler, so this matches the established pattern. The alternative "direct invocation of `autoStartGoalRuntime` from a deferred continuation with a synthesized command ctx" is rejected because pi exposes no primitive to manufacture an `ExtensionCommandContext` for a deferred callback outside a registered command handler — the queued-`/goal` route reuses the already-tested auto path instead.

**Tech Stack:** TypeScript ESM, Pi extension API (`@mariozechner/pi-coding-agent`), Vitest. No new runtime dependencies, no new reducer commands, no new state fields.

**Work Scope:**
- **In scope:** `index.ts` — the `draft_goal_contract` tool case (queue seam), `autoStartGoalRuntime` (universal confirm + fail-closed), and the four "/goal handoff" prompt strings (kickoff ×2, phase-guidance, triage). `tests/goal-workflow.test.ts` — extend `createMockPi` to capture tools, add `confirm` to `mockGoalCtx`, add/repurpose confirm + fail-closed + queue + byte-identity + manual-ungated assertions. `tests/extension.test.ts` — update the `/clarify Command` block pins for the auto-start handoff language.
- **Out of scope (do NOT touch):** `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `clarification-state.ts`, `clarification-events.ts` and their service wrappers (no reducer/state change); `activate_goal_gated` / `open_panel` / any panel machinery (M4b); `isHighRiskGoalContract`'s **definition** (keep it — M4b's trivial-escape predicate consumes it per decision #9; only its confirm-gating *use* is removed); `skills/agentic-clarification/SKILL.md` + `tests/skill-docs.test.ts` (justified below); the manual `/goal create→activate→complete` command branches (index.ts:1965-1996 — left byte-identical, ungated).

**Verification Strategy:**
- **Level:** test-suite + build (the exact gate CI enforces on push to main).
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped command (per-task iteration):** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts tests/extension.test.ts`
- **What passing proves:** drafting a contract through the tool handler queues a `/goal` follow-up (not an inline confirm); the auto path confirms **every** contract; approval activates + emits the auto prompt; decline activates nothing; a non-interactive ctx refuses and leaves the contract intact; the created goal's objective/successCriteria/evidenceRequired equal the stored contract fields byte-for-byte; the manual command path never confirms; and no other suite regressed.

**Success Criteria** (verbatim from milestone M4a):
- [ ] goal-workflow tests: drafting a contract leads (via the queued follow-up path, not inline in the tool handler — ctx.ui.confirm availability verified for the chosen seam) to a confirm; approval ⇒ auto-create/activate + auto prompt (no manual `/goal`); decline ⇒ nothing activates; non-interactive ⇒ refuses (fail-closed); TRANSITIONAL NOTE: the activate-on-approval assertion is superseded by M4b's gated flow.
- [ ] goal-workflow tests: the autostart-created goal's objective/successCriteria/evidenceRequired equal the contract fields byte-for-byte (objectiveHash protection).
- [ ] goal-workflow + extension tests: pinned auto-chain/registration assertions updated; manual `/goal create→activate→complete` remains untouched and ungated (explicit test).
- [ ] Full suite + build green.

---

## Canonical literals (use these EXACT strings so pins line up)

| Token | Exact literal |
|---|---|
| Queued follow-up after `draft_goal_contract` | `A Goal Contract has been drafted. Run /goal (no arguments) to review and start the durable goal runtime automatically — no manual setup is needed.` |
| Universal confirm — title | `Start Goal Contract?` |
| Universal confirm — message prefix (then `\n\n${contract.objective}`) | `Review this Goal Contract and start the durable goal runtime now?` |
| Non-interactive fail-closed notify | `Goal Contract requires interactive confirmation before it can start. The drafted contract remains — run /goal in an interactive session to review and start it.` |
| Kickoff handoff tail (NEW, replaces "…exact /goal handoff and stop.") | `then present the Goal Contract and stop; the runtime queues an automatic /goal start for your review.` |
| Phase-guidance handoff line (NEW, replaces the :1218 "…plain /goal handoff." line body after the comma) | `then present the Goal Contract and stop; the runtime queues an automatic /goal start for your review.` |

**Removed literal (must be gone from the four rewritten prompt strings):** `an exact /goal handoff and stop` and `a plain /goal handoff` (the triage prompt's `stop with the /goal handoff` clause is also rewritten to the auto-start wording). Note `handoffCommand: "/goal"` in the contract shape and the `/goal` command name are unaffected — the substring `/goal` still appears throughout.

---

## Design decisions pinned for this milestone

- **The confirm is UNIVERSAL, not high-risk-only.** Replace the `if (isHighRiskGoalContract(contract)) { … }` block (index.ts:1777-1784) with an unconditional confirm-or-refuse. `isHighRiskGoalContract` stays **defined** (no `noUnusedLocals` in tsconfig — build-safe) because M4b's trivial-escape predicate (decision #9: `… && !isHighRiskGoalContract`) reuses it.
- **Fail-closed non-interactive.** Refuse to autostart when `!ctx?.ui?.confirm` **or** `(ctx as any).hasUI === false`; `notifyGoal(ctx, <fail-closed literal>, "error")` and `return state` (the drafted contract survives for a later interactive `/goal`). This generalizes and tightens the current high-risk-only `!ctx?.ui?.confirm` guard (which did not check `hasUI`).
- **Byte-identity at the handoff.** `autoStartGoalRuntime` already maps `contract.objective → title/objective`, `contract.successCriteria → successCriteria`, `contract.evidenceRequired → evidenceRequired` (index.ts:1794-1798). `buildGoalObjectiveHash` (goal-state.ts:645-663) hashes exactly `objective` + `successCriteria` + `evidenceRequired`, so a byte-identity guard on those three fields (created goal vs. stored `clarification.goalContract`) protects the objective hash across the handoff. This is a **characterization guard** — it passes at baseline and must keep passing.
- **Manual path untouched + ungated.** The `create` / `activate` / `subgoal` / `evidence` / `complete` command branches (index.ts:1965-2019) are left byte-identical; they use the plain `activate_goal` / `create_goal` / `request_completion` reducer commands and never call `ctx.ui.confirm`. An explicit test drives create→activate→complete and asserts `ctx.ui.confirm` was never called.
- **TRANSITIONAL.** Activation is the existing unconditional `activate_goal` (index.ts:1824). M4b rewrites the activate-on-approval assertions to `activate_goal_gated` after panel convergence. Do not assert anything M4b will have to unwind beyond the plain-activation fact stated here.
- **SKILL.md / skill-docs.test.ts left out of scope — justification.** The only skill-docs pin touching the handoff is `expect(src).toContain("/goal")` (skill-docs.test.ts:52), which still holds (SKILL.md's durable-`/goal`-runtime framing is unchanged and still accurate — M4a auto-starts *into* that runtime). No skill-docs pin references the "Tell the user to run /goal" prose, so the kickoff rewrite forces no repair there. SKILL.md prose about manual-vs-auto handoff is better churned alongside M4b, which reshapes the entire front-half UX (panel + single post-convergence confirm). Touching it now would be premature and would widen the diff for no pin reason. If, contrary to this analysis, a skill-docs assertion goes red, STOP and reconcile before editing SKILL.md.

---

## File Structure Mapping

**Modify (source):**
- `extensions/agentic-harness/index.ts` — anchored by symbol, not line number:
  - `clarification_state` tool `execute`, `switch (params.action)` → `case "draft_goal_contract"` (queue seam).
  - `autoStartGoalRuntime` (universal confirm + fail-closed).
  - the `const clarificationQuestionRule` phase-guidance line containing `/goal handoff` (:1218 body), the `commands.get("clarify")` kickoff template literals for the `topic && isRootSession` (:1616) and `!topic && isRootSession` (:1619) branches, and `buildGoalTriagePrompt` (:1728) — the four "/goal handoff" prompt strings.

**Modify (tests):**
- `extensions/agentic-harness/tests/goal-workflow.test.ts` — extend `createMockPi` (add a `tools` Map like extension.test's), add `confirm` to `mockGoalCtx`, add/repurpose the confirm/fail-closed/queue/byte-identity/manual-ungated assertions, update the `/goal handoff` pin at :99.
- `extensions/agentic-harness/tests/extension.test.ts` — `describe("/clarify Command")` block (~:819): update kickoff-prompt pins to the auto-start handoff language.

**Must NOT change:** `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `clarification-state.ts`, `clarification-events.ts`, `skills/agentic-clarification/SKILL.md`, `tests/skill-docs.test.ts`, the manual `/goal` command branches, `isHighRiskGoalContract`'s definition.

---

## Task 0 — Baseline Lock (author the test surface first)

**Dependencies:** None
**Files:** Modify `tests/goal-workflow.test.ts`, `tests/extension.test.ts`

Author the new/updated assertions BEFORE editing any source. Characterization guards that pass at baseline (byte-identity, manual-ungated) are deferred to Task 4 so this task's FAIL signal stays clean.

- [ ] **Step 1 — Confirm the reconfirmed baseline count.** Run `cd extensions/agentic-harness && npm test 2>&1 | tail -5` and record the file/test totals (expected ≈ 72 files / 759 tests per the M7 checkpoint). This is the number the final task must match modulo M4a's added tests.
- [ ] **Step 2 — Test-infra: capture tools + add confirm to `mockGoalCtx`.** In `tests/goal-workflow.test.ts`:
  - Extend `createMockPi` to capture registered tools: add `const tools = new Map<string, any>();`, set `registerTool: (def: any) => { tools.set(def.name, def); }` (mirror the shape extension.test.ts uses), and return `tools` alongside `mockPi/commands/events`. (Confirm the real `pi.registerTool` is called as `pi.registerTool({ name, … })` — index.ts:505 — so key on `def.name`.)
  - In `mockGoalCtx` add `confirm: vi.fn().mockResolvedValue(true)` and `hasUI: true` to the returned object (alongside `notify`/`setStatus`). **This is load-bearing:** once the confirm is universal (Task 1), every autostart-based test (`createReadyGoal`, the ":113 auto-creates", ":146 no-duplicate", and all `complete`-path tests) would otherwise fail-close on a missing `confirm`.
  - Run the scoped command. **Expected:** still green — adding a confirm mock and a tools map changes nothing at baseline (baseline only confirms high-risk).
- [ ] **Step 3 — Repurpose the high-risk test into the universal-decline case (will FAIL until Task 1).** The existing `it("requires confirmation for high-risk contract text in suggested subgoals", …)` (goal-workflow.test.ts:166-185) asserts the confirm title `"Start high-risk goal?"`. Rewrite its assertions to the **universal** confirm (drop the "high-risk" framing; a plain contract now also confirms):
  ```ts
  expect(ctx.ui.confirm).toHaveBeenCalledWith(
    "Start Goal Contract?",
    expect.stringContaining("Ship automatic goal runtime"),
  );
  expect(state.goals).toHaveLength(0);            // decline ⇒ nothing activates
  ```
  Keep `ctx.ui.confirm = vi.fn().mockResolvedValue(false)` and `draftClarificationContract(…, [])` (plain, non-high-risk subgoals — proving the confirm is universal, not high-risk-gated). Rename the `it(...)` to `"confirms every drafted contract and activates nothing on decline"`. **FAILS at baseline** (baseline uses title `"Start high-risk goal?"` and, for a plain contract, does not confirm at all → activates → `goals` length 1).
- [ ] **Step 4 — Add the non-interactive fail-closed test (will FAIL until Task 1).** Add `it("refuses to autostart when the session is non-interactive (fail-closed)", …)`: build a `mockGoalCtx` variant with `ui.confirm` **deleted** (`delete ctx.ui.confirm`) OR `hasUI: false`; `draftClarificationContract(…, [])`; `await goal.handler("", ctx)`. Assert:
  ```ts
  const state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
  expect(state.goals).toHaveLength(0);            // nothing activated
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("requires interactive confirmation"), "error",
  );
  // contract survives for a later interactive /goal
  const clar = await loadClarificationState(runId, defaultClarificationStateRoot(cwd));
  expect(clar.goalContract?.objective).toBe("Ship automatic goal runtime");
  ```
  (Import `loadClarificationState` from `../clarification-state-service.js` and `defaultClarificationStateRoot` — already imported.) **FAILS at baseline** (a plain contract with no confirm autostarts → `goals` length 1).
- [ ] **Step 5 — Add the tool-handler queue test (will FAIL until Task 2).** Add `it("draft_goal_contract queues a /goal follow-up rather than confirming inline", …)`: get the captured tool `const tool = tools.get("clarification_state");`, build a tool ctx with `cwd`, `runId`, `sessionManager.appendCustomEntry: vi.fn()`, and a `ui.confirm` spy; drive the required checklist then `await tool.execute("call-1", { action: "draft_goal_contract", contract: {…} }, undefined, undefined, ctx)` (reuse the contract shape from `draftClarificationContract`; you may mark the checklist by calling `tool.execute` with `action: "mark_checklist_item"` per id, or seed state via `applyAndPersistClarificationCommand` then only `execute` the draft action). Assert:
  ```ts
  expect(ctx.ui.confirm).not.toHaveBeenCalled();  // NOT inline in the tool handler
  expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
    expect.stringContaining("Run /goal (no arguments) to review and start"),
    { deliverAs: "followUp" },
  );
  ```
  **FAILS at baseline** (the tool handler currently queues nothing on `draft_goal_contract`).
- [ ] **Step 6 — Update the extension `/clarify` kickoff pins (will FAIL until Task 3).** In `tests/extension.test.ts`, `describe("/clarify Command")` — the topic test (~:836-855) and the no-topic test (~:873-879) — add after the existing prompt assertions:
  ```ts
  expect(prompt).not.toContain("an exact /goal handoff and stop");
  expect(prompt).toContain("the runtime queues an automatic /goal start for your review");
  ```
  Keep every existing assertion in those blocks intact. **FAILS at baseline** (kickoff strings still say "…an exact /goal handoff and stop.").
- [ ] **Step 7 — Run and record the baseline.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts tests/extension.test.ts`. **Expected:** the Step 3/4 (confirm+fail-closed), Step 5 (queue), and Step 6 (kickoff) assertions FAIL for the stated reasons; NO previously-green assertion fails. If a pre-existing pin fails, you disturbed a pinned substring or the `mockGoalCtx`/`createMockPi` change is wrong — fix before proceeding.

**Acceptance:** the newly added/repurposed assertions fail for the stated reasons; all previously-green assertions in both files still pass.

---

## Task 1 — Universal confirm + fail-closed in `autoStartGoalRuntime`

**Dependencies:** Task 0
**Files:** Modify `index.ts`

Anchor on `autoStartGoalRuntime`. Replace the high-risk-only confirm block (the `if (isHighRiskGoalContract(contract)) { … }` at index.ts:1777-1784, inside the `if (!goal) { … }` no-existing-goal branch, after the `if (!contract) { … }` early-return) with an **unconditional** confirm-or-refuse:

- [ ] **Step 1 — Document the seam finding as an inline note (one comment line).** Above the new confirm block, add a single comment stating the confirm is universal and lives at the activation seam (M4b moves it after panel convergence). Keep it to one line — no essay.
- [ ] **Step 2 — Generalize the gate.** Replace lines 1777-1784 with:
  ```ts
  if (!ctx?.ui?.confirm || (ctx as any).hasUI === false) {
    notifyGoal(ctx, "Goal Contract requires interactive confirmation before it can start. The drafted contract remains — run /goal in an interactive session to review and start it.", "error");
    return state;
  }
  const proceed = await ctx.ui.confirm("Start Goal Contract?", `Review this Goal Contract and start the durable goal runtime now?\n\n${contract.objective}`);
  if (!proceed) return state;
  ```
  Leave `isHighRiskGoalContract`'s **definition** (index.ts:1695-1709) in place and remove only its call here. Leave the `create_goal` / `create_subgoal` mapping (index.ts:1790-1812), the `existing = findGoalForContract(...)` reuse, the `queued`→`activate_goal` tail (index.ts:1817-1824), and the final `buildGoalAutoPrompt` follow-up (index.ts:1827) byte-identical.
- [ ] **Step 3 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts`. **Expected:** the Step-3 decline test and Step-4 fail-closed test now PASS; the existing autostart-based tests (":113", ":146", `complete`-path) still PASS (they rely on the `mockGoalCtx.confirm → true` default from Task 0). The Step-5 queue test still FAILS (Task 2) and any extension kickoff pins still FAIL (Task 3) — expected.

**Acceptance:** `tests/goal-workflow.test.ts` shows the confirm + fail-closed tests green and no autostart regression; `isHighRiskGoalContract` remains defined; `npm run build` (run it here as a spot check) is clean.

---

## Task 2 — Queue seam: `draft_goal_contract` follow-up

**Dependencies:** Task 0 (independent of Task 1)
**Files:** Modify `index.ts`

Anchor on the `clarification_state` tool `execute` → `switch (params.action)` → `case "draft_goal_contract"` (index.ts:558-562).

- [ ] **Step 1 — Queue the follow-up.** After `state = await apply({ type: "draft_goal_contract", contract: params.contract });` and `currentPhase = "goal_drafting";`, add:
  ```ts
  await sendGoalContinuationFollowUp("A Goal Contract has been drafted. Run /goal (no arguments) to review and start the durable goal runtime automatically — no manual setup is needed.");
  ```
  Do **not** call `ctx.ui.confirm` here (seam finding). `sendGoalContinuationFollowUp` is a `const` in the same `export default function (pi)` scope (index.ts:1662); the tool `execute` closure runs at runtime long after activation, so the helper is initialized by the time this fires — verify by a quick read that both live inside the same top-level `export default function` (index.ts:313). Its plain-`sendUserMessage` fallback covers hosts without `deliverAs` support.
- [ ] **Step 2 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts`. **Expected:** the Step-5 queue test PASSES (`sendUserMessage` called with the follow-up + `{ deliverAs: "followUp" }`, `confirm` not called). No existing goal-workflow test regresses — existing tests draft via `applyAndPersistClarificationCommand` directly and never hit the tool handler, so the new queue is inert for them.

**Acceptance:** the queue test is green; existing goal-workflow tests unchanged; `grep -n "deliverAs" index.ts` shows the follow-up path is reused, not duplicated.

---

## Task 3 — Rewrite the "/goal handoff" prompt strings (auto-start)

**Dependencies:** Task 0 (Tasks 1/2 recommended first so behavior and prose agree)
**Files:** Modify `index.ts`

Surgical swaps only — change the "/goal handoff" clause in each of the four strings; leave every other byte (delegation wrapper, explorer conditional, `clarification_state` / `Gate: PASS` / `draft_goal_contract` sequence) untouched. Anchor by symbol.

- [ ] **Step 1 — Kickoff site 1616 (`topic && isRootSession`).** Replace the tail clause `then produce a Goal Contract with an exact /goal handoff and stop.` with `then present the Goal Contract and stop; the runtime queues an automatic /goal start for your review.`
- [ ] **Step 2 — Kickoff site 1619 (`!topic && isRootSession`).** Replace the identical `then produce a Goal Contract with an exact /goal handoff and stop.` tail with the same new clause.
- [ ] **Step 3 — Phase-guidance line (:1218, in the `clarificationQuestionRule` region / `PHASE_GUIDANCE.clarifying`).** Replace `then present the Goal Contract with a plain /goal handoff.` with `then present the Goal Contract and stop; the runtime queues an automatic /goal start for your review.` (consistency; no test pins this line for the handoff — verify the existing source-level clarifying-guidance pin at extension.test.ts:882-894 only checks the bundled-round strings, which you are not touching).
- [ ] **Step 4 — Triage prompt (`buildGoalTriagePrompt`, :1728).** Replace `draft a Goal Contract, and stop with the /goal handoff.` with `draft a Goal Contract, and stop; the runtime queues an automatic /goal start for your review.` (goal-workflow.test.ts:218-222 pins the triage body but not this tail — verify.)
- [ ] **Step 5 — Update the goal-workflow kickoff pin.** In `tests/goal-workflow.test.ts`, the `it("delegates /clarify to a gated Goal Contract handoff", …)` test asserts `expect(prompt).toContain("/goal handoff")` (:99). Replace it with:
  ```ts
  expect(prompt).not.toContain("an exact /goal handoff and stop");
  expect(prompt).toContain("the runtime queues an automatic /goal start for your review");
  ```
- [ ] **Step 6 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts tests/extension.test.ts`. **Expected:** the Step-6 (Task 0) extension kickoff pins and the updated goal-workflow :99 pin all PASS; no other assertion regresses. Then `grep -n "/goal handoff and stop\|a plain /goal handoff\|stop with the /goal handoff" index.ts` returns nothing.

**Acceptance:** both scoped files green; the four legacy "/goal handoff" clauses are gone from index.ts; `/goal` (command name) and `handoffCommand: "/goal"` are untouched.

---

## Task 4 — Byte-identity + manual-path-ungated characterization guards

**Dependencies:** Tasks 0-3
**Files:** Modify `tests/goal-workflow.test.ts`

These PASS at authoring time (they characterize existing behavior). They satisfy SC2 and the SC3 "manual path untouched and ungated (explicit test)" clause.

- [ ] **Step 1 — Byte-identity guard (SC2).** Add `it("created goal fields equal the stored contract byte-for-byte (objectiveHash protection)", …)`: `draftClarificationContract(cwd, runId, ctx)`; `await goal.handler("", ctx)` (confirm resolves true via `mockGoalCtx`); then load both artifacts and assert equality on the three hashed fields:
  ```ts
  const goalState = await loadGoalState(runId, defaultGoalStateRoot(cwd));
  const clar = await loadClarificationState(runId, defaultClarificationStateRoot(cwd));
  const created = goalState.goals[0];
  const contract = clar.goalContract!;
  expect(created.objective).toBe(contract.objective);
  expect(created.successCriteria).toEqual(contract.successCriteria);
  expect(created.evidenceRequired).toEqual(contract.evidenceRequired);
  ```
  (Rationale comment: these three fields feed `buildGoalObjectiveHash`, goal-state.ts:645; drift here would stale the objective hash at completion.)
- [ ] **Step 2 — Manual-path-ungated guard (SC3).** Add `it("manual /goal create→activate→complete never confirms and stays ungated", …)`: with a fresh `mockGoalCtx` (confirm spy), run `await goal.handler("create Ship verifier guard", ctx)`, `await goal.handler("activate goal-1", ctx)`, `await goal.handler("complete goal-1", ctx)`. Assert:
  ```ts
  expect(ctx.ui.confirm).not.toHaveBeenCalled();  // no approval gate on the manual path
  ```
  Also assert the manual create produced a goal (`state.goals[0].objective === "Ship verifier guard"`) and that no autostart auto-prompt was emitted for it (the manual path routes an objective-only goal to clarification, not to autostart — assert `sendUserMessage` was NOT called with `expect.stringContaining("until the entire active goal is complete")`). This proves the manual branches are untouched by the M4a confirm seam.
- [ ] **Step 3 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts`. **Expected:** both new guards PASS at authoring time; whole file green.

**Acceptance:** byte-identity and manual-ungated guards green; no source touched in this task.

---

## Task 5 (Final) — Full verification gate + diff sanity

**Dependencies:** Tasks 0-4
**Files:** None (fix only failures this task surfaces)

- [ ] **Step 1 — Full gate.** Run `cd extensions/agentic-harness && npm test && npm run build`. **Expected:** entire suite green (baseline file count from Task 0 Step 1, plus M4a's added tests) and typecheck clean.
- [ ] **Step 2 — Handoff audit.** Run `grep -n "/goal handoff and stop\|a plain /goal handoff\|stop with the /goal handoff\|Start high-risk goal" index.ts`. **Expected:** no matches (the four legacy handoff clauses and the old high-risk confirm title are gone). Separately confirm `isHighRiskGoalContract` is still **defined**: `grep -n "const isHighRiskGoalContract" index.ts` returns one match (kept for M4b).
- [ ] **Step 3 — Diff sanity (only M4a's files).** Run `git diff --stat`. **Expected:** the ONLY changed files under `extensions/agentic-harness/` are `index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts` (plus this plan doc). Confirm `skills/agentic-clarification/SKILL.md`, `tests/skill-docs.test.ts`, and every goal/clarification reducer module are NOT in the diff. If SKILL.md or skill-docs.test.ts appears, the out-of-scope justification was violated — revert and reconcile. Any other changed file is out of scope — revert it.

**Acceptance:** all four milestone Success Criteria checkboxes satisfied; `npm test && npm run build` green; diff limited to `index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts`.

---

## Rollback Plan

M4a touches one source file and two test files, adds no reducer command and no state field, and changes no persisted schema — blast radius is small and there is no migration to unwind.
1. If the full gate fails late and the cause is isolated to the confirm seam, revert `autoStartGoalRuntime`'s block to `HEAD` (`git checkout -p index.ts`, restore the `if (isHighRiskGoalContract(contract)) { … }`) and re-run the scoped command; the queue seam (Task 2) and handoff rewrite (Task 3) stand alone.
2. If the queue seam misbehaves (double-trigger, spurious follow-up), remove the single `sendGoalContinuationFollowUp(...)` line in the `draft_goal_contract` case; the confirm seam and manual path are unaffected.
3. If a handoff-string swap disturbs a pinned substring you did not intend to touch, restore `index.ts` from `HEAD` and redo only the "/goal handoff" clause swaps surgically.
4. Because no reducer/state/storage module is edited, there is no persistence/replay/`schemaVersion` concern — replay of a run created before M4a is byte-identical.
5. Full abort: `git checkout -- extensions/agentic-harness/` restores everything. M4a is an abort-point milestone (today's pipeline + one approval gate, no manual `/goal`) and can be dropped without affecting other waves; M4b depends on it but is not yet started.

## Self-Review

- **Spec coverage:** Maps 1:1 to the four milestone SCs. SC1 (queue-not-inline confirm; approve⇒activate; decline⇒nothing; non-interactive⇒fail-closed) → Task 0 Steps 3-5 author, Task 1 (confirm+fail-closed) and Task 2 (queue) turn green; the seam finding (tool ctx *has* `ui.confirm` yet the confirm deliberately runs in the command ctx) is documented in the Design section and referenced by Task 1 Step 1 and Task 2 Step 1. SC2 (byte-identity) → Task 4 Step 1, tied to `buildGoalObjectiveHash`'s exact fields. SC3 (pins updated + manual ungated) → Task 0 Step 6 / Task 3 Step 5 (pins) and Task 4 Step 2 (manual-ungated). SC4 (full gate) → Task 5.
- **Failing-first discipline:** Task 0 authors only the assertions that FAIL at baseline (confirm/fail-closed/queue/kickoff); the two characterization guards that pass at baseline (byte-identity, manual-ungated) are quarantined in Task 4 so the Task 0 FAIL signal stays clean — same structure as M7's Task 3.
- **Transitional honesty:** every activate-on-approval assertion rides the existing unconditional `activate_goal`; the plan states in three places that M4b rewrites these to `activate_goal_gated` after panel convergence, so the worker does not pin anything M4b must unwind beyond plain activation.
- **Diff minimalism defended:** `isHighRiskGoalContract` is kept (M4b consumes it, decision #9; no `noUnusedLocals` so build-safe); SKILL.md + skill-docs.test.ts are argued out of scope against the actual pin (`toContain("/goal")` still holds) with a stop-and-reconcile guard if that analysis proves wrong; the manual command branches are asserted untouched by an explicit no-confirm test.
- **Known residual:** the queued `/goal` follow-up depends on the model actually running `/goal`; in a non-interactive host the follow-up may be ignored and the fail-closed refusal is the backstop — the drafted contract survives for a later interactive session. This matches decision #8's one-user-turn resume residual and is acceptable for the transitional stage.
- **Risk:** Medium — the only non-mechanical judgment is the universal-confirm generalization (behavioral change to every autostart, mitigated by the `mockGoalCtx.confirm` default that keeps ~10 existing tests green) and the tool-handler queue closure-scope assumption (verified: same `export default function`, runtime-initialized const). Everything else is surgical string replacement guarded by exact-substring pins.
