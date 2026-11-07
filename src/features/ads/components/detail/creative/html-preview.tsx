"use client";

import { cn } from "cn";
import { useMemo, useState } from "react";

/**
 * The HTML creative's Preview: untrusted markup rendered only inside a
 * sandboxed srcdoc iframe, behind a Content-Security-Policy injected ahead of
 * the ad's own markup, with links made inert. The app pages' own security
 * headers live in next.config.ts.
 */

/**
 * The preview frame is `sandbox=""` (no scripts, no forms, no popups, opaque
 * origin), and this policy stops every network request the markup could
 * still make: remote images (tracking pixels tell a submitter when a reviewer
 * opened the ad), stylesheets, fonts, frames, objects. Only inline styles and
 * data: images render. `<base target="_blank">` turns every link into a
 * popup, which the sandbox refuses, so nothing navigates; meta refresh is
 * removed because it would navigate the frame itself.
 */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'; connect-src 'none'">`;
const INERT_LINKS = `<base target="_blank"><style>a[target="_self"],a[target="_parent"],a[target="_top"],area{pointer-events:none}</style>`;
const HEAD_INJECT = `${CSP}${INERT_LINKS}`;

export function withCsp(html: string): string {
  const safe = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, "<!-- meta refresh removed -->");
  // The policy goes first, in a <head> we own, so it applies to everything
  // after it. The parser merges the ad's own <html>/<head> into ours
  // (duplicate start tags are ignored, their children still land in the
  // head), so looking for the ad's <head> is unnecessary and unsafe: the
  // string "<head>" inside an attribute value would have swallowed the meta.
  return `<!doctype html><html><head>${HEAD_INJECT}</head>${safe}`;
}

/** True when the markup references anything off-site that the preview will not load. */
function hasRemoteAssets(html: string): boolean {
  return /\b(src|href|srcset|poster|data)\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\(\s*["']?\s*(https?:)?\/\//i.test(html);
}

export function HtmlPreview({ html }: { html: string }) {
  const [tall, setTall] = useState(false);
  const remote = useMemo(() => hasRemoteAssets(html), [html]);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <iframe
        title="Ad preview (sandboxed)"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={withCsp(html)}
        className={cn("w-full bg-white transition-[height] duration-200 motion-reduce:transition-none", tall ? "h-[1400px]" : "h-[560px]")}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0">
          Rendered in a sandbox: no scripts, no network, no forms.
          {remote ? " Remote images and files are not loaded; the Text view has every word." : ""}
        </span>
        <button type="button" className="shrink-0 underline underline-offset-4 hover:text-foreground" onClick={() => setTall((t) => !t)}>
          {tall ? "Shorter" : "Taller"}
        </button>
      </div>
    </div>
  );
}
