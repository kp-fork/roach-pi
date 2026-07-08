# Context Brief: roach-pi forge→hammer 자율 파이프라인 재구성

- **Date**: 2026-07-08
- **Status**: Approved
- **Reference model**: `/Users/roach/glm-hammer` (forge→hammer plugin)

## Goal

roach-pi의 clarify→goal 워크플로를 glm-hammer의 forge→hammer 수준의 자율성으로 재구성한다 — 사용자 게이트는 Goal Contract 승인 1회, 이후 크리틱 패널·구현·검증·최종 리뷰가 사용자 개입 없이 자동으로 순환한다.

## Scope

### In scope

- **clarify 스킬 forge화** (`extensions/agentic-harness/skills/agentic-clarification/SKILL.md`): recon 서브에이전트 선행 → 코드가 답 못하는 것만 최대 4개 번들 질문(1~2라운드) → 나머지는 방어 가능한 기본값 제안. 한-질문-씩 체크리스트 게이트 폐기 — 체크리스트 항목은 에이전트가 자체 판단으로 채우고 '가정(assumption)'으로 표시.
- **Anvil 크리틱 패널**: Goal Contract를 feasibility/integration/coverage 크리틱 3명이 병렬 검증(subagent parallel 모드), 전원 APPROVE까지 에이전트가 자율 수정 반복. 라운드 상한(3회) 초과 시 사용자 에스컬레이션.
- **자동 체인**: Contract 사용자 승인 후 `/goal` 수동 실행 없이 hammer(goal 런타임) 자동 시작 — `draft_goal_contract` 승인 시 `autoStartGoalRuntime()` 자동 호출 (`pi.sendUserMessage` followUp 또는 직접 호출). 고위험 Contract의 `ctx.ui.confirm` 안전장치는 유지.
- **서브에이전트 로스터 전체 이식**: glm-hammer식 고정 바이너리 체크리스트 판정(판정 = YES/NO 전 항목 AND로 계산, 홀리스틱 인상 금지) 에이전트로 재구성 — forge 크리틱 3(feasibility/integration/coverage) + worker/validator + security-reviewer/qa-reviewer. 양식 참조: `glm-hammer/agents/feasibility-critic.md`.
- **태스크 루프**: subgoal마다 worker→validator 2단 정보 격리 — validator는 계획 필드를 verbatim으로만 받고 worker가 무엇을 했는지 모른 채 검증.
- **최종 리뷰 패널**: 전체 완료 시점에 security/qa 병렬 패널. FAIL 항목은 fix task(subgoal)로 재순환. 코드 품질 판정(implementation-critic 역할)은 qa-reviewer 체크리스트에 통합.
- **강제(enforcement) 확장**: goal 런타임 리듀서 게이트 확장 — 크리틱 판정문·검증 리시트를 상태 전이 조건으로 요구(fail-closed). 3회 연속 실패 예산 신규 구현 → 초과 시 자동 진행 중단 + 사용자 에스컬레이션.

### Out of scope

- glm-hammer의 훅 기반 강제(plan seal, dispatch ledger, stop-gate) — pi에 Stop 훅이 없어 불가, 리듀서 게이트로 대체
- crucible(디자인 단계) 상당 기능
- 태스크별 implementation-critic 3단 루프 — worker→validator 2단으로 대체
- `/team` 모드 변경
- 스킬/커맨드 개명 — **clarify/goal 이름 유지**, 의미만 forge/hammer식으로 이식 (테스트·세션 상태·문서 churn 최소화)

## Technical Context

- roach-pi는 pi 확장 스위트(`pi-engineering-discipline-extension` v1.39.0). 핵심은 `extensions/agentic-harness/` — 스킬(`skills/*/SKILL.md`, `resources_discover` 훅으로 노출), 에이전트 정의(`agents/*.md`), phase 상태 머신 + 커맨드(`index.ts`), goal 런타임(`goal-state.ts`, `goal-command.ts`, `goal-continuation.ts`, `goal-verifier.ts`).
- **pi에는 턴 종료 차단 훅이 없음**: `agent_end`/`turn_end`는 결과 타입이 없어 관찰 전용 (`@mariozechner/pi-coding-agent` types.d.ts:485-502). 개입 가능 지점은 `tool_call`(블록), `tool_result`(재작성), `input`(변환)뿐. 따라서 glm-hammer의 "Stop 훅이 증거를 검사" 모델은 pi에서 **"상태 전이가 증거를 요구"** 모델로 번역된다.
- 기존 verifier 하드게이트가 이미 이 패턴: `/goal complete` → `runGoalVerifier()`(index.ts:1872) → 신선한 PASS 리시트 없이는 `complete_target` 불가, 프로세스 실패 시 verdict 강제 FAIL(fail-closed). 이를 크리틱 패널·최종 패널로 확장한다.
- 자동 체인 재료는 기존재: `autoStartGoalRuntime()`(index.ts:1757)이 저장된 goalContract에서 goal/subgoal 자동 생성·활성화. 유일한 갭은 사용자의 `/goal` 1회 — 이를 닫는 것은 국소 변경.
- continuation 루프: `planGoalContinuation()`(goal-continuation.ts:21-54) — 루트 세션 + depth 0 + 단일 lease 가드. FAIL → 블로커 follow-up, PASS → 다음 runnable target follow-up, `pi.sendUserMessage(prompt, {deliverAs:"followUp"})`로 재주입. **3-스트라이크 예산은 미구현 확인 → 신규 항목.**
- 시스템 프롬프트는 프롬프트 캐시 안정성을 위해 정적 유지(index.ts:1279-1290) — phase 지침은 follow-up 메시지로 주입하는 기존 패턴 준수.
- 참조: glm-hammer `skills/{forge,hammer}/SKILL.md`(자율성 언어·하드게이트 목록), `agents/feasibility-critic.md`(바이너리 체크리스트 양식). 재구성 플랜 양식 전례: `docs/engineering-discipline/plans/2026-05-28-clarify-to-goal-runtime-rewrite.md`(Task 0 Baseline Lock — 실패 테스트 선행).

## Constraints

- 세션 상태 스냅샷/리플레이(`goal-storage.ts`, `clarification-storage.ts`) 하위 호환 유지
- 피닝 테스트 갱신 필수: `tests/extension.test.ts`, `tests/skill-docs.test.ts`, `tests/goal-*.test.ts`
- 서브에이전트는 별도 pi 프로세스(최대 12 병렬, 10 동시) — 크리틱 3명 병렬은 기존 subagent parallel 모드로 충족
- 크리틱/패널 추가로 토큰 비용 증가 — 패널 라운드 상한(3)으로 바운드
- 비대화형(non-interactive) 모드에서 고위험 confirm 게이트는 fail-closed(거부)로 동작해야 함

## Success Criteria

1. 모호한 요청 → recon → 번들 질문 → Contract 초안 → 크리틱 3명 전원 APPROVE → 사용자 승인 1회 → **사용자 추가 입력 없이** subgoal 순환(worker→validator) → verifier PASS → security/qa 패널 PASS → 완료, 가 한 흐름으로 동작
2. 크리틱/validator/패널 판정문 리시트가 없으면 해당 상태 전이가 리듀서에서 거부됨 (테스트로 증명)
3. 3회 연속 실패 시 자동 진행이 멈추고 블로커 요약과 함께 사용자 에스컬레이션
4. `npm test && npm run build` 전체 통과

## Open Questions

- (해소) 네이밍 → clarify/goal 유지
- (해소, 기본값 채택) implementation-critic 역할 → qa-reviewer 체크리스트에 통합

## Complexity Assessment

| Signal | 점수 | 근거 |
|--------|------|------|
| Scope breadth | High (3) | 스킬, goal 런타임, continuation, 에이전트 로스터, 검증기, 커맨드 표면 — 횡단 변경 |
| File impact | High (3) | 15+ 파일, 3개 이상 디렉토리 (skills/, agents/, 확장 TS, tests/) |
| Interface boundaries | High (3) | 신규 리듀서 액션·크리틱 리시트 타입, 상태 전이 계약 변경 |
| Dependency depth | Medium (2) | Baseline Lock → (에이전트/스킬 병렬) → 런타임 게이트 → 자동 체인 → 최종 검증 |
| Risk surface | Medium (2) | 세션 상태 리플레이 하위 호환 — 내부 통합 리스크 |

**Score: 13** / **Verdict: Complex (10-15)**
**Rationale**: 지배 요인은 상태 머신 계약 변경의 횡단성 — 스킬 문서만이 아니라 리듀서/continuation/verifier의 강제 계층과 에이전트 로스터를 함께 바꿔야 하며, 전례(2026-05-28 rewrite)도 14-task 규모였다.

## Suggested Next Step

Proceed to `milestone-planning` — 사용자 확정. 마일스톤 분해 후 단계별 plan-crafting/실행 사이클로 진행.
