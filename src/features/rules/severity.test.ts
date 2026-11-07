// Characterization tests for severity (./severity): the list, its order, its
// words and the parser for stored values.
// Run with: bun test src/features/rules/severity.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import { SEVERITIES, SEVERITY_LABELS, SEVERITY_ORDER, asSeverity, severityLabel, type Severity } from "./severity";

describe("severity", () => {
  test("listed worst first, and the sort key agrees", () => {
    expect([...SEVERITIES]).toEqual(["critical", "major", "minor"]);
    expect(SEVERITIES.map((s) => SEVERITY_ORDER[s])).toEqual([0, 1, 2]);
    const shuffled: Severity[] = ["minor", "critical", "minor", "major"];
    expect([...shuffled].sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b])).toEqual(["critical", "major", "minor", "minor"]);
  });

  test("asSeverity keeps known values and reads anything else as minor", () => {
    for (const s of SEVERITIES) expect(asSeverity(s)).toBe(s);
    expect(asSeverity("Critical")).toBe("minor");
    expect(asSeverity("blocker")).toBe("minor");
    expect(asSeverity("")).toBe("minor");
    expect(asSeverity(null)).toBe("minor");
    expect(asSeverity(undefined)).toBe("minor");
    expect(asSeverity(0)).toBe("minor");
  });

  test("severityLabel gives the word, defaulting to Minor", () => {
    expect(SEVERITY_LABELS).toEqual({ critical: "Critical", major: "Major", minor: "Minor" });
    expect(severityLabel("critical")).toBe("Critical");
    expect(severityLabel("major")).toBe("Major");
    expect(severityLabel("minor")).toBe("Minor");
    expect(severityLabel("MAJOR")).toBe("Minor");
    expect(severityLabel("")).toBe("Minor");
  });
});
