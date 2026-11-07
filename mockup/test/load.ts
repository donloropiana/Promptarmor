// Shared loader: boots dist/compliance-workbench.html inside a happy-dom Window.
import { Window } from "happy-dom";
import { readFileSync } from "fs";
import { join } from "path";

export type Err = { where: string; msg: string };

export function boot(opts: { width?: number; noStorage?: boolean; preStorage?: Record<string, string> } = {}) {
  const html = readFileSync(join(import.meta.dir, "..", "dist", "compliance-workbench.html"), "utf8");
  const errors: Err[] = [];
  const warnings: Err[] = [];
  const ctx = { where: "load" };
  const window = new Window({
    url: "https://prototype.example/",
    width: opts.width || 1280,
    height: 900,
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true,
      navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
      handleDisabledFileLoadingAsSuccess: true,
    },
  });
  const w: any = window;
  const document = w.document;
  const fmt = (args: any[]) =>
    args.map((a) => (a && a.stack ? `${a.message}\n${String(a.stack).split("\n").slice(0, 5).join("\n")}` : typeof a === "object" ? (() => { try { return JSON.stringify(a).slice(0, 300); } catch { return String(a); } })() : String(a))).join(" ");
  w.console.error = (...a: any[]) => errors.push({ where: ctx.where, msg: "console.error: " + fmt(a) });
  w.console.warn = (...a: any[]) => warnings.push({ where: ctx.where, msg: "console.warn: " + fmt(a) });
  w.console.log = () => {};
  w.console.info = () => {};
  for (const name of ["alert", "confirm", "prompt", "open", "print"]) w[name] = () => errors.push({ where: ctx.where, msg: `forbidden API called: ${name}` });
  w.addEventListener("error", (e: any) => errors.push({ where: ctx.where, msg: "window error: " + (e?.error?.stack || e?.message || String(e)) }));
  const clip: string[] = [];
  try { Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { clip.push(t); } } }); } catch {}
  const realST = w.setTimeout.bind(w);
  w.setTimeout = (fn: any, ms?: number, ...rest: any[]) => realST(fn, Math.min(Number(ms) || 0, 3), ...rest);
  const realSI = w.setInterval.bind(w);
  w.setInterval = (fn: any, ms?: number, ...rest: any[]) => realSI(fn, 5, ...rest);

  if (opts.preStorage) for (const [k, v] of Object.entries(opts.preStorage)) w.localStorage.setItem(k, v);
  if (opts.noStorage) {
    for (const k of ["localStorage", "sessionStorage"]) Object.defineProperty(w, k, { configurable: true, get() { throw new w.DOMException("blocked", "SecurityError"); } });
  }
  const scriptRe = /<script>([\s\S]*?)<\/script>/g;
  const scripts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) scripts.push(m[1]);
  const markup = html.replace(scriptRe, "");
  document.write(`<!doctype html><html><head></head><body></body></html>`);
  const tmp = document.createElement("div");
  tmp.innerHTML = markup;
  for (const node of Array.from(tmp.childNodes) as any[]) {
    if (node.nodeType === 1 && ["TITLE", "META", "LINK", "STYLE"].includes(node.tagName)) document.head.appendChild(node);
    else document.body.appendChild(node);
  }
  scripts.forEach((src, i) => {
    ctx.where = `script#${i}`;
    try { w.eval(src); } catch (e: any) { errors.push({ where: ctx.where, msg: "script threw: " + (e?.stack || e) }); }
  });
  const App = w.App;

  const flush = (ms = 15) => new Promise((r) => setTimeout(r, ms));
  const $ = (s: string) => document.querySelector(s);
  const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as any[];
  async function go(hash: string) {
    ctx.where = hash;
    App.go(hash);
    await flush();
  }
  async function click(sel: string | any, label?: string) {
    const el = typeof sel === "string" ? $(sel) : sel;
    if (!el) { errors.push({ where: ctx.where, msg: `scenario: element not found: ${label || sel}` }); return false; }
    el.click();
    await flush();
    return true;
  }
  function setVal(sel: string | any, value: string) {
    const el = typeof sel === "string" ? $(sel) : sel;
    if (!el) { errors.push({ where: ctx.where, msg: `scenario: input not found: ${sel}` }); return; }
    if (el.type === "checkbox" || el.type === "radio") { el.checked = !!value; el.dispatchEvent(new w.Event("change", { bubbles: true })); return; }
    el.value = value;
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  }
  function expect(cond: any, msg: string) {
    if (!cond) errors.push({ where: ctx.where, msg: "ASSERT: " + msg });
  }
  const viewText = () => (($("#view") || {}).textContent || "").replace(/\s+/g, " ");
  return { w, window, document, App, errors, warnings, ctx, flush, $, $$, go, click, setVal, expect, viewText, clip, html };
}

export function report(name: string, errors: Err[], warnings: Err[]) {
  const dedupe = (arr: Err[]) => {
    const map = new Map<string, Err & { n: number }>();
    for (const e of arr) { const k = e.msg.split("\n")[0]; if (!map.has(k)) map.set(k, { ...e, n: 1 }); else map.get(k)!.n++; }
    return Array.from(map.values());
  };
  console.log(`\n=== ${name}: ${errors.length} errors, ${warnings.length} warnings ===`);
  for (const e of dedupe(errors)) console.log(`[${e.n}x] @ ${e.where}\n   ${e.msg.split("\n").slice(0, 5).join("\n   ")}`);
  for (const e of dedupe(warnings).slice(0, 30)) console.log(`(warn ${e.n}x) @ ${e.where}\n   ${e.msg.split("\n")[0].slice(0, 240)}`);
}
