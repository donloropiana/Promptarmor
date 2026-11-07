/**
 * The product catalog: every value assets.product can hold, the ones a person
 * can pick (offers and rules never name "unknown"), and their display names.
 * Framework-free, so server code, client components and scripts share it.
 */

/** Products a person can choose for an ad, an offer or a rule (offers.product). */
export const PRODUCT_TYPES = ["personal_loan", "credit_card", "mortgage", "other"] as const;

/** Every value assets.product can hold: the selectable products plus "unknown" (intake could not tell). */
export const PRODUCTS = [...PRODUCT_TYPES, "unknown"] as const;

/** assets.product */
export type Product = (typeof PRODUCTS)[number];

/** A selectable product: any Product except "unknown". */
export type ProductType = (typeof PRODUCT_TYPES)[number];

const PRODUCT_SET: ReadonlySet<string> = new Set(PRODUCTS);
const PRODUCT_TYPE_SET: ReadonlySet<string> = new Set(PRODUCT_TYPES);

export function isProduct(v: unknown): v is Product {
  return typeof v === "string" && PRODUCT_SET.has(v);
}

export function isProductType(v: unknown): v is ProductType {
  return typeof v === "string" && PRODUCT_TYPE_SET.has(v);
}

/** A stored or inferred value as a Product; anything unrecognised is "unknown". */
export function asProduct(v: unknown): Product {
  return isProduct(v) ? v : "unknown";
}

export const PRODUCT_LABELS: Record<Product, string> = {
  personal_loan: "Personal loan",
  credit_card: "Credit card",
  mortgage: "Mortgage",
  other: "Other",
  unknown: "Unknown product",
};

export function productLabel(p: string | null | undefined): string {
  return PRODUCT_LABELS[asProduct(p)];
}
