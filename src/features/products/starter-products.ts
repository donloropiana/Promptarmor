import type { ProductType } from "@/features/products/catalog";

/**
 * ClearPath Financial's (fictional) product terms. These are the "actually
 * available terms" every ad is checked against. Each `terms` object is plain
 * JSON with a human-readable `summary` first; the numeric keys are what the
 * deterministic offer checks read. Edit terms in the Products tab, never here:
 * this file only seeds a workspace that has no offers yet.
 */
export type StarterProduct = {
  code: string;
  product: ProductType;
  name: string;
  terms: Record<string, unknown>;
};

export const STARTER_PRODUCTS: StarterProduct[] = [
  {
    code: "PL-1",
    product: "personal_loan",
    name: "ClearPath Personal Loan",
    terms: {
      summary:
        "Fixed-rate personal loan. 8.99% to 24.99% APR, which includes the 0.25% autopay discount. Borrow $2,000 to $40,000 for 24 to 60 months. Origination fee 1% to 5% of the loan amount, deducted from the proceeds. No prepayment penalty. Checking your rate is a soft credit inquiry; applying is a hard inquiry. Funds as soon as the next business day after approval.",
      rate_type: "fixed",
      apr_min: 8.99,
      apr_max: 24.99,
      autopay_discount_pct: 0.25,
      apr_includes_autopay_discount: true,
      loan_min: 2000,
      loan_max: 40000,
      term_months_min: 24,
      term_months_max: 60,
      origination_fee_pct_min: 1,
      origination_fee_pct_max: 5,
      origination_fee_deducted_from_proceeds: true,
      prepayment_penalty: false,
      late_fee: "$15 after a 10-day grace period",
      min_credit_tier: "Fair (FICO 640+); the lowest rates need 740+",
      credit_check: "Soft inquiry to check your rate; hard inquiry when you apply",
      funding_time: "As soon as the next business day after approval",
      representative_example:
        "A $10,000 loan with a 36-month term at a 12.99% interest rate and a 3% origination fee ($300, deducted from proceeds) has a 15.13% APR and 36 monthly payments of $336.89.",
      notes:
        "Your rate depends on credit history, income, loan amount and term. 'As low as' and 'from' rates in ads must equal apr_min. Any payment amount in an ad must come with the amount, term and APR (Reg Z trigger terms).",
    },
  },
  {
    code: "CC-1",
    product: "credit_card",
    name: "ClearPath Cash Rewards Card",
    terms: {
      summary:
        "0% intro APR on purchases for 12 months, then a variable APR of 19.99% to 28.99% based on your creditworthiness and the Prime Rate. No annual fee. 2% cash back on every purchase. Balance transfer fee 3% of each transfer ($5 minimum). Late fee up to $40.",
      rate_type: "variable",
      index: "Prime Rate",
      apr_min: 19.99,
      apr_max: 28.99,
      intro_apr: 0,
      intro_months: 12,
      intro_applies_to: "purchases",
      go_to_apr_min: 19.99,
      go_to_apr_max: 28.99,
      annual_fee: 0,
      rewards: "2% cash back on every purchase, no categories, no cap",
      rewards_rate_pct: 2,
      balance_transfer_fee: "3% of each transfer, $5 minimum",
      balance_transfer_fee_pct: 3,
      balance_transfer_fee_min_usd: 5,
      late_fee: "Up to $40",
      late_fee_max_usd: 40,
      min_credit_tier: "Good (FICO 670+)",
      notes:
        "Any intro APR in an ad must say 'intro', the 12-month period, that it applies to purchases, and the 19.99% to 28.99% variable go-to APR, all together. The word 'variable' is required whenever an APR is stated.",
    },
  },
  {
    code: "CC-2",
    product: "credit_card",
    name: "ClearPath Balance Transfer Card",
    terms: {
      summary:
        "0% intro APR on balance transfers for 18 months (transfers made within 60 days of account opening), then a variable APR of 18.99% to 27.99% based on your creditworthiness and the Prime Rate. Purchases are at the variable 18.99% to 27.99% APR with no intro rate. Balance transfer fee 3% of each transfer, $5 minimum. No annual fee. Late fee up to $40.",
      rate_type: "variable",
      index: "Prime Rate",
      apr_min: 18.99,
      apr_max: 27.99,
      intro_apr: 0,
      intro_months: 18,
      intro_applies_to: "balance transfers made within 60 days of account opening",
      intro_apr_purchases: null,
      go_to_apr_min: 18.99,
      go_to_apr_max: 27.99,
      annual_fee: 0,
      rewards: "None",
      balance_transfer_fee: "3% of each transfer, $5 minimum",
      balance_transfer_fee_pct: 3,
      balance_transfer_fee_min_usd: 5,
      late_fee: "Up to $40",
      late_fee_max_usd: 40,
      min_credit_tier: "Good (FICO 670+)",
      notes:
        "The intro rate applies to balance transfers only; an ad must not imply 0% on purchases. The 3% transfer fee must be stated whenever the ad promotes transfers.",
    },
  },
  {
    code: "MG-1",
    product: "mortgage",
    name: "30-year fixed mortgage prequalification",
    terms: {
      summary:
        "Conventional 30-year fixed-rate mortgage. Example rate 6.625% (6.74% APR) as of November 3, 2026, on a $400,000 loan with 20% down, a 740+ credit score and 0.5 discount points; principal and interest $2,561 per month, which excludes taxes and insurance. Conforming loan amounts up to $806,500. Minimum down payment 3% (mortgage insurance applies below 20%). A prequalification is not a commitment to lend. Equal Housing Lender. ClearPath Financial NMLS #000000 (placeholder id).",
      loan_type: "30-year fixed, conventional conforming",
      rate_type: "fixed",
      term_months: 360,
      rate_example: 6.625,
      apr_example: 6.74,
      rate_sheet_date: "2026-11-03",
      example_assumptions: {
        loan_amount: 400000,
        down_payment_pct: 20,
        credit_score_min: 740,
        discount_points: 0.5,
        principal_and_interest_monthly: 2561,
        excludes_taxes_and_insurance: true,
      },
      conforming_limit: 806500,
      loan_max: 806500,
      min_down_pct: 3,
      mortgage_insurance_below_down_pct: 20,
      prequalification_is_not_commitment: true,
      equal_housing: true,
      equal_housing_legend: "Equal Housing Lender",
      nmls_id: "000000",
      nmls_id_is_placeholder: true,
      min_credit_tier: "FICO 620+ for conventional",
      notes:
        "Rates change daily, so every ad that states a rate must carry the rate sheet date, the APR at equal prominence and the example assumptions. Any payment must say it excludes taxes and insurance. ClearPath is a private lender and must never imply a government program.",
    },
  },
];

export const STARTER_PRODUCT_CODES: ReadonlySet<string> = new Set(STARTER_PRODUCTS.map((p) => p.code));
