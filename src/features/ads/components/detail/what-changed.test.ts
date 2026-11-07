// Characterization tests for the version comparison summary (./what-changed):
// which prior issues count as fixed or not re-flagged, and which current
// issues are still there or new.
// Run with: bun test src/features/ads/components/detail/what-changed.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import { recheckLabel, summariseChanges } from "./what-changed";

// Derived from the function rather than imported from the server queries module, which is server-only.
type Finding = Parameters<typeof summariseChanges>[0][number];
type Disposition = NonNullable<Finding["disposition"]>["disposition"];

const finding = (id: string, over: Partial<Finding> = {}): Finding => ({
  id,
  versionId: "v",
  origin: "ai",
  authorLabel: null,
  severity: "major",
  originalSeverity: "major",
  evidenceType: "offer_mismatch",
  quote: "Rates as low as 5.99% APR",
  verifiedSpan: true,
  anchor: { start: 0, end: 25 },
  imageAnchor: null,
  explanation: null,
  suggestedFix: null,
  suggestedCopy: null,
  priorFindingId: null,
  recheckStatus: null,
  reusedFromFindingId: null,
  rule: null,
  disposition: null,
  open: true,
  decisionGrade: true,
  wordsStillThere: null,
  createdAt: "2026-11-07T10:00:00Z",
  ...over,
});

const disposed = (disposition: Disposition, open: boolean): Partial<Finding> => ({
  open,
  disposition: { id: `d-${disposition}`, disposition, reason: null, note: null, actorLabel: null, carried: false, createdAt: "2026-11-07T11:00:00Z" },
});

const ids = (fs: Finding[]) => fs.map((f) => f.id);

describe("summariseChanges", () => {
  test("splits prior issues into fixed and not re-flagged by whether their words remain", () => {
    const previous = [finding("gone", { wordsStillThere: false }), finding("kept", { wordsStillThere: true }), finding("unknown", { wordsStillThere: null })];
    const summary = summariseChanges([], previous);
    expect(ids(summary.fixed)).toEqual(["gone", "unknown"]);
    expect(ids(summary.notReflagged)).toEqual(["kept"]);
    expect(summary.stillThere).toEqual([]);
    expect(summary.fresh).toEqual([]);
  });

  test("a prior issue with a successor is neither fixed nor not re-flagged", () => {
    const previous = [finding("p1", { wordsStillThere: true }), finding("p2", { wordsStillThere: false })];
    const current = [finding("c1", { priorFindingId: "p1", recheckStatus: "still_present" })];
    const summary = summariseChanges(current, previous);
    expect(ids(summary.fixed)).toEqual(["p2"]);
    expect(summary.notReflagged).toEqual([]);
    expect(ids(summary.stillThere)).toEqual(["c1"]);
  });

  test("only open prior issues and accepted exceptions count; dismissed ones drop out", () => {
    const previous = [
      finding("open", { wordsStillThere: false }),
      finding("fix", { wordsStillThere: false, ...disposed("fix_required", true) }),
      finding("exception", { wordsStillThere: false, ...disposed("accepted_exception", false) }),
      finding("dismissed", { wordsStillThere: false, ...disposed("dismissed", false) }),
    ];
    expect(ids(summariseChanges([], previous).fixed)).toEqual(["open", "fix", "exception"]);
  });

  test("current issues are still there when linked to a prior or rechecked as present, else new", () => {
    const current = [
      finding("linked", { priorFindingId: "p9" }),
      finding("present", { recheckStatus: "still_present" }),
      finding("moved", { recheckStatus: "re_anchored" }),
      finding("new", { recheckStatus: "new" }),
      finding("unchecked", { recheckStatus: null }),
    ];
    const summary = summariseChanges(current, []);
    expect(ids(summary.stillThere)).toEqual(["linked", "present", "moved"]);
    expect(ids(summary.fresh)).toEqual(["new", "unchecked"]);
  });
});

describe("recheckLabel", () => {
  test("Still there for a linked or rechecked-present issue, else New", () => {
    expect(recheckLabel(finding("a", { priorFindingId: "p" }))).toBe("Still there");
    expect(recheckLabel(finding("b", { recheckStatus: "still_present" }))).toBe("Still there");
    expect(recheckLabel(finding("c", { recheckStatus: "re_anchored" }))).toBe("Still there");
    expect(recheckLabel(finding("d", { recheckStatus: "new" }))).toBe("New");
    expect(recheckLabel(finding("e"))).toBe("New");
  });
});
