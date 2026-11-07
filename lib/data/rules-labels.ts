import type { Severity } from "@/lib/types/ads";

/**
 * Labels and option lists shared by the Rules UI. No server-only imports, so
 * client components can use them (lib/data/rules.ts re-exports them).
 */

export type RuleKind = "regulatory" | "policy" | "offer" | "security";

/** Products a rule can apply to (plus the 'all' wildcard). */
export const RULE_APPLIES_TO: readonly string[] = ["all", "personal_loan", "credit_card", "mortgage", "other"];

export const PRODUCT_LABELS: Record<string, string> = {
  all: "All products",
  personal_loan: "Personal loan",
  credit_card: "Credit card",
  mortgage: "Mortgage",
  other: "Other",
  unknown: "Unknown",
};

export const SEVERITIES: readonly Severity[] = ["critical", "major", "minor"];

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  regulatory: "Law",
  policy: "Company policy",
  offer: "Product terms",
  security: "Security",
};
