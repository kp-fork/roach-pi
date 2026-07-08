---
name: agentic-clarification
description: Use when a user's request is vague, ambiguous, or underspecified. Runs recon-first clarification — codebase exploration before questions, then one bundled question round with defensible defaults — and outputs a Goal Contract for the durable /goal runtime. Triggers on "I want to...", "I need...", "let's build...", "can you help me...", "we should...", or any request where the full scope isn't immediately clear.
---

# Runtime-Enforced Deep Clarification

Narrows vague user requests into a durable Goal Contract. Recon comes first for implementation requests, the remaining ambiguities are resolved in a single bundled question round, defensible defaults stand in for questions wherever possible, hidden runtime state is recorded with `clarification_state`, and Goal Contract handoff is blocked until the checklist/ambiguity gate passes.

## Core Principle

Exploration precedes questions. The user should never be asked something the codebase can answer. Ambiguity is resolved by grounding every question in recon findings and by proposing defensible defaults for everything else — not by a long interrogation. The purpose of this skill is not "writing code" — it is making "what the user wants" clear and, for implementation/codebase-impacting requests, making "what state the codebase is in" vivid enough to draft safely.

## Hard Gates

1. **Recon before questions.** For implementation/codebase-impacting requests, dispatch recon explorer subagent(s) FIRST, before asking the user anything. Ask only what recon provably cannot answer, and cite recon findings in every question.
2. **ONE bundled question round.** After recon, `Bundle up to 4 independent questions into ONE ask_user_question round after recon; prefer a defensible ASSUMPTION: default over asking, and never ask what the codebase can answer.` If nothing survives recon, ask nothing and proceed.
3. **Use explorer only when needed.** Prefer saving tokens and latency for non-code/product/wording clarification; dispatch `agent: "explorer"` when the request is clearly implementation/codebase-impacting or when technical context is missing/uncertain.
4. **Use `clarification_state` whenever available.** Record every user answer, explorer finding, checklist update, assumption, unresolved ambiguity, accepted risk, and final Goal Contract draft.
5. **Do not start implementation until the runtime gate says `Gate: PASS`.** Understanding must be complete at the user-intent and codebase levels.
6. **Every question must narrow scope.** Each question is independent of the others in the round and grounded in a recon finding.
7. **Never dump raw code exploration results on the user.** Summarize findings in the context of the user's question.

## When To Use

- The user says "I want to…" but the scope is unclear
- The request is vague enough that implementation could go in multiple directions
- The user themselves hasn't fully articulated what they want
- There's a risk of clashing with existing codebase structure, so exploration may be needed

## When NOT To Use

- The request is already specific and clear (create or activate a `/goal` directly)
- The scope is obvious, like a simple bug fix or config change
- The user explicitly says "don't ask questions, just do it"

## The Process

### Phase 1: Deep Recon (before any question)

Use an explorer subagent only when codebase context is needed. Default to no explorer for non-code/product/wording clarification to save tokens and latency. For clear implementation/codebase-impacting requests, or whenever the technical context checklist cannot be completed from known information, launch `agent: "explorer"` FIRST — before asking the user anything.

**How to decide whether to dispatch exploration:**

Dispatch a subagent via the `subagent` tool with `agent: "explorer"` when any of these are true:

- The request asks to change code, tests, prompts, docs, configuration, or runtime behavior.
- A Goal Contract would mention affected files, interfaces, tests, migrations, or regressions.
- The `technical_context` checklist item is missing, uncertain, or would otherwise need to be accepted as risk.
- A user answer creates a new technical ambiguity.

When dispatched, the subagent investigates:

- Related file structure and naming conventions
- Existing implementation patterns (error handling, state management, data flow)
- Dependencies and interface boundaries
- Recent change history (relevant commits)
- Test coverage status

**Conditional subagent dispatch example:**

When the criteria above are met, call the `subagent` tool in single mode:
- `agent`: `"explorer"`
- `task`: A description of what to investigate

```
agent: "explorer"
task: |
  The user has requested [summarized request for a future Goal Contract].

  Investigate and report on:
  1. Related files and the role of each
  2. Existing implementation patterns (is something similar already in place?)
  3. Boundary areas this work is likely to affect
  4. Recent related changes
  5. Existing test state

  Report only key findings concisely.
  Do not dump entire file contents.
```

**Processing explorer results:**

When the subagent returns findings:
1. Record them via `clarification_state` and fill every checklist item recon settles
2. If technical constraints unknown to the user are discovered, ground the question round in them
3. If a conflict with existing code is likely, surface it in the question round

### Phase 2: Minimal Question Round

After recon returns (or immediately, for non-code clarification), list the remaining ambiguities. For each, first check: *can recon or the conversation so far answer this?* If yes, answer it yourself. Then check: *can I propose a defensible default instead?* If yes, record it as an assumption (see Phase 3). Bundle only the survivors — up to 4 independent questions — into ONE ask_user_question round, each grounded in a recon finding ("recon shows X in `services/y.ts` — follow or replace?"). If nothing survives, ask nothing and proceed to the gate.

**Question principles:**

- Independent questions only — no question whose answer depends on another in the same round
- Offer choices when possible (A/B/C)
- Ask "which case?" rather than "why?" — draw out concrete scenarios, not abstract intent
- If an answer contradicts recon or a previous answer, flag it immediately and realign; a genuinely new ambiguity that emerges from an answer may justify one focused follow-up round

**Deep coverage guide:**

The hidden runtime checklist must have concrete content — from recon, an answer, or a recorded assumption — for every item before handoff:

1. **Objective**: the durable end goal in one sentence.
2. **Scope**: what is included.
3. **Non-goals**: what is explicitly excluded.
4. **Constraints**: compatibility, time, dependencies, user preferences, migration boundaries.
5. **Success criteria**: observable acceptance conditions.
6. **Evidence required**: tests, commands, screenshots, logs, docs, or manual checks the verifier should expect.
7. **Risks**: known blockers, regression risks, rollback concerns.
8. **Edge cases**: boundary inputs, failure paths, platform differences, permissions, concurrency.
9. **Technical context**: affected files, existing patterns, integration points, and test coverage.

After the round, briefly summarize "what we've established," call `clarification_state` to record the answers/checklist changes, and move to the gate.

### Phase 3: Defensible Defaults (recorded as assumptions)

Prefer proposing a defensible default over asking. For every checklist item the agent can reasonably fill itself — from recon findings, codebase conventions, or obvious task framing — record it via `clarification_state` `mark_checklist_item` with the value prefixed `ASSUMPTION: ` (the exact literal: the word `ASSUMPTION`, a colon, a space, then the assumed content).

- Assumptions complete checklist items, so the gate can pass without a question ever being asked.
- Filling a checklist item with an `ASSUMPTION: ` value is preferred over adding a blocking ambiguity — reserve blocking ambiguities for genuine decision points only the user can settle.
- Every recorded assumption must be defensible: cite the recon finding or convention it rests on.

## Putting It Together: The Goal Contract Flow

```dot
digraph agentic-clarification {
    rankdir=TB;
    "User states vague request" [shape=box];
    "Dispatch recon explorer if implementation/codebase-impacting" [shape=box, style=dashed];
    "List remaining ambiguities; drop every one recon can answer" [shape=box];
    "Record defensible ASSUMPTION: defaults via clarification_state" [shape=box];
    "ONE bundled round: up to 4 independent questions" [shape=box];
    "Runtime gate: Gate: PASS?" [shape=diamond];
    "Present Goal Contract" [shape=doublecircle];

    "User states vague request" -> "Dispatch recon explorer if implementation/codebase-impacting" [style=dashed, label="conditional"];
    "User states vague request" -> "List remaining ambiguities; drop every one recon can answer";
    "Dispatch recon explorer if implementation/codebase-impacting" -> "List remaining ambiguities; drop every one recon can answer" [style=dashed];
    "List remaining ambiguities; drop every one recon can answer" -> "Record defensible ASSUMPTION: defaults via clarification_state";
    "Record defensible ASSUMPTION: defaults via clarification_state" -> "ONE bundled round: up to 4 independent questions";
    "ONE bundled round: up to 4 independent questions" -> "Runtime gate: Gate: PASS?";
    "Runtime gate: Gate: PASS?" -> "Present Goal Contract" [label="pass"];
    "Runtime gate: Gate: PASS?" -> "ONE bundled round: up to 4 independent questions" [label="blocked: focused follow-up"];
}
```

## Runtime Gate

Before producing the final Goal Contract:

1. Call `clarification_state` with `action=status`.
2. If the result contains `Gate: BLOCKED`, first try to fill the missing item with a defensible `ASSUMPTION: ` default or use `subagent` if the missing information is technical; only when neither works, ask a focused follow-up for the highest-impact unresolved item.
3. Only when the result contains `Gate: PASS`, call `clarification_state` with `action=draft_goal_contract` using the exact Goal Contract fields.
4. Then present the Goal Contract to the user and stop.

Do not expose the hidden checklist as a separate command workflow. The user should experience recon, at most one bundled question round, and the final contract — not state management.

## Output: Goal Contract

When the runtime gate passes, present the user with a Goal Contract. This is the skill's final deliverable.

Every `ASSUMPTION: `-prefixed default recorded during the interview MUST be surfaced verbatim in the Goal Contract under `### Assumptions` so downstream critics can see what was assumed rather than confirmed.

**Goal Contract format:**

```markdown
## Goal Contract: [Task Title]

### Objective
[One-sentence objective for the durable goal]

### Scope
- **In scope**: [Included work]
- **Out of scope / Non-goals**: [Explicitly excluded work]

### Technical Context
[Technical facts discovered through code exploration, or a concise note that no code exploration was needed for a non-code clarification]
- Current implementation state
- Affected areas
- Existing patterns to follow

### Success Criteria
- [Verifiable criterion for the completed state]

### Constraints
- [External, technical, time, priority, or compatibility constraint]

### Evidence Required
- [Evidence that must be added before requesting completion]

### Assumptions
- [Every ASSUMPTION: default recorded during clarification, verbatim]

### Risks
- [Risk, blocker, or uncertainty the goal runtime should track]

### Suggested Initial Subgoals
1. [Initial subgoal title and objective]

### Open Questions (if any)
[Questions still open — unresolved but not blocking]

### Handoff
Run this after the user approves this Goal Contract:
- `/goal`
```

Show the Goal Contract in the conversation and stop. Do not begin implementation from this skill.

## Red Flags

Stop and recalibrate if any of these occur:

| Situation | Response |
|-----------|----------|
| User says "just figure it out" | Record explicit `ASSUMPTION: ` defaults for everything unconfirmed, surface them in the contract, and at minimum confirm purpose and success criteria |
| A question survives that recon could have answered | Drop it and answer it from the codebase — never ask what the codebase can answer |
| Explorer finds conflicting existing code | Surface it in the bundled round. Conflicts with existing structure require a design decision |
| Request decomposes into multiple independent sub-tasks | Show the decomposition to the user and propose prioritizing one at a time |

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|--------------|-------------|
| Asking the user before recon returns | Generic questions the code could answer; burns user trust |
| Serial one-at-a-time interrogation across many turns | Slow, exhausting, and no sharper than one well-grounded bundled round |
| Asking when a defensible default exists | Wastes the user's attention; record `ASSUMPTION: ` and surface it in the contract instead |
| Dependent questions bundled together | The answer to one invalidates the others; bundle independent questions only |
| Skipping code exploration for implementation work | Scope can narrow in a direction that conflicts with existing code |
| Showing full subagent output to the user | Too much noise. Provide only the summary relevant to the user's context |
| Deciding "that's enough" unilaterally | Always present the Goal Contract to the user and get confirmation |
| Starting implementation | This skill ends at "clear context," not "implemented code" |

## Minimal Checklist

Self-check before drafting the contract:

- [ ] Was recon dispatched first for implementation work, or explorer use intentionally skipped for a non-code clarification?
- [ ] Did every question survive the "can the codebase answer this?" filter and cite a recon finding?
- [ ] Was the round limited to up to 4 independent questions in ONE ask_user_question round?
- [ ] Is every self-filled checklist item recorded with an `ASSUMPTION: ` prefix and surfaced in the contract?
- [ ] Was `clarification_state` updated with every answer/finding/checklist change?
- [ ] Does the gate report `Gate: PASS` before drafting?

## Handoff Rules

After the Goal Contract is approved, hand the work to the durable goal runtime:

- Tell the user to run `/goal`; the runtime will create, activate, continue, and verify automatically.
- Do not ask the user to type `/goal create`, `/goal activate`, target ids, or other setup commands for the normal flow.
- Do not route to another workflow skill from clarification.
- Do not start implementation from clarification.
- If further exploration is needed, dispatch another explorer within this skill.

The Goal Contract is the only final output of this skill. It must include enough success criteria and evidence required for the goal verifier to judge completion later.
