/**
 * Severity, owned by rules (a rule's default severity, a finding's severity
 * and a reviewer's override): the one list, its order, its words and the
 * parser for stored values. Framework-free: server, client and scripts share it.
 */

/** findings.severity and rule_versions.default_severity, worst first. */
export const SEVERITIES = ["critical", "major", "minor"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
} as const satisfies Record<Severity, string>;

/** Sort key: smaller is worse. */
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

/** A stored severity (or override) as a Severity; anything unrecognised reads as minor. */
export function asSeverity(s: unknown): Severity {
  return s === "critical" || s === "major" || s === "minor" ? s : "minor";
}

/** The word for a stored severity; anything unrecognised reads as "Minor". */
export function severityLabel(s: string): "Critical" | "Major" | "Minor" {
  return SEVERITY_LABELS[asSeverity(s)];
}
