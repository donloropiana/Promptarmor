#!/usr/bin/env python3
"""Inline the modular prototype into one HTML file.

Order: src/index.html, then <script> blocks for src/data.js, src/core.js,
src/screens/*.js (alphabetical), src/boot.js.
Output: dist/compliance-workbench.html (no doctype/html/head/body tags; the host wraps the page).

Usage:
  python3 build.py            build and print lint warnings
  python3 build.py --strict   exit 1 if any error-level lint finding remains
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "compliance-workbench.html"
MAX_BYTES = 16 * 1024 * 1024

ALLOWED_URL_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com", "www.w3.org")


def script_files():
    files = [SRC / "data.js", SRC / "core.js"]
    files += sorted((SRC / "screens").glob("*.js"), key=lambda p: p.name)
    files.append(SRC / "boot.js")
    return files


def safe_inline_js(js: str) -> str:
    # A literal "</script" or "<!--" inside a script block can end or confuse the block.
    js = re.sub(r"</(script)", r"<\\/\1", js, flags=re.IGNORECASE)
    js = js.replace("<!--", "<\\!--")
    return js


def lint(sources):
    """Return (errors, warnings) as lists of strings. sources: list of (name, text)."""
    errors, warnings = [], []

    def scan(pattern, message, level, flags=0, names=None):
        rx = re.compile(pattern, flags)
        for name, text in sources:
            if names and name not in names:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                    continue
                if rx.search(line):
                    (errors if level == "error" else warnings).append(f"{name}:{i}: {message}: {stripped[:140]}")

    # Page contract
    scan(r"<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|</body>|</html>", "document wrapper tag (host wraps the page)", "error", re.I)
    scan(r"(?<![\w.$])(alert|confirm|prompt)\s*\(", "native alert/confirm/prompt", "error")
    scan(r"window\.(alert|confirm|prompt|open|print)\s*\(", "forbidden window API", "error")
    scan(r"\bdownload\s*=|\.download\s*=", "download link/attribute (use an export dialog)", "error")
    scan(r"<iframe", "iframe", "error", re.I)
    scan(r"""(?:src|href)\s*=\s*\\?["']\s*#/""", "hash route with '#/' (use plain names like #queue)", "error")
    scan(r"""["'`]#/""", "hash route with '#/'", "error")
    scan(r"""["'`]#(settings|sidebar|customize|upgrade|downloads|comment-)""", "reserved hash name", "error")
    scan(r"""["'`]#[A-Za-z0-9-]*[?=]""", "hash route with '?' or '='", "error")
    scan(r"""(?:src\s*=\s*\\?["']|url\(\s*["']?)https?://""", "external resource load", "error", re.I)
    scan(r"@import\s", "CSS @import (external resource)", "error")
    scan(r"\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(", "network call", "error")
    scan(r"\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b", "network call", "error")
    scan(r"\b(localStorage|sessionStorage)\b", "storage access (must be inside try/catch)", "warning",
         names=[n for n, _ in sources if n != "core.js"])

    # Email scope (Max, decision 12): the app never sends email beyond auth emails, and only reads connected mailboxes.
    scan(r"\bResend\b(?!\s+(invite|invites|code|link|the\s+invite|sign-in))", "email-scope: Resend (product) is out of scope", "warning")
    scan(r"reply[-_ ]?to", "email-scope: reply-to is out of scope", "warning", re.I)
    scan(r"forwarding\s+address|inbound\s+address|intake\+", "email-scope: forwarding/inbound address is out of scope", "warning", re.I)
    scan(r"submitter[\s_-]?portal|submitter\s+link|one-time\s+code\s+for\s+submitter", "email-scope: submitter portal is out of scope", "warning", re.I)
    scan(r"sending\s+domain|email\s+notification|notify\s+by\s+email|send\s+email|email\s+the\s+submitter", "email-scope: outbound email is out of scope", "warning", re.I)

    # External URLs that are not resources: report for review (e.g. citation links should be plain text).
    url_rx = re.compile(r"https?://([A-Za-z0-9.-]+)")
    for name, text in sources:
        for i, line in enumerate(text.splitlines(), 1):
            for m in url_rx.finditer(line):
                host = m.group(1).lower()
                if host.endswith(".example") or host in ALLOWED_URL_HOSTS:
                    continue
                warnings.append(f"{name}:{i}: non-.example URL (render as plain text, never load it): {m.group(0)}")
    return errors, warnings


def main():
    strict = "--strict" in sys.argv
    index_path = SRC / "index.html"
    if not index_path.exists():
        print(f"missing {index_path}", file=sys.stderr)
        return 1
    index = index_path.read_text("utf-8")
    sources = [("index.html", index)]
    parts = [index.rstrip() + "\n"]
    missing = []
    for path in script_files():
        if not path.exists():
            missing.append(str(path.relative_to(ROOT)))
            continue
        js = path.read_text("utf-8")
        rel = str(path.relative_to(SRC))
        sources.append((rel if rel != "core.js" else "core.js", js))
        parts.append(f"<script>\n/* ---- {rel} ---- */\n{safe_inline_js(js).rstrip()}\n</script>\n")
    html = "".join(parts)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, "utf-8")
    size = len(html.encode("utf-8"))

    errors, warnings = lint(sources)
    print(f"wrote {OUT} ({size / 1024:.1f} KB, {len(parts) - 1} script blocks)")
    if missing:
        print("missing (skipped): " + ", ".join(missing))
    if size > MAX_BYTES:
        errors.append(f"output is {size} bytes, over the 16 MB limit")
    for e in errors:
        print("ERROR   " + e)
    for w in warnings:
        print("warning " + w)
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if (strict and errors) else 0


if __name__ == "__main__":
    sys.exit(main())
