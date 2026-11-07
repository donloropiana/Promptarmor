import type { OfferTerms } from "@/features/rules/server/queries";

/**
 * The product term fields the UI knows how to render and edit. Terms are
 * plain JSON; anything not listed here still shows under "Other terms" and
 * survives an edit untouched.
 */
export type TermKind = "percent" | "money" | "months" | "number" | "text" | "boolean" | "date";

export type TermField = { key: string; label: string; kind: TermKind; hint?: string; core?: boolean };

export const TERM_FIELDS: readonly TermField[] = [
  { key: "rate_type", label: "Rate type", kind: "text", hint: "fixed or variable", core: true },
  { key: "index", label: "Index", kind: "text" },
  { key: "apr_min", label: "Lowest APR", kind: "percent", hint: "The lowest rate anyone can actually get.", core: true },
  { key: "apr_max", label: "Highest APR", kind: "percent", core: true },
  { key: "autopay_discount_pct", label: "Autopay discount", kind: "percent" },
  { key: "apr_includes_autopay_discount", label: "APR includes autopay discount", kind: "boolean" },
  { key: "intro_apr", label: "Intro APR", kind: "percent", core: true },
  { key: "intro_months", label: "Intro period", kind: "months", core: true },
  { key: "intro_applies_to", label: "Intro applies to", kind: "text" },
  { key: "go_to_apr_min", label: "Go-to APR (lowest)", kind: "percent", hint: "The rate after the intro period.", core: true },
  { key: "go_to_apr_max", label: "Go-to APR (highest)", kind: "percent", core: true },
  { key: "annual_fee", label: "Annual fee", kind: "money", core: true },
  { key: "origination_fee_pct", label: "Origination fee", kind: "percent", core: true },
  { key: "origination_fee_pct_min", label: "Origination fee (lowest)", kind: "percent" },
  { key: "origination_fee_pct_max", label: "Origination fee (highest)", kind: "percent" },
  { key: "origination_fee_deducted_from_proceeds", label: "Origination fee deducted from proceeds", kind: "boolean" },
  { key: "balance_transfer_fee", label: "Balance transfer fee", kind: "text", hint: "Example: 3% ($5 minimum)", core: true },
  { key: "balance_transfer_fee_pct", label: "Balance transfer fee %", kind: "percent" },
  { key: "balance_transfer_fee_min_usd", label: "Balance transfer fee minimum", kind: "money" },
  { key: "late_fee", label: "Late fee", kind: "text", core: true },
  { key: "late_fee_max_usd", label: "Late fee (max)", kind: "money" },
  { key: "prepayment_penalty", label: "Prepayment penalty", kind: "boolean" },
  { key: "loan_min", label: "Smallest loan", kind: "money", core: true },
  { key: "loan_max", label: "Largest loan", kind: "money", core: true },
  { key: "conforming_limit", label: "Conforming limit", kind: "money" },
  { key: "term_months", label: "Term", kind: "months" },
  { key: "term_months_min", label: "Shortest term", kind: "months", core: true },
  { key: "term_months_max", label: "Longest term", kind: "months", core: true },
  { key: "rate_example", label: "Example rate", kind: "percent" },
  { key: "apr_example", label: "Example APR", kind: "percent" },
  { key: "rate_sheet_date", label: "Rate sheet date", kind: "date" },
  { key: "min_down_pct", label: "Minimum down payment", kind: "percent" },
  { key: "mortgage_insurance_below_down_pct", label: "Mortgage insurance below", kind: "percent" },
  { key: "rewards", label: "Rewards", kind: "text" },
  { key: "rewards_rate_pct", label: "Rewards rate", kind: "percent" },
  { key: "min_credit_tier", label: "Minimum credit tier", kind: "text", core: true },
  { key: "credit_check", label: "Credit check", kind: "text" },
  { key: "funding_time", label: "Funding time", kind: "text" },
  { key: "loan_type", label: "Loan type", kind: "text" },
  { key: "equal_housing", label: "Equal Housing Lender", kind: "boolean", hint: "Mortgage ads must carry the legend.", core: true },
  { key: "equal_housing_legend", label: "Equal housing legend", kind: "text" },
  { key: "nmls_id", label: "NMLS id", kind: "text" },
  { key: "nmls_id_is_placeholder", label: "NMLS id is a placeholder", kind: "boolean" },
  { key: "prequalification_is_not_commitment", label: "Prequalification is not a commitment", kind: "boolean" },
];

/** Keys rendered as prose (long text), outside the numbers grid. */
export const TEXT_TERM_KEYS = ["summary", "representative_example", "notes"] as const;
export const TEXT_TERM_LABELS: Record<(typeof TEXT_TERM_KEYS)[number], string> = {
  summary: "Summary",
  representative_example: "Representative example",
  notes: "Notes",
};

const KNOWN = new Set<string>([...TERM_FIELDS.map((f) => f.key), ...TEXT_TERM_KEYS]);

/** True for a key the editor renders as a built-in field; anything else is a fact the workspace defined. */
export function isKnownTermKey(key: string): boolean {
  return KNOWN.has(key);
}

/** "Uptime SLA" -> "uptime_sla": the JSON key for a fact a person names. */
export function factKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** "uptime_sla" -> "Uptime sla" for display. */
export function factLabel(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function formatTerm(kind: TermKind, value: unknown): string {
  if (isEmpty(value)) return "—";
  switch (kind) {
    case "percent": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? `${n % 1 === 0 ? n.toFixed(2) : String(n)}%` : String(value);
    }
    case "money": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return n === 0 ? "$0" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    case "months": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? `${n} ${n === 1 ? "month" : "months"}` : String(value);
    }
    case "boolean":
      return value === true || value === "true" ? "Yes" : "No";
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? String(n) : String(value);
    }
    case "date":
      return typeof value === "string" ? value : String(value);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Known fields present in the terms, in display order. */
export function presentTermFields(terms: OfferTerms): TermField[] {
  return TERM_FIELDS.filter((f) => !isEmpty(terms[f.key]));
}

/** Unknown keys, as label/value pairs (nested objects flattened to "a: 1, b: 2"). */
export function otherTerms(terms: OfferTerms): { key: string; value: string }[] {
  return Object.entries(terms)
    .filter(([k, v]) => !KNOWN.has(k) && !isEmpty(v))
    .map(([k, v]) => ({
      key: k.replace(/_/g, " "),
      value:
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.entries(v as Record<string, unknown>)
              .map(([ik, iv]) => `${ik.replace(/_/g, " ")}: ${typeof iv === "boolean" ? (iv ? "yes" : "no") : String(iv)}`)
              .join(" · ")
          : Array.isArray(v)
            ? v.map(String).join(", ")
            : String(v),
    }));
}

/**
 * Fields the edit form shows: the core set plus whatever the product already
 * has. Non-scalar values (objects, arrays) are never edited in the form and
 * are carried over unchanged on save.
 */
export function fieldsForEdit(terms: OfferTerms | null): TermField[] {
  return TERM_FIELDS.filter((f) => f.core || (terms ? !isEmpty(terms[f.key]) && typeof terms[f.key] !== "object" : false));
}

/** Stringifies a scalar term value for an <input>. */
export function termInputValue(value: unknown): string {
  if (isEmpty(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
