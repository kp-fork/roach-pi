import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Single source of truth for the pinned literal shared across the clarification
// skill (M7) and the three contract critics (M3).
const ASSUMPTION_LITERAL = "ASSUMPTION:";

const FILES = [
  "../skills/agentic-clarification/SKILL.md",
  "../agents/reviewer-feasibility.md",
  "../agents/reviewer-architecture.md",
  "../agents/reviewer-risk.md",
] as const;

describe("MF: cross-file ASSUMPTION literal pin", () => {
  for (const rel of FILES) {
    it(`${rel} contains the pinned ${ASSUMPTION_LITERAL} literal`, () => {
      const text = readFileSync(new URL(rel, import.meta.url), "utf-8");
      expect(text).toContain(ASSUMPTION_LITERAL);
    });
  }
});
