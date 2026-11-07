/**
 * Cheap, deterministic pre-classifier for connector arrivals. NO LLM.
 *
 * Decides marketing / not_marketing / uncertain / inline_image from keyword
 * signals in the subject, filename and extracted text, plus the file type.
 * Its only job is to keep obvious non-marketing mail private and out of the
 * triage queue; humans make every real decision, and the AI review runs only
 * after a person accepts an item.
 *
 * Inputs are untrusted. The reason string only ever names our own signal
 * labels, never echoes submitted content.
 */

export type PreClassification = "marketing" | "not_marketing" | "uncertain" | "inline_image";

export type InferredProduct = "personal_loan" | "credit_card" | "mortgage" | "other" | "unknown";

export interface ClassifyInput {
  kind: "email" | "attachment" | "file";
  title?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  text?: string | null;
  sender?: string | null;
  senderEmail?: string | null;
  inlineImage?: boolean;
  /** Subject of the parent email, for attachments. */
  parentTitle?: string | null;
}

export interface ClassifyResult {
  classification: PreClassification;
  reason: string;
  /** Stored as source_items.inferred. */
  inferred: {
    product: InferredProduct;
    channel: string | null;
    confirmed: false;
    score: number;
    marketing_signals: string[];
    other_signals: string[];
  };
}

interface Signal {
  label: string;
  re: RegExp;
  weight: number;
}

const MARKETING: Signal[] = [
  { label: "APR", re: /\bapr\b|annual percentage rate/i, weight: 3 },
  { label: "rate", re: /\b(interest )?rates?\b|\bfixed[- ]rate\b|\bvariable[- ]rate\b|\blow rate\b/i, weight: 1 },
  { label: "percentage", re: /\b\d{1,2}(\.\d{1,2})?\s?%/, weight: 1 },
  { label: "offer", re: /\b(special |limited[- ]time |exclusive |intro(ductory)? )?offers?\b/i, weight: 2 },
  { label: "apply", re: /\bapply( now| today| online)?\b|\bapplication\b/i, weight: 2 },
  { label: "loan", re: /\b(personal |consolidation |home |auto )?loans?\b/i, weight: 2 },
  { label: "card", re: /\bcredit cards?\b|\bcash ?back\b|\bbalance transfer\b|\brewards card\b|\bannual fee\b/i, weight: 2 },
  { label: "mortgage", re: /\bmortgages?\b|\brefinanc\w*|\bheloc\b|\bhome equity\b/i, weight: 2 },
  { label: "terms", re: /\bterms (and|&) conditions\b|\bterms apply\b|\bsee terms\b|\bsubject to (credit )?approval\b|\brestrictions apply\b/i, weight: 2 },
  { label: "disclosure", re: /\bdisclosures?\b|\bmember fdic\b|\bequal housing\b|\bnmls\b|\bnot a commitment to lend\b/i, weight: 2 },
  { label: "CTA", re: /\b(get started|learn more|sign up|check (your )?rate|see if you (pre-?)?qualify|pre-?qualif\w*|pre-?approved|click here|shop now|claim (your|now))\b/i, weight: 2 },
  { label: "promo", re: /\b(limited time|no annual fee|0% intro|introductory|bonus|save up to|as low as|lowest)\b/i, weight: 2 },
  { label: "creative", re: /\b(creative|ad copy|campaign|banner|landing page|social post|headline|draft copy|mailer|flyer|promo|newsletter|copy deck|for (compliance )?review|please review|approval)\b/i, weight: 2 },
  { label: "ad size", re: /\b(300x250|728x90|160x600|320x50|300x600|970x250|1080x1080|1200x628|1080x1920)\b/i, weight: 2 },
];

const NOT_MARKETING: Signal[] = [
  { label: "receipt", re: /\b(receipt|invoice|order (confirmation|#)|your order|payment received|billing statement|amount due)\b/i, weight: 2 },
  { label: "account security", re: /\b(verification code|verify your (email|account)|password reset|reset your password|sign-?in attempt|security alert|two-factor|2fa|one-time (pass)?code)\b/i, weight: 3 },
  { label: "calendar", re: /\b(invitation:|accepted:|declined:|meeting (notes|invite)|calendar|zoom\.us\/j|teams meeting|join the meeting)\b/i, weight: 2 },
  { label: "shipping", re: /\b(shipped|tracking number|out for delivery|delivery update)\b/i, weight: 2 },
  { label: "out of office", re: /\b(out of (the )?office|automatic reply|auto-?reply)\b/i, weight: 3 },
  { label: "personal", re: /\b(lunch|dinner|happy hour|birthday|potluck|carpool|weekend plans)\b/i, weight: 2 },
  { label: "HR/payroll", re: /\b(payroll|pay ?stub|timesheet|pto request|benefits enrollment|w-?2|1099)\b/i, weight: 2 },
  { label: "notification", re: /\b(noreply|no-reply|do not reply|notification settings|you have a new (message|comment))\b/i, weight: 1 },
  { label: "dev/ops", re: /\b(pull request|merge request|build (failed|passed)|deploy(ment)? (failed|succeeded)|jira|github)\b/i, weight: 2 },
];

const PRODUCT_RULES: { product: InferredProduct; re: RegExp }[] = [
  { product: "mortgage", re: /\bmortgages?\b|\brefinanc\w*|\bheloc\b|\bhome equity\b|\bhome loans?\b|\bequal housing\b/i },
  { product: "credit_card", re: /\bcredit cards?\b|\bcash ?back\b|\bbalance transfer\b|\brewards card\b|\bannual fee\b|\bcard\b/i },
  { product: "personal_loan", re: /\bpersonal loans?\b|\bdebt consolidation\b|\bconsolidation loan\b|\bloans?\b/i },
];

const CHANNEL_RULES: { channel: string; re: RegExp }[] = [
  { channel: "display", re: /\b(banner|display ad|300x250|728x90|160x600|320x50|300x600|970x250)\b/i },
  { channel: "social", re: /\b(instagram|facebook|linkedin|tiktok|twitter|social post|1080x1080|1080x1920|1200x628)\b/i },
  { channel: "landing_page", re: /\b(landing page|web page|webpage|microsite)\b/i },
  { channel: "direct_mail", re: /\b(direct mail|mailer|postcard|flyer|brochure|print)\b/i },
  { channel: "sms", re: /\b(sms|text message)\b/i },
  { channel: "video", re: /\b(video|script|storyboard)\b/i },
];

const CREATIVE_MIME = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

function score(signals: Signal[], haystack: string): { total: number; labels: string[] } {
  let total = 0;
  const labels: string[] = [];
  for (const s of signals) {
    if (s.re.test(haystack)) {
      total += s.weight;
      labels.push(s.label);
    }
  }
  return { total, labels };
}

/**
 * Mail that is never an ad, whatever words it contains: bounces, calendar
 * traffic, account and security notices, receipts. A bounce of a real
 * campaign quotes the whole ad, so these must short-circuit before scoring.
 * Plain "noreply@" senders are NOT here: most real marketing mail comes from one.
 */
const SYSTEM_SENDER = /\b(mailer-daemon|postmaster|mail delivery|calendar-notification|no-reply@accounts\.google\.com|no-reply@google\.com|account-security-noreply|msa@communication\.microsoft\.com|noreply@github\.com|no-reply@dropbox\.com|drive-shares-(dm-)?noreply)\b/i;
const SYSTEM_SUBJECT = /^\s*(delivery status notification|undeliverable|mail delivery failed|returned mail|delivery failure|failure notice|accepted:|declined:|tentative:|invitation:|updated invitation:|canceled event:|cancelled event:|reminder:|welcome to (google|microsoft|your new)|verify your email|confirm your email|security alert|new sign-in|sign-in attempt|your (receipt|invoice|order|statement|password|verification code)|password reset|two-step|2-step|your account (has been|was)|shared with you|has shared|invited you to)/i;

export function classifyItem(input: ClassifyInput): ClassifyResult {
  const mime = (input.mimeType ?? "").toLowerCase();
  if (input.kind === "email") {
    const from = `${input.sender ?? ""} ${input.senderEmail ?? ""}`;
    const subject = input.title ?? "";
    if (SYSTEM_SENDER.test(from) || SYSTEM_SUBJECT.test(subject)) {
      return {
        classification: "not_marketing",
        reason: "System mail (bounce, calendar, account or receipt), not an ad",
        inferred: { product: "unknown", channel: null, confirmed: false, score: -99, marketing_signals: [], other_signals: ["system mail"] },
      };
    }
  }
  // Filenames use _ - . as separators ("cashplus_300x250.png"); make them word breaks.
  const meta = [input.title, input.filename, input.parentTitle, input.sender, input.senderEmail]
    .filter(Boolean)
    .map((s) => String(s).replace(/[_.]+/g, " "))
    .join("\n");
  // Bound the work on huge documents.
  const body = (input.text ?? "").slice(0, 60_000);
  const haystack = `${meta}\n${body}`;

  const m = score(MARKETING, haystack);
  const n = score(NOT_MARKETING, haystack);
  const product = PRODUCT_RULES.find((r) => r.re.test(haystack))?.product ?? "unknown";
  let channel = CHANNEL_RULES.find((r) => r.re.test(haystack))?.channel ?? null;
  if (!channel && (input.kind === "email" || mime === "text/html")) channel = "email";

  const inferred = (sc: number) => ({
    product,
    channel,
    confirmed: false as const,
    score: sc,
    marketing_signals: m.labels,
    other_signals: n.labels,
  });

  if (input.inlineImage) {
    return {
      classification: "inline_image",
      reason: "Small inline image (signature logo or embedded icon); not creative",
      inferred: inferred(0),
    };
  }

  const net = m.total - n.total;
  const creativeType = CREATIVE_MIME.test(mime);
  const textKnown = body.trim().length > 0;

  // Creative file types whose content we have not read yet (PDF, images).
  if (creativeType && !textKnown) {
    if (m.total >= 2 && n.total < m.total) {
      return {
        classification: "marketing",
        reason: `Creative file type (${mime}) with marketing signals in its name: ${m.labels.join(", ")}`,
        inferred: inferred(net),
      };
    }
    if (n.total >= 3 && m.total === 0) {
      return {
        classification: "not_marketing",
        reason: `Non-marketing signals in its name: ${n.labels.join(", ")}`,
        inferred: inferred(net),
      };
    }
    return {
      classification: "uncertain",
      reason: `Creative file type (${mime}); content not read yet`,
      inferred: inferred(net),
    };
  }

  if (m.total >= 5 && m.total >= 2 * n.total) {
    return {
      classification: "marketing",
      reason: `Marketing signals: ${m.labels.join(", ")}`,
      inferred: inferred(net),
    };
  }
  if (m.total === 0 && n.total > 0) {
    return {
      classification: "not_marketing",
      reason: `No offer terms, product or CTA found; non-marketing signals: ${n.labels.join(", ")}`,
      inferred: inferred(net),
    };
  }
  if (m.total === 0 && n.total === 0) {
    if (input.kind === "email") {
      return {
        classification: "not_marketing",
        reason: "No offer terms, product or CTA found",
        inferred: inferred(0),
      };
    }
    return {
      classification: "uncertain",
      reason: textKnown ? "No marketing or non-marketing signals found" : "Content not readable yet",
      inferred: inferred(0),
    };
  }
  if (n.total >= 4 && m.total <= 2) {
    return {
      classification: "not_marketing",
      reason: `Mostly non-marketing signals: ${n.labels.join(", ")}`,
      inferred: inferred(net),
    };
  }
  return {
    classification: "uncertain",
    reason: m.labels.length > 0 ? `Could be an ad: has ${plainSignals(m.labels)}` : "Could be an ad",
    inferred: inferred(net),
  };
}

/** Our own signal labels in plain words for the triage row ("a call to action, offer terms"). */
function plainSignals(labels: string[]): string {
  const words: Record<string, string> = {
    APR: "an APR",
    rate: "a rate",
    percentage: "a percentage",
    offer: "an offer",
    apply: "an apply link",
    loan: "a loan mention",
    card: "a card mention",
    mortgage: "a mortgage mention",
    terms: "terms wording",
    disclosure: "disclosure wording",
    CTA: "a call to action",
    promo: "promotional wording",
    creative: "campaign or creative words",
    "ad size": "an ad size",
  };
  const list = labels.slice(0, 3).map((l) => words[l] ?? l);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] ?? "";
}
