import { PRODUCT_LABELS, PRODUCT_TYPES } from "@/features/products/catalog";

/**
 * Labels and option lists shared by the Rules UI. No server-only imports, so
 * client components can use them. Severity lives in ./severity.
 */

export type RuleKind = "regulatory" | "policy" | "offer" | "security";

/** Products a rule can apply to: the 'all' wildcard plus every selectable product. */
export const RULE_APPLIES_TO: readonly string[] = ["all", ...PRODUCT_TYPES];

/** Names for a rule's applies-to values: the catalog's product names plus 'all'. */
export const APPLIES_TO_LABELS: Record<string, string> = {
  all: "All products",
  ...PRODUCT_LABELS,
  // Rules never target "unknown"; a stray stored value has always read "Unknown" here.
  unknown: "Unknown",
};

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  regulatory: "Law",
  policy: "Company rule",
  offer: "Product terms",
  security: "Security",
};
