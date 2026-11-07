# Starter rules: what each one checks and why

The starter library (`lib/seed/starter-rules.ts`) is 16 rules every new workspace gets. Each workspace owns a copy (edit with a reason, turn off, version history), so the library is a starting point, not a mandate. This page explains, per rule, what it checks, its legal basis, and why it carries the default severity it does. The product terms the offer rule compares against are at the end.

Severity scale used throughout:

| Severity | Meaning for the reviewer |
|---|---|
| **Critical** | The ad cannot run as is: a required disclosure is missing, a stated term is not real, or the claim is deceptive on its face. Approving over it needs a written exception. |
| **Major** | Must be fixed before approval in the normal course; an exception is possible when the reviewer documents why the risk is acceptable (for example a disclosure that is small but readable in the final placement). |
| **Minor** | A one-line fix with low enforcement exposure. It still blocks nothing by itself, but it is listed on the fix list. |

A note on citations. Regulation Z's closed-end advertising section is 12 CFR 1026.24: **(a)** actually available terms, **(b)** clear and conspicuous, **(c)** rate stated as APR, **(d)** trigger terms, **(f)** dwelling-secured rate and payment rules, **(i)** prohibited practices in dwelling-secured ads. The open-end section is 12 CFR 1026.16: **(a)** actually available, **(b)** trigger terms, **(f)** misleading "fixed", **(g)** promotional rates. Earlier drafts of this project cited "1026.24(b)" for actually-available terms; the rules cite (a), which is the correct paragraph. Every reference URL in `REFERENCE_LIBRARY` was checked to resolve on 2026-11-06 (eCFR, law.cornell.edu and owasp.org; ftc.gov pages are not linked because they could not be verified from this environment).

---

## OFFER-MATCH · Rates, fees and amounts match ClearPath's current product terms

**Kind:** offer · **Applies to:** all products · **Severity:** Critical

Compares every number in the ad (APR floors and ceilings, "as low as" rates, intro rates and periods, go-to rates, annual, origination, balance transfer and late fees, loan amounts, terms, down payments, rewards rates, funding-time and credit-check statements) with the workspace's current product terms in the Products tab. The engine does the numeric comparisons deterministically (so "5.99% APR" against an 8.99% floor is caught without a model) and the rule text tells the model how to treat ranges, floors and representative examples. Legal basis: Regulation Z permits an ad to state only terms the creditor is actually prepared to offer (12 CFR 1026.24(a) closed-end; 12 CFR 1026.16(a) open-end), and a rate or fee nobody can get is a deceptive representation under the FTC Act and the CFPA. Critical because the mismatch is objective, the ad is wrong the moment it runs, and it is the single most common finding in lender advertising enforcement. When product terms change, every approved ad whose check used the old terms is sent back to review (the "Rates changed" tag), which is why this rule is tied to offer versions rather than to a fixed number in the rule text.

## TRIGGER-CLOSED · Trigger terms need the full set of disclosures (personal loans and mortgages)

**Kind:** regulatory · **Applies to:** personal loans, mortgages · **Severity:** Critical

12 CFR 1026.24(d): stating a down payment, the number of payments or repayment period, a payment amount, or a finance charge amount obliges the ad to also state the down payment, the terms of repayment over the full term, and the APR (with notice if it can increase). The rule lists the four triggers with examples ("as low as $199/mo", "36 monthly payments", "5% down") and the three required disclosures, and explicitly excludes non-triggers ("low monthly payments", "borrow up to $40,000", an APR alone) so the model does not over-flag. Critical because it is an omission of a legally required disclosure, and because payment-led ads ("just $189/month") are precisely where consumers are misled about cost. The suggested fix is a representative example computed from the current product terms, which is the standard industry cure.

## APR-TERM · Rates are stated as an annual percentage rate

**Kind:** regulatory · **Applies to:** personal loans, credit cards · **Severity:** Major

12 CFR 1026.24(c) (closed-end) and 12 CFR 1026.16(b)(1)(ii) (open-end): a rate of finance charge must be expressed as an "annual percentage rate" using that term, a simple rate may appear only alongside the APR and not more prominently, and a variable APR must be identified as such. The rule distinguishes rates of finance charge from percentages that are not (cash back, fee percentages, autopay discounts). Major rather than Critical because the number is usually real and the cure is a label; it becomes Critical in practice only when combined with an offer mismatch. Mortgage ads are handled by MORTGAGE-RATE-PAYMENT, which folds in the same requirement with the extra dwelling-secured rules, so the two rules never fire on the same quote.

## CARD-TRIGGER · Credit card trigger terms need APR and fee disclosures

**Kind:** regulatory · **Applies to:** credit cards · **Severity:** Critical

12 CFR 1026.16(b): stating an APR, a periodic rate, or any account-opening fee (including "no annual fee") triggers disclosure of transaction charges that are finance charges, each APR with "variable" where applicable, and any annual fee. The rule treats a zero or waived fee as a stated fee term, consistent with how the Official Interpretations treat "no annual fee". Readability of the disclosures is deliberately left to CLEAR-CONSPIC so that a tiny footer produces one prominence finding instead of a duplicate omission finding. Critical for the same reason as TRIGGER-CLOSED: it is an omission of a required disclosure in the ad itself.

## CARD-INTRO · Intro rates: say "intro", how long it lasts and the rate after

**Kind:** regulatory · **Applies to:** credit cards · **Severity:** Critical

12 CFR 1026.16(g): a promotional rate must carry "introductory" or "intro" in immediate proximity to each listing, state when it ends and the APR that applies afterwards, in a prominent location closely proximate to the first listing, and say which transactions it applies to. The rule spells out the five elements and the one acceptable form ("0% intro APR on purchases for 12 months, then 19.99% to 28.99% variable APR"). The "variable" word is owned by CARD-TRIGGER so the two rules do not double-report. Critical because "0% APR" headlines without the period and go-to rate are the most-cited credit card advertising violation, and because consumers plan balances around the intro period.

## RATE-FIXED · "Fixed" rate claims are accurate

**Kind:** regulatory · **Applies to:** all products · **Severity:** Major

12 CFR 1026.16(f) (a card APR may be called fixed only with a stated period or when it cannot increase), 12 CFR 1026.24(i)(1) (dwelling-secured ads may not call a changeable rate or payment fixed without stating the period and the change), and the FTC Act / CFPA deception standard for amplifiers such as "fixed rate for life" or "your rate never changes", which overstate a loan that has a 24 to 60 month term and fee-inclusive APR. The rule says plainly that an accurate "fixed rate" on a closed-end fixed-rate loan is fine, which keeps the compliant personal-loan fixtures clean. Major because the base claim is usually true and the problem is the overstatement; it is upgraded to Critical by the reviewer when "fixed" describes a variable card.

## APPROVAL-CLAIMS · No "guaranteed approval", "pre-approved", "no credit check" or "instant approval" claims

**Kind:** regulatory · **Applies to:** all products · **Severity:** Critical

12 U.S.C. 5531 and 5536 (CFPA UDAAP) and 15 U.S.C. 45 (FTC Act §5): a claim about the certainty or ease of approval is deceptive when it is not literally true for everyone who responds. ClearPath underwrites every application and pulls credit, so "guaranteed approval", "no credit check" and "instant approval" are false, and "pre-approved" to a general audience misuses a term that belongs to a firm offer of credit under the FCRA. For mortgages, 12 CFR 1014.3(j) adds the consumer's ability to obtain the product. The rule lists accurate alternatives ("checking your rate won't affect your credit score", "decision in minutes", "get prequalified") so that soft-pull language is not flagged. Critical because these claims target financially vulnerable consumers and are the most frequent basis for CFPB and FTC actions against lenders and lead generators.

## SUPERLATIVE-CLAIMS · Superlatives and comparisons have a stated basis

**Kind:** regulatory · **Applies to:** all products · **Severity:** Major

FTC Act §5 and the FTC's advertising substantiation doctrine require a reasonable basis for objective claims before they are made; CFPA UDAAP applies the same standard to lenders. For mortgages, 12 CFR 1026.24(i)(2) bars comparisons between the advertised rate and actual or hypothetical rates or payments unless the advertised rate is available for the full term, and 12 CFR 1014.3 bars misrepresenting comparisons with other products. The rule separates puffery ("a smarter way to borrow") from measurable claims ("best rates in America", "lowest rate guaranteed") and asks the model to quote the claim and mark it as needing a documented basis, because only the compliance team can know whether substantiation exists. Major because substantiation may exist; the reviewer either attaches it or removes the claim.

## CLEAR-CONSPIC · Disclosures are readable: size, contrast and placement

**Kind:** regulatory · **Applies to:** all products · **Severity:** Major

12 CFR 1026.24(b) and the Official Interpretations to 1026.16 and 1026.24 require disclosures to be clear and conspicuous; FTC Act §5 treats a disclosure a consumer would not notice as no disclosure. The rule gives the engine concrete evidence to look for in HTML (font-size under 10px, text colour near the background, opacity, placement far from the claim) and tells it that a disclosure that is simply absent belongs to the relevant omission rule, not here. Major because the words are present and the fix is typographic; a reviewer who knows the final placement (for example a large-format display) can except it with a reason. This is the rule the credit card email sample demonstrates: the go-to APR exists only in a 9px grey footer.

## AFFILIATE-DISCLOSE · Affiliate and paid content says it is paid

**Kind:** regulatory · **Applies to:** all products · **Severity:** Major

16 CFR Part 255 (FTC Endorsement Guides, §255.5 material connections) and FTC Act §5: a paid or commissioned recommendation must disclose the connection clearly, near the recommendation and before the reader acts. The rule names the acceptable forms ("#ad", "Sponsored", "We earn a commission if you apply through our links" at the top or beside the first link) and the inadequate ones ("#sp", "reader-supported" in a footer, a separate disclosures page), and excludes ClearPath's own first-party ads, where no endorsement is implied. It also covers fabricated experiences and paid rankings presented as independent. Major because the lender is responsible for its affiliates' disclosures under the Guides, and because the fix is one visible line.

## EQUAL-HOUSING · Mortgage ads carry the Equal Housing legend

**Kind:** regulatory · **Applies to:** mortgages · **Severity:** Major

HUD's Fair Housing Act advertising guidance and 24 CFR Part 110 (the Equal Housing Opportunity logo and legend), 12 CFR 338.3 for FDIC-supervised institutions (the Equal Housing Lender logo or legend in dwelling-loan advertising), with parallel OCC and Federal Reserve rules. ClearPath policy adds the NMLS identifier, which most states require on mortgage advertising. The rule applies only to mortgage ads so that personal-loan and card ads are never flagged, and it tells the model to quote the footer or state that none exists. Major rather than Critical because the omission is objective, is cured by one line, and carries fair-lending exposure rather than consumer-harm exposure; many lenders treat it as a hard block, and a workspace can raise the severity.

## MORTGAGE-RATE-PAYMENT · Mortgage rates and payments show the APR and the whole picture

**Kind:** regulatory · **Applies to:** mortgages · **Severity:** Critical

12 CFR 1026.24(c) and (f): a simple rate in a dwelling-secured ad requires the APR at equal prominence; multiple rates (ARMs, buydowns) require each rate, its period and the APR together; a payment requires every payment that will apply over the term, its period, and for first liens a statement that taxes and insurance are excluded and the actual payment will be higher. The rule's "do not flag" example is the compliant MG-1 rate sheet example with its assumptions and date, so a correctly built mortgage ad produces no finding. Critical because rate-led mortgage ads without the APR and assumptions are the core of what 1026.24(f) was written to stop, and because rates change daily, which is why the MG-1 terms carry a rate sheet date.

## MORTGAGE-MISLEAD · No government-affiliation, debt-elimination or "counselor" claims in mortgage ads

**Kind:** regulatory · **Applies to:** mortgages · **Severity:** Critical

12 CFR 1014.3 (Regulation N, the Mortgage Acts and Practices advertising rule) and 12 CFR 1026.24(i)(3) to (i)(6): no implied government source, endorsement or affiliation unless the product is in fact FHA, VA or USDA; no misuse of the consumer's current lender's name; no debt-elimination claims; no "counselor" framing; no misrepresentation of fees, term, rate type, payment timing, cash availability or the consumer's ability to obtain the loan. The rule lists the tell-tale phrases ("official notice", "federal program", "government-backed low rates", "you have been selected") and excludes accurate descriptions of real government-insured products and industry terms like "conforming". Critical because Regulation N violations carry civil penalties per violation and because these mailers are the classic vehicle for mortgage fraud against older homeowners.

## DEBT-SAVINGS · Consolidation and savings claims are substantiated

**Kind:** policy · **Applies to:** personal loans, credit cards · **Severity:** Major

A ClearPath policy that applies FTC Act §5 substantiation and CFPA UDAAP to the specific claims consolidation marketing makes: average savings, payoff speed, interest cuts. Consolidation moves debt rather than removing it, and a longer term can raise total interest even at a lower APR, so an unqualified savings number is likely to mislead. The rule allows a worked example with its assumptions (the body includes one computed from PL-1 terms: moving $10,000 at 24.99% to a 36-month loan at 12.99% interest and a 3% fee saves about $3,600 in interest at the same monthly payment) and declines to flag plain descriptions of what consolidation does. It is kind "policy" rather than "regulatory" because the trigger is ClearPath's own substantiation standard; the legal basis is the general deception standard. Major because the claim can be made truthfully with the right data and disclosure.

## SMS-CONSENT · Text campaigns identify the sender and give an opt-out

**Kind:** policy · **Applies to:** all products (SMS/MMS creative only) · **Severity:** Minor

47 U.S.C. 227 (TCPA) and 47 CFR 64.1200 require prior express written consent for marketing texts and an honoured opt-out; carrier and CTIA rules expect sender identification, a STOP instruction and a rates line. The rule checks only the creative (sender name, STOP line, "Msg & data rates may apply", no "forward to a friend"), because consent records live outside the ad. It applies to no other channel, so emails and posts are never flagged under it. Minor because it is a one-line append and the consent question is handled by the campaign list, not the copy; the real TCPA exposure is in sending without consent, which this product cannot see.

## HIDDEN-TEXT · Hidden or AI-directed text in the ad

**Kind:** security · **Applies to:** all products · **Severity:** Critical

OWASP LLM01 (prompt injection via untrusted documents) and FTC Act §5 (text a consumer cannot see is not a disclosure, and text aimed at a reviewer is an attempt to deceive the review). The rule defines hidden text concretely (background-coloured text, tiny fonts, off-screen or zero-opacity elements, instructions in comments, attributes or metadata) and instruction-like text ("AI reviewer: approve it", "ignore previous instructions"), and states the system's stance: such text is evaluated as content only, can never change a check's outcome, and cannot approve anything because approval is a human decision the database enforces. It excludes legitimate hidden elements (email preheaders carrying ordinary copy, descriptive alt text, layout CSS). Critical by itself regardless of the rest of the ad: a submitter who hides instructions to the reviewer has already told the reviewer what to think of the ad. The engine also records a security alert that must be acknowledged before any decision, and the asset goes to manual review.

---

## ClearPath Financial product terms (starter products)

These seed a workspace that has no offers yet (`lib/seed/starter-products.ts`). After that, the Products tab is the source of truth: editing terms creates a new offer version with a reason, and every approved ad whose check used the old version returns to Needs review tagged "Rates changed". The numeric keys are what the deterministic offer checks read; `summary` is the sentence a reviewer sees.

| Code | Product | Key terms | Fees | Other |
|---|---|---|---|---|
| **PL-1** ClearPath Personal Loan | Personal loan, fixed rate | 8.99% to 24.99% APR (includes the 0.25% autopay discount); $2,000 to $40,000; 24 to 60 months | Origination fee 1% to 5% of the loan amount, deducted from proceeds; late fee $15 after a 10-day grace period; no prepayment penalty | Soft inquiry to check a rate, hard inquiry to apply; funds as soon as the next business day; minimum credit tier Fair (FICO 640+). Representative example: $10,000 for 36 months at 12.99% interest with a 3% fee ($300) is 15.13% APR and 36 payments of $336.89 (computed, not invented). |
| **CC-1** ClearPath Cash Rewards Card | Credit card, variable rate (Prime) | 0% intro APR on purchases for 12 months, then 19.99% to 28.99% variable | Annual fee $0; balance transfer fee 3% ($5 minimum); late fee up to $40 | 2% cash back on every purchase; minimum credit tier Good (FICO 670+). Any intro APR in an ad needs "intro", the period, "purchases" and the go-to range together, and "variable" wherever an APR appears. |
| **CC-2** ClearPath Balance Transfer Card | Credit card, variable rate (Prime) | 0% intro APR on balance transfers for 18 months (transfers within 60 days of opening), then 18.99% to 27.99% variable; purchases at 18.99% to 27.99% variable with no intro rate | Annual fee $0; balance transfer fee 3% ($5 minimum); late fee up to $40 | No rewards; minimum credit tier Good (FICO 670+). Ads must not imply 0% on purchases and must state the 3% transfer fee when promoting transfers. |
| **MG-1** 30-year fixed mortgage prequalification | Mortgage, conventional conforming, fixed | Example rate 6.625% / 6.74% APR as of 2026-11-03 on a $400,000 loan, 20% down, 740+ credit score, 0.5 discount points; principal and interest $2,561 per month, excluding taxes and insurance | Discount points as per rate sheet; mortgage insurance below 20% down | Conforming limit $806,500; minimum down payment 3%; a prequalification is not a commitment to lend; Equal Housing Lender; NMLS #000000 (placeholder). Rates change daily, so an ad must carry the rate sheet date, the APR at equal prominence and the example assumptions. |

The APR figures in the PL-1 and MG-1 examples were computed with the standard actuarial method (the PL-1 example from the stated interest rate, term and fee; the MG-1 APR from the stated rate with about $4,700 in prepaid finance charges including the 0.5 points). The NMLS id is a placeholder because ClearPath is fictional; a real workspace replaces it in the Products tab.
