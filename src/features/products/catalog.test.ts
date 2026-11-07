// Characterization tests for the product catalog (./catalog): which values
// are products, which a person can pick, and their display names.
// Run with: bun test src/features/products/catalog.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import { PRODUCTS, PRODUCT_TYPES, asProduct, isProduct, isProductType, productLabel } from "./catalog";

describe("product catalog", () => {
  test("every product is selectable except unknown, which comes last", () => {
    expect([...PRODUCTS]).toEqual(["personal_loan", "credit_card", "mortgage", "other", "unknown"]);
    expect([...PRODUCT_TYPES]).toEqual(["personal_loan", "credit_card", "mortgage", "other"]);
  });

  test("parses stored values without trusting prototype keys", () => {
    expect(asProduct("mortgage")).toBe("mortgage");
    expect(asProduct("constructor")).toBe("unknown");
    expect(asProduct("__proto__")).toBe("unknown");
    expect(asProduct(null)).toBe("unknown");
    expect(productLabel("toString")).toBe("Unknown product");
  });

  test("matching is exact: no trimming or case folding", () => {
    expect(asProduct("Mortgage")).toBe("unknown");
    expect(asProduct(" mortgage")).toBe("unknown");
    expect(isProduct(42)).toBe(false);
  });

  test("selectable products exclude unknown", () => {
    expect(isProductType("other")).toBe(true);
    expect(isProductType("unknown")).toBe(false);
    expect(isProduct("unknown")).toBe(true);
    expect(isProductType(undefined)).toBe(false);
  });

  test("labels, with anything unrecognised read as unknown", () => {
    expect(PRODUCTS.map((p) => productLabel(p))).toEqual(["Personal loan", "Credit card", "Mortgage", "Other", "Unknown product"]);
    expect(productLabel(null)).toBe("Unknown product");
    expect(productLabel(undefined)).toBe("Unknown product");
    expect(productLabel("auto_loan")).toBe("Unknown product");
  });
});
