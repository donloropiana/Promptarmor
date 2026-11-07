import type { Product } from "@/lib/types/ads";

/**
 * Cheap, deterministic inference of product, channel and title for a new ad.
 * Never blocks the check: when unsure it returns 'unknown' / 'display' and
 * the UI shows the values as editable chips.
 */

export type Channel = "email" | "social" | "landing_page" | "pdf" | "display" | "sms" | "search" | "print";

const PRODUCT_SIGNALS: { product: Product; re: RegExp; weight: number }[] = [
  { product: "personal_loan", re: /\bpersonal loans?\b/i, weight: 4 },
  { product: "personal_loan", re: /\b(debt )?consolidation loans?\b|\bconsolidate (your )?debt\b/i, weight: 3 },
  { product: "personal_loan", re: /\bloan amounts?\b|\bborrow (up to|from)\b|\borigination fee\b/i, weight: 2 },
  { product: "personal_loan", re: /\bloans?\b/i, weight: 1 },
  { product: "credit_card", re: /\bcredit cards?\b|\brewards card\b|\bcash ?back card\b/i, weight: 4 },
  { product: "credit_card", re: /\bbalance transfers?\b|\bannual fee\b|\bintro(ductory)? apr\b|\bpurchases and balance transfers\b/i, weight: 3 },
  { product: "credit_card", re: /\bcash ?back\b|\bpoints\b|\brewards\b|\bsign-?up bonus\b/i, weight: 1 },
  { product: "credit_card", re: /\bcards?\b/i, weight: 1 },
  { product: "mortgage", re: /\bmortgages?\b|\bhome loans?\b|\brefinanc(e|ing)\b/i, weight: 4 },
  { product: "mortgage", re: /\bpre-?qual(ify|ified|ification)\b|\bpre-?approv(ed|al)\b|\bclosing costs?\b|\bdown payment\b|\bequal housing\b|\bnmls\b/i, weight: 2 },
  { product: "mortgage", re: /\bhome ?(equity|buying|buyers?)\b|\bheloc\b|\bfixed-rate\b|\b30-year\b|\b15-year\b/i, weight: 2 },
];

/** Product from keywords; 'unknown' when nothing scores. */
export function inferProduct(text: string | null | undefined): Product {
  if (!text) return "unknown";
  const scores: Record<Exclude<Product, "other" | "unknown">, number> = { personal_loan: 0, credit_card: 0, mortgage: 0 };
  for (const s of PRODUCT_SIGNALS) {
    if (s.product === "other" || s.product === "unknown") continue;
    const matches = text.match(new RegExp(s.re.source, s.re.flags + (s.re.flags.includes("g") ? "" : "g")));
    if (matches) scores[s.product] += s.weight * Math.min(matches.length, 3);
  }
  const best = (Object.entries(scores) as [keyof typeof scores, number][]).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 3) {
    return /\b(apr|rate|finance|lend|borrow|credit)\b/i.test(text) ? "other" : "unknown";
  }
  return best[0];
}

export function inferChannel(input: {
  text?: string | null;
  html?: string | null;
  filename?: string | null;
  mimeType?: string | null;
}): Channel {
  const mime = (input.mimeType ?? "").toLowerCase();
  const name = (input.filename ?? "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  const text = `${input.text ?? ""}`;
  const head = text.slice(0, 600);
  if (/^\s*(subject|preheader|pre-header)\s*:/im.test(head) || /\bunsubscribe\b/i.test(text)) return "email";
  if (/\blanding page\b/i.test(head) || /<form\b/i.test(input.html ?? "")) return "landing_page";
  if (/\b(sponsored|paid partnership)\b|#ad\b|#sponsored\b|#partner\b|(^|\s)#[a-z]\w{2,}/i.test(text)) return "social";
  if (/\b(reply stop|txt stop|text stop|msg ?& ?data rates)\b/i.test(text)) return "sms";
  if (/\bsearch ad\b|\bheadline 1\b|\bsitelink\b/i.test(head)) return "search";
  if (/\bprint ad\b|\bflyer\b|\bbrochure\b/i.test(head)) return "print";
  if (input.html) return "landing_page";
  return "display";
}

/** Explicit title, else the first line (<= 80 chars), else the filename, else a generic title. */
export function inferTitle(input: { title?: string | null; text?: string | null; filename?: string | null }): string {
  const explicit = input.title?.trim();
  if (explicit) return explicit.slice(0, 120);
  const text = (input.text ?? "").replace(/\r/g, "");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^(subject|preheader)\s*:\s*/i, "").trim();
    if (!line) continue;
    if (line.length <= 80) return line;
    const cut = line.slice(0, 77).replace(/\s+\S*$/, "");
    return `${cut}…`;
  }
  const name = input.filename?.trim();
  if (name) return name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 120) || name.slice(0, 120);
  return "Untitled ad";
}
