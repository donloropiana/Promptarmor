import { decodeEntities } from "@/features/connections/content";

import type { HiddenTextCandidate } from "./schema";

/**
 * Deterministic detection of hidden text and instruction-like text in ads.
 *
 * Two inputs: the raw HTML (styling tricks: tiny fonts, white-on-white,
 * opacity 0, display none, off-screen, clip-path, collapsed letter-spacing,
 * aria-hidden, stylesheet classes, comments, attributes, data: URIs, SVG
 * fills) and the plain text (prompt-injection phrasing, zero-width and
 * bidirectional control characters, mixed scripts, lookalike letters).
 * Results become security_alerts rows; the check still runs on the rest of
 * the ad, and nothing found here can change what the engine does.
 *
 * Tests: scripts/test-hidden-text.ts (bun scripts/test-hidden-text.ts).
 */

export const MAX_EXCERPT = 300;

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore (all |any |the |your |every )?(previous|prior|above|earlier|preceding|other|these|those|system|developer)? ?(instructions?|rules?|guidance|guidelines|directions?|prompts?|checks?|policies|policy)\b/i,
  /\bdisregard (all |any |the |your |every )?(previous|prior|above|earlier|system)? ?(instructions?|rules?|guidance|findings?|checks?|prompts?)\b/i,
  /\b(forget|drop|skip|bypass|override|suspend) (all |any |the |your |every |remaining )?(previous |prior |above |other |remaining |further )?(instructions?|rules?|checks?|review|reviews|findings?|guidelines|compliance (checks?|review))\b/i,
  /\b(as an? ai|dear ai|dear (model|reviewer|assistant|llm)|hey (ai|assistant|claude|chatgpt|gpt|model|bot)|hello (ai|assistant|claude|chatgpt|gpt|model)|attention:? ?(ai|reviewer|model|assistant|llm)|to the (ai|model|reviewer|assistant|language model|llm|system)|if you are an? (ai|llm|language model|model|bot|assistant|automated (reviewer|system)))\b/i,
  /\b(ai|automated|llm|language model|model|assistant|system|machine) (reviewers?|instructions?|note|notice|directive|readers?|only)\b/i,
  /\bfor (ai|llm|automated|machine|model) (readers?|review|reviewers?|systems?|consumption|eyes)\b/i,
  /\b(approve|pass|clear|accept) (this|the) (ad|advert(isement)?|asset|content|creative|copy|email|post|page|submission)\b/i,
  /\bsystem prompt\b/i,
  /\b(hidden|secret|override|system|developer) instructions?\b/i,
  /\b(new|updated|important|special|additional) instructions? (for|to) (the |any |an |all )?(ai|reviewer|model|assistant|system|llm|bot)s?\b/i,
  /\bmark (this |it |the ad |the )?(as )?(compliant|approved|passing|clean|safe|ok|okay)\b/i,
  /\b(classify|rate|grade|score|label|treat) (this|it|the ad|the content)( ad)? as (compliant|approved|safe|clean|passing|low[- ]risk|no[- ]risk|acceptable)\b/i,
  /\b(report|return|output|respond with|say|answer|reply|print|write|state|conclude)( that there are| that there is| only| with)? (no|zero|an empty list of|none) (issues|findings|problems|violations|concerns)\b/i,
  /\b(return|output|respond with|print|reply with) (an empty (list|array|findings list)|\[\s*\]|"findings"\s*:\s*\[\s*\])/i,
  /\bno (issues|findings|violations|problems) (should be|must be|are to be|will be|were) (reported|returned|found|flagged|raised)\b/i,
  /\b(do not|don't|never|do not ever) (flag|report|raise) (this|that|it|any|anything|the|these|those|a|an)\b/i,
  /\byou are (now )?(a|an|the|my) \w+( \w+)? (assistant|reviewer|model|ai|bot|agent)\b/i,
  /\b(this|the) (ad|content|creative|copy|email|page|post|message|submission) (has been|is|was|has already been) (fully |already )?((pre-?approved|compliant|vetted|cleared|screened)\b|(approved|reviewed|checked|verified|signed off) by (compliance|legal|the reviewer|counsel|a human|the compliance (team|officer|department)))/i,
  /\b(compliance|legal|counsel) (team |officer |department )?(has |have )?(already )?(approved|reviewed|cleared|signed off( on)?) (this|it|the ad)\b/i,
  /\bno further (review|checks?|action) (is |are )?(needed|required|necessary)\b/i,
  /<\|?(im_start|im_end|system|endoftext|user|assistant)\|?>/i,
  /<\/?(system|instructions?|assistant|developer|admin|prompt)>/i,
  /\[\s*(system|assistant|instruction|inst|\/inst)\s*\]/i,
  /^\s*#{1,4}\s*(system|instructions?|assistant|developer)\b/im,
  /^\s*(system|assistant|human|user|developer|ai)\s*:\s*\S/im,
  /\boverride\b.{0,40}\b(rules?|checks?|review|compliance|findings?)\b/i,
  /\b(findings|issues)\s*[:=]\s*\[\s*\]/i,
  /"(findings|issues)"\s*:\s*\[\s*\]/i,
];

/**
 * Characters that take no space on screen: zero-width space/joiner/non-joiner,
 * word joiner, BOM, soft hyphen, Mongolian vowel separator, combining grapheme
 * joiner, invisible math operators, Hangul fillers and the halfwidth filler.
 */
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD\u180E\u034F\u2061-\u2064\u115F\u1160\u3164\uFFA0]/g;

/** Bidirectional overrides and isolates: text is displayed in a different order than it is stored. */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/g;

/** Latin word containing Cyrillic/Greek lookalikes, or the reverse. */
const MIXED_SCRIPT_RE = /\b(?=[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]*[\p{Script=Cyrillic}\p{Script=Greek}])(?=[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]*\p{Script=Latin})[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]{3,}\b/gu;

function clipExcerpt(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_EXCERPT ? `${t.slice(0, MAX_EXCERPT - 1)}…` : t;
}

/**
 * Normalises text the way a person reads it: zero-width characters removed,
 * compatibility forms (fullwidth, mathematical bold, circled letters) folded
 * to plain letters, so "i​g​n​o​r​e" and "ＩＧＮＯＲＥ" match the patterns.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ɡ: "g", ո: "n", ԛ: "q", ԝ: "w", ѵ: "v",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", І: "I", Ј: "J", Ѕ: "S",
  α: "a", ο: "o", ε: "e", ι: "i", κ: "k", ν: "v", τ: "t", υ: "u", ρ: "p", χ: "x", Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

export function foldForMatching(text: string): string {
  return text
    .replace(ZERO_WIDTH_RE, "")
    .replace(BIDI_CONTROL_RE, "")
    .normalize("NFKC")
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c);
}

export function looksLikeInstruction(text: string): boolean {
  if (INSTRUCTION_PATTERNS.some((re) => re.test(text))) return true;
  const folded = foldForMatching(text);
  return folded !== text && INSTRUCTION_PATTERNS.some((re) => re.test(folded));
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const HIDDEN_STYLE_CHECKS: { label: string; re: RegExp }[] = [
  { label: "font-size 0-4px", re: /font-size\s*:\s*(0|0?\.\d+|[1-4])(\.\d+)?\s*(px|pt)?\s*(;|$|!)/i },
  { label: "font-size near zero", re: /font-size\s*:\s*(0?\.(0|1|2)\d*\s*(em|rem)|(0|[1-9]|1\d)(\.\d+)?\s*%)\s*(;|$|!)/i },
  { label: "opacity near 0", re: /(^|[^-\w])opacity\s*:\s*(0|0?\.0\d*)\s*(;|$|!)/i },
  { label: "filter opacity 0", re: /filter\s*:[^;]*opacity\s*\(\s*(0|0?\.0\d*)\s*%?\s*\)/i },
  { label: "display none", re: /display\s*:\s*none\b/i },
  { label: "visibility hidden", re: /visibility\s*:\s*(hidden|collapse)\b/i },
  { label: "mso-hide", re: /mso-hide\s*:\s*all\b/i },
  { label: "off-screen", re: /(left|top|right|bottom|text-indent|margin-left|margin-top)\s*:\s*-\s*(9{3,}|[1-9]\d{3,})\s*(px|em|rem|%|vw|vh)/i },
  { label: "off-screen transform", re: /transform\s*:[^;]*translate(x|y|3d)?\s*\(\s*-?\s*(9{3,}|[1-9]\d{3,})\s*(px|em|rem|%|vw|vh)/i },
  { label: "scaled to nothing", re: /transform\s*:[^;]*scale(x|y|3d)?\s*\(\s*0(\.0+)?\s*(,|\))/i },
  { label: "zero size", re: /(^|[^-\w])(height|width|max-height|max-width)\s*:\s*0\s*(px|em|rem|%)?\s*(;|$|!)/i },
  { label: "clip", re: /(^|[^-\w])clip\s*:\s*rect\s*\(\s*(0|1px)/i },
  { label: "clip-path", re: /clip-path\s*:\s*(inset\s*\(\s*(100%|50%|[5-9]\d%)|circle\s*\(\s*0|polygon\s*\(\s*0\s*0\s*,\s*0\s*0|rect\s*\(\s*0\s*0\s*0\s*0)/i },
  { label: "letter-spacing collapsed", re: /letter-spacing\s*:\s*-\s*(0?\.[5-9]\d*\s*(em|rem)|[1-9]\d*(\.\d+)?\s*(em|rem)|([3-9]|\d{2,})(\.\d+)?\s*px|\d{2,}\s*%)/i },
  { label: "color transparent", re: /(^|[^-\w])color\s*:\s*transparent\b/i },
  { label: "color alpha 0", re: /(^|[^-\w])color\s*:\s*(rgba|hsla)\([^)]*,\s*(0|0?\.0\d*)\s*\)/i },
  { label: "color alpha 0", re: /(^|[^-\w])color\s*:\s*(rgb|hsl)\([^)]*\/\s*(0|0?\.0\d*|[0-9]%)\s*\)/i },
  { label: "color alpha 0", re: /(^|[^-\w])color\s*:\s*#([0-9a-f]{6}00|[0-9a-f]{3}0)\b/i },
];

const WHITE_COLOR_RE =
  /(^|[^-\w])color\s*:\s*(#fff(fff)?|white|rgb\(\s*25[0-5]\s*,\s*25[0-5]\s*,\s*25[0-5]\s*\)|hsl\(\s*\d+\s*,\s*\d+%\s*,\s*(9[5-9]|100)%\s*\)|#f[8-9a-f]f[8-9a-f]f[8-9a-f])(?![\w-])/i;
const DARK_BACKGROUND_RE =
  /background(-color)?\s*:\s*(#(0|1|2|3|4|5)[0-9a-f]{2,5}\b|black|rgb\(\s*(\d|[1-9]\d)\s*,\s*(\d|[1-9]\d)\s*,\s*(\d|[1-9]\d)\s*\)|#[0-5][0-9a-f]{2}\b|(dark|navy|maroon|indigo|purple|brown|slate)\w*|linear-gradient|url\()/i;

function styleHiddenReason(style: string, options: { strongOnly?: boolean } = {}): string | null {
  if (!style) return null;
  for (const c of HIDDEN_STYLE_CHECKS) if (c.re.test(style)) return c.label;
  // White text depends on the background, which a stylesheet rule cannot see: inline styles only.
  if (!options.strongOnly && WHITE_COLOR_RE.test(style) && !DARK_BACKGROUND_RE.test(style)) return "white text";
  return null;
}

/** Legacy presentational attributes (common in email HTML): <font color="#ffffff">, <td bgcolor>, <text fill="none">. */
function attrHiddenReason(attrs: string): string | null {
  if (/(^|\s)hidden(?=\s|=|$)(?!\s*=\s*["']?false)/i.test(attrs)) return "hidden attribute";
  if (/(^|\s)aria-hidden\s*=\s*["']?true/i.test(attrs)) return "aria-hidden";
  if (/(^|\s)fill\s*=\s*["']?(none|transparent)(?=["'\s]|$)/i.test(attrs) && !/(^|\s)stroke\s*=\s*["']?(?!none|transparent)[#\w]/i.test(attrs)) return "svg fill none";
  if (/(^|\s)(fill-opacity|opacity)\s*=\s*["']?(0|0?\.0\d*)(?=["'\s]|$)/i.test(attrs)) return "svg opacity 0";
  if (/(^|\s)font-size\s*=\s*["']?(0|0?\.\d+|[1-4])(\.\d+)?(px|pt)?(?=["'\s]|$)/i.test(attrs)) return "svg font-size 0";
  if (/(^|\s)visibility\s*=\s*["']?hidden/i.test(attrs) || /(^|\s)display\s*=\s*["']?none/i.test(attrs)) return "svg hidden";
  if (/(^|\s)(width|height)\s*=\s*["']?0(?=["'\s]|$)/i.test(attrs)) return "zero size";
  const color = /(^|\s)color\s*=\s*["']?(#fff(fff)?|white|#f[8-9a-f]f[8-9a-f]f[8-9a-f])(?![\w-])/i.exec(attrs);
  if (color && !/(^|\s)bgcolor\s*=\s*["']?(#[0-5]|black|dark)/i.test(attrs)) return "white text";
  return null;
}

/** A dark background or bgcolor shortly before the element (a parent cell or wrapper): white text there is readable. */
const DARK_CONTEXT_RE = /(bgcolor\s*=\s*["']?(#[0-5]|black|dark)|background(-color)?\s*:\s*(#[0-5]|black|dark|rgb\(\s*(\d|[1-9]\d)\s*,)|linear-gradient|url\()/i;

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const TAG_NAMES =
  "span|div|p|font|small|b|i|em|strong|u|s|td|th|tr|table|li|ul|ol|dl|dt|dd|section|footer|header|nav|aside|article|main|figure|figcaption|blockquote|center|a|h[1-6]|sup|sub|label|pre|code|tt|big|mark|del|ins|abbr|cite|q|summary|details|text|tspan|textPath|svg|g|title|desc|template|noscript";
/** Opening tags only: every element is visited, including ones nested inside a wrapper that is itself visible. */
const OPEN_TAG_RE = new RegExp(`<(${TAG_NAMES})\\b([^>]*)>`, "gi");

/** Longest HTML scanned for hidden elements (characters). */
const MAX_HTML_SCAN = 400_000;

/**
 * The content of the element whose opening tag ends at `from`, honouring
 * nesting of the same tag name. Returns "" for an unclosed element.
 */
function innerOf(html: string, tagName: string, from: number): string {
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) return html.slice(from, m.index);
    } else if (!/\/\s*>$/.test(m[0])) {
      depth++;
    }
    if (m.index - from > 60_000) break;
  }
  return "";
}

/** Tags whose content is never shown to a reader, whatever the styling. */
const NEVER_RENDERED_TAGS = new Set(["template", "desc"]);
/** Tags a reader may or may not see (tooltip, no-JS fallback): only an instruction is suspicious. */
const INSTRUCTION_ONLY_TAGS = new Set(["title", "noscript"]);

/**
 * Class names and ids hidden by a <style> block (outside @media, which is
 * responsive hiding, not concealment), so <p class="hide"> is caught.
 */
function hiddenSelectorsFromStyles(html: string): { classes: Set<string>; ids: Set<string> } {
  const classes = new Set<string>();
  const ids = new Set<string>();
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    // Drop @media / @supports blocks (one level of nesting is enough for email CSS).
    const css = m[1].replace(/@(media|supports)[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/gi, " ");
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = rule[1].trim();
      const declarations = rule[2];
      if (!styleHiddenReason(declarations, { strongOnly: true })) continue;
      // Pseudo-states (:hover) and attribute selectors are not "always hidden".
      if (/:(hover|focus|active|checked|visited)/i.test(selector)) continue;
      for (const c of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(c[1].toLowerCase());
      for (const i of selector.matchAll(/#([A-Za-z_][\w-]*)/g)) ids.add(i[1].toLowerCase());
    }
  }
  return { classes, ids };
}

function elementMatchesHiddenSelector(attrs: string, hidden: { classes: Set<string>; ids: Set<string> }): boolean {
  if (hidden.classes.size === 0 && hidden.ids.size === 0) return false;
  const cls = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const classList = (cls?.[2] ?? cls?.[3] ?? cls?.[4] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (classList.some((c) => hidden.classes.has(c))) return true;
  const id = /\bid\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const idValue = (id?.[2] ?? id?.[3] ?? id?.[4] ?? "").toLowerCase();
  return Boolean(idValue) && hidden.ids.has(idValue);
}

/** Decodes base64 data: URIs with a text media type (the only kind that can hide readable instructions). */
function decodeDataUri(uri: string): string | null {
  const m = /^data:(text\/[\w.+-]+|application\/(json|xml|xhtml\+xml))?(;[^,]*)?,([\s\S]*)$/i.exec(uri.trim());
  if (!m) return null;
  const isBase64 = /;base64/i.test(m[3] ?? "");
  try {
    const payload = m[4];
    if (isBase64) return Buffer.from(payload.replace(/\s+/g, ""), "base64").toString("utf8").slice(0, 20_000);
    return decodeURIComponent(payload).slice(0, 20_000);
  } catch {
    return null;
  }
}

/**
 * Hidden passages in HTML creative. Nested elements with the same tag can
 * truncate the inner match; the excerpt is still the hidden element's text.
 */
export function detectHiddenHtml(html: string): HiddenTextCandidate[] {
  const out: HiddenTextCandidate[] = [];
  if (!html) return out;

  const hiddenSelectors = hiddenSelectorsFromStyles(html);

  // Elements styled to be invisible or unreadable.
  const scanned = html.length > MAX_HTML_SCAN ? html.slice(0, MAX_HTML_SCAN) : html;
  for (const m of scanned.matchAll(OPEN_TAG_RE)) {
    const [open, tag, attrs] = m;
    const at = m.index ?? 0;
    const tagName = tag.toLowerCase();
    if (/\/\s*$/.test(attrs)) continue; // self-closing
    const style = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const styleText = style ? (style[2] ?? style[3] ?? "") : "";
    const reason = NEVER_RENDERED_TAGS.has(tagName)
      ? `<${tagName}> is never displayed`
      : INSTRUCTION_ONLY_TAGS.has(tagName)
        ? `<${tagName}> is not part of the visible ad`
        : (attrHiddenReason(attrs) ?? styleHiddenReason(styleText) ?? (elementMatchesHiddenSelector(attrs, hiddenSelectors) ? "hidden by stylesheet class" : null));
    if (!reason) continue;
    const text = stripTags(innerOf(scanned, tagName, at + open.length));
    if (text.length < 4) continue;
    if (INSTRUCTION_ONLY_TAGS.has(tagName) && !looksLikeInstruction(text)) continue;
    // White text inside a dark cell or wrapper is readable; look a little way back for the background.
    if (reason === "white text" && DARK_CONTEXT_RE.test(html.slice(Math.max(0, at - 1_200), at))) continue;
    // An email preheader (hidden preview line) with ordinary copy is not hidden text.
    if (/preheader|pre-header|preview-text|previewtext/i.test(attrs) && !looksLikeInstruction(text)) continue;
    out.push({
      excerpt: clipExcerpt(text),
      location: `html:${tagName}@char ${at} (${reason})`,
      kind: looksLikeInstruction(text) ? "possible_injection" : "hidden_text",
    });
    if (out.length >= 50) break;
  }

  // HTML comments that read like instructions.
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (text.length < 8) continue;
    if (looksLikeInstruction(text)) {
      out.push({ excerpt: clipExcerpt(text), location: `html:comment@char ${m.index ?? 0}`, kind: "possible_injection" });
    }
  }

  // Attributes a reader never sees: alt, title, aria-label, data-*, placeholder,
  // hidden input values, meta content.
  for (const m of html.matchAll(/\b(alt|title|aria-label|aria-description|data-[\w-]+|placeholder|value|content|label)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const text = decodeEntities(m[3] ?? m[4] ?? "");
    if (looksLikeInstruction(text)) {
      out.push({ excerpt: clipExcerpt(text), location: `html:${m[1].toLowerCase()}@char ${m.index ?? 0}`, kind: "possible_injection" });
    }
  }

  // data: URIs carrying text (href / src / srcdoc): decode and scan.
  for (const m of html.matchAll(/\b(href|src|srcdoc|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const raw = decodeEntities(m[3] ?? m[4] ?? "");
    if (!/^\s*data:/i.test(raw)) continue;
    const decoded = decodeDataUri(raw);
    if (!decoded) continue;
    const text = stripTags(decoded);
    if (looksLikeInstruction(text)) {
      out.push({ excerpt: clipExcerpt(text), location: `html:${m[1].toLowerCase()} data: URI@char ${m.index ?? 0}`, kind: "possible_injection" });
    } else if (text.length >= 8) {
      out.push({ excerpt: clipExcerpt(`Text inside a data: URI: ${text}`), location: `html:${m[1].toLowerCase()} data: URI@char ${m.index ?? 0}`, kind: "hidden_text" });
    }
  }

  // <head> content (title, meta) is not part of the creative a reader sees.
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html);
  if (head) {
    const text = stripTags(head[1].replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " "));
    if (looksLikeInstruction(text)) {
      out.push({ excerpt: clipExcerpt(text), location: `html:head@char ${head.index ?? 0}`, kind: "possible_injection" });
    }
  }

  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/** Instruction-like passages, zero-width characters, bidi controls and mixed scripts in plain text. */
export function detectHiddenInText(text: string): HiddenTextCandidate[] {
  const out: HiddenTextCandidate[] = [];
  if (!text) return out;

  // Instruction-like sentences: scan paragraph by paragraph, then sentence by sentence.
  let offset = 0;
  for (const para of text.split(/\n\s*\n/)) {
    const paraStart = text.indexOf(para, offset);
    offset = paraStart + para.length;
    const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z("'“])/);
    let sentOffset = paraStart;
    for (const sentence of sentences) {
      const at = text.indexOf(sentence, sentOffset);
      sentOffset = at + sentence.length;
      if (looksLikeInstruction(sentence)) {
        const folded = foldForMatching(sentence);
        out.push({
          excerpt: clipExcerpt(folded),
          location: `text:line ${lineOf(text, at)}${folded !== sentence ? " (lookalike or invisible characters removed)" : ""}`,
          kind: "possible_injection",
        });
      }
    }
  }

  // Zero-width characters (used to hide words or break pattern matching).
  const zw = text.match(ZERO_WIDTH_RE);
  if (zw && zw.length >= 3) {
    const first = text.search(ZERO_WIDTH_RE);
    const around = text.slice(Math.max(0, first - 60), first + 120).replace(ZERO_WIDTH_RE, "");
    out.push({
      excerpt: clipExcerpt(`${zw.length} zero-width characters near: ${around}`),
      location: `text:line ${lineOf(text, first)}`,
      kind: "hidden_text",
    });
  }

  // Bidirectional controls: what is displayed is not what is stored.
  const bidi = text.match(BIDI_CONTROL_RE);
  if (bidi && bidi.length > 0) {
    const first = text.search(BIDI_CONTROL_RE);
    const around = text.slice(Math.max(0, first - 60), first + 120).replace(BIDI_CONTROL_RE, "");
    out.push({
      excerpt: clipExcerpt(`${bidi.length} right-to-left control character${bidi.length === 1 ? "" : "s"} near: ${around}`),
      location: `text:line ${lineOf(text, first)}`,
      kind: "hidden_text",
    });
  }

  // Mixed-script words (Latin with Cyrillic/Greek lookalikes).
  const mixed = Array.from(text.matchAll(MIXED_SCRIPT_RE)).map((m) => m[0]);
  if (mixed.length > 0) {
    const first = text.search(MIXED_SCRIPT_RE);
    out.push({
      excerpt: clipExcerpt(`Lookalike characters in: ${Array.from(new Set(mixed)).slice(0, 8).join(", ")}`),
      location: `text:line ${lineOf(text, Math.max(0, first))}`,
      kind: "hidden_text",
    });
  }

  return dedupe(out);
}

export function detectHiddenText(input: { html?: string | null; text?: string | null }): HiddenTextCandidate[] {
  return dedupe([...detectHiddenHtml(input.html ?? ""), ...detectHiddenInText(input.text ?? "")]);
}

function dedupe(items: HiddenTextCandidate[]): HiddenTextCandidate[] {
  const seen = new Set<string>();
  const out: HiddenTextCandidate[] = [];
  for (const it of items) {
    const key = it.excerpt.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plain English for a location
// ---------------------------------------------------------------------------

const REASON_WORDS: Record<string, string> = {
  "font-size 0-4px": "a 0–4 px font",
  "font-size near zero": "a near-zero font size",
  "opacity near 0": "near-zero opacity",
  "filter opacity 0": "a zero-opacity filter",
  "display none": "display: none",
  "visibility hidden": "visibility: hidden",
  "mso-hide": "an Outlook-only hide",
  "off-screen": "an off-screen position",
  "off-screen transform": "an off-screen transform",
  "scaled to nothing": "a zero scale",
  "white text": "white-on-white text",
  "hidden attribute": "the hidden attribute",
  "aria-hidden": "aria-hidden",
  "svg fill none": "an invisible SVG fill",
  "svg opacity 0": "zero SVG opacity",
  "svg font-size 0": "a zero SVG font size",
  "svg hidden": "a hidden SVG",
  "zero size": "a zero-size box",
  "hidden by stylesheet class": "a stylesheet class that hides it",
};

/**
 * The stored location ("html:span@char 788 (font-size 0-4px)", "text:line 12")
 * is a developer's locator. This is what a reviewer reads instead:
 * "in a <span>, hidden by a 0–4 px font".
 */
export function describeLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const html = location.match(/^html:(\S+?)(?: data: URI)?@char \d+(?: \((.+)\))?$/);
  if (html) {
    const tag = html[1];
    const inDataUri = / data: URI@/.test(location);
    const reason = html[2];
    const where = tag === "comment" ? "in an HTML comment" : tag === "head" ? "in the page head, outside the visible ad" : inDataUri ? `inside a data: URI in a <${tag}>` : `in a <${tag}>`;
    if (!reason) return where;
    const plain = REASON_WORDS[reason] ?? reason;
    if (/is not part of the visible ad$/.test(reason)) return `${where}, which is not part of the visible ad`;
    return `${where}, hidden by ${plain}`;
  }
  const text = location.match(/^text:line (\d+)(?: \((.+)\))?$/);
  if (text) return `on line ${text[1]}${text[2] ? ` (${text[2]})` : ""}`;
  return location;
}
