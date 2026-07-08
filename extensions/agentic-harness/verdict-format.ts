/**
 * Panel verdict grammar — the APPROVE/REJECT contract shared by the three
 * contract-critic agent bodies (reviewer-feasibility / reviewer-architecture /
 * reviewer-risk) and the pre-activation panel runtime that parses their output.
 *
 * Scope: panel APPROVE/REJECT ONLY. The goal-completion reviewers
 * (security-reviewer / qa-reviewer) emit PASS/FAIL and are parsed by the
 * existing `parseGoalVerifierOutput` grammar in goal-verifier.ts — not here.
 */

export type PanelVerdict = "APPROVE" | "REJECT";
export type CheckStatus = "YES" | "NO" | "N/A";

/**
 * Shared literal pinned into each contract critic .md body by the drift test
 * (tests/verdict-format.test.ts). Edit either side without the other and the
 * suite fails.
 */
export const PANEL_VERDICT_LINE = "VERDICT: APPROVE | REJECT";

/** The full output-format block the contract critic .md bodies prescribe. */
export const PANEL_VERDICT_FORMAT = [
  "CHECKS:",
  "- C1: YES|NO|N/A — <one-line evidence: what you checked>",
  "- C2: ... (one line per check, all checks present)",
  PANEL_VERDICT_LINE,
  "FINDINGS:",
  "- [REJECT-level] <what fails and where> — evidence: <file/symbol/command you checked>",
  "- [advisory] <non-blocking improvement>",
].join("\n");

export interface ParsedPanelCheck {
  id: string;
  status: CheckStatus;
  evidence: string;
}

export interface ParsedPanelFinding {
  level: "REJECT-level" | "advisory";
  text: string;
}

export interface ParsedPanelVerdict {
  verdict: PanelVerdict;
  checks: ParsedPanelCheck[];
  findings: ParsedPanelFinding[];
  rawOutput: string;
}

const VERDICT_LINE_RE = /^VERDICT:\s*(APPROVE|REJECT)\s*$/gim;
const CHECK_LINE_RE = /^-\s*(C\d+):\s*(YES|NO|N\/A)\s*(?:[—–-]\s*)?(.*)$/gm;
const FINDING_LINE_RE = /^-\s*\[(REJECT-level|advisory)\]\s*(.*)$/gm;

/**
 * Strict panel verdict parser. Returns `null` on malformed input — no VERDICT
 * line matching exactly one of APPROVE|REJECT, or both verdicts present.
 * NEVER silently defaults, in deliberate contrast to `parseGoalVerifierOutput`
 * (goal-verifier.ts), which defaults to FAIL when no Verdict line is found.
 */
export function parsePanelVerdictOutput(output: string): ParsedPanelVerdict | null {
  const verdictTokens = new Set<PanelVerdict>();
  for (const match of output.matchAll(VERDICT_LINE_RE)) {
    verdictTokens.add(match[1].toUpperCase() as PanelVerdict);
  }
  if (verdictTokens.size !== 1) {
    return null;
  }
  const verdict = [...verdictTokens][0];

  const checks: ParsedPanelCheck[] = [];
  for (const match of output.matchAll(CHECK_LINE_RE)) {
    checks.push({
      id: match[1],
      status: match[2] as CheckStatus,
      evidence: (match[3] ?? "").trim(),
    });
  }

  const findings: ParsedPanelFinding[] = [];
  for (const match of output.matchAll(FINDING_LINE_RE)) {
    findings.push({
      level: match[1] as ParsedPanelFinding["level"],
      text: (match[2] ?? "").trim(),
    });
  }

  return { verdict, checks, findings, rawOutput: output };
}
