# Docs: progress tracker improvement note

- [x] Locate README / changelog docs for agentic-harness
- [x] Add concise note about structured progress tracker improvements
- [x] Verify wording and file diff

## Review

Updated:
- `CHANGELOG.md` — added Unreleased improvement note for structured progress tracking, live task transitions, session replay, and serialized same-run mutations.
- `README.md` — updated Highlights progress tracker bullet.
- `extensions/agentic-harness/README.md` — added feature bullet for structured progress tracking.

Verification:
- Reviewed `git diff` for the three docs files.
- Grep confirmed the new wording appears in each target file.

---

# Current: Async subagent final-response hard guard

Done when:
- [x] Pending non-background async subagent runs cannot be silently bypassed by a final assistant response.
- [x] The guard lists active run IDs and tells the model to `wait`, inspect `status`, `interrupt`, or explicitly mark runs as background before finalizing.
- [x] Completed async results remain retrievable through `action:"wait"` / status paths already present.
- [x] Focused tests cover registry dependency updates and message-end guard behavior.
- [x] `cd extensions/agentic-harness && npm run build && npm test` passes.

Plan:
- [x] Inspect existing async registry, subagent tool schema/actions, and extension message lifecycle hooks.
- [x] Add the minimal registry support needed to mark a run as background / non-blocking.
- [x] Extend `subagent` action handling and prompt guidelines with an explicit release/mark-background option.
- [x] Add a `message_end` hard guard that replaces premature final assistant text while active non-background async runs exist, and queues a follow-up instruction for the model to choose an action.
- [x] Add focused tests for the new behavior.
- [x] Run build/tests and document review results.

## Review

Completed.
- Added `action:"mark-background"` to the subagent run-management contract so the lead model can explicitly release an async run from final-response blocking.
- Added final-response guard logic that blocks assistant stop messages while active non-background async runs are still spawning/running, lists run IDs, and queues a follow-up instruction to choose wait/status/interrupt/mark-background.
- Added active async guard context before agent starts, stronger async start/status messaging, and focused coverage for registry dependency updates and message-end guard behavior.
- Verification: `cd extensions/agentic-harness && npm run build` — PASS.
- Verification: `cd extensions/agentic-harness && npm test` — PASS, 59 files / 691 tests.

---

# Current: Commit and Push to main

- [x] Confirm repository, branch, remote, and working tree
- [x] Run verification before commit
- [x] Commit all requested changes
- [x] Integrate commit onto `main`
- [x] Push `main` to remote
- [x] Verify remote status and summarize

## Review

Completed.
- Repository: `/Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension`
- Remote: `origin https://github.com/tmdgusya/roach-pi.git`
- Verification: `cd extensions/agentic-harness && npm run build && npm test` — PASS, 59 files / 682 tests
- Commit: `290a420 feat: add structured harness state tools`
- Integration: fast-forwarded local `main` from `edd10fe` to `290a420`
- Push: `origin/main` updated to `290a420`

