"use client";

import { Inbox, Keyboard, Sparkles } from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { AnimatedUl } from "@/components/ui/animated-list";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { AdListRow, SkippedRow, TriageRow } from "@/lib/data/ads";

import { AdRow } from "./ad-row";
import { AutoRefresh } from "./auto-refresh";
import { LIST_CAP, TABS, type Tab } from "./format";
import { LIST_SHORTCUTS, ShortcutsDialog, isTypingTarget } from "./shortcuts-dialog";
import { SkippedLine, TriageRows } from "./triage-rows";

const EMPTY_COPY: Record<Tab, { title: string; body: string }> = {
  needs_review: { title: "Nothing needs review", body: "New ads appear here the moment they arrive or are dropped in." },
  changes_requested: { title: "No changes requested", body: "Ads you send back for fixes wait here until a revision comes in." },
  approved: { title: "Nothing approved yet", body: "Approved ads keep their exact approved version, who approved it and when." },
  all: { title: "No ads yet", body: "Drop a file above to check one." },
};

export function AdsList({
  rows,
  counts,
  tab,
  anyChecking,
  triage,
  skipped,
  now,
  truncated = false,
}: {
  rows: AdListRow[];
  counts: Record<Tab, number>;
  tab: Tab;
  anyChecking: boolean;
  triage: TriageRow[];
  skipped: SkippedRow[];
  /** Server render time, so relative ages match the data. */
  now: number;
  /** The workspace has more ads than one read loads (the oldest are left out). */
  truncated?: boolean;
}) {
  const router = useRouter();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // On a phone the tab strip scrolls sideways: keep the current tab in view
  // (only the strip's own scroll moves, never the page).
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !el) return;
    const left = el.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + el.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, left - 8);
  }, [tab]);

  // Real ads first (worst first), then samples under their own heading so
  // they are never mistaken for work and never count.
  const { real, samples } = useMemo(() => {
    let list = tab === "all" ? rows : rows.filter((r) => r.tab === tab);
    if (tab === "approved") list = [...list].sort((a, b) => (b.approvedAt ?? b.updatedAt).localeCompare(a.approvedAt ?? a.updatedAt));
    if (tab === "changes_requested") list = [...list].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    return { real: list.filter((r) => !r.isSample), samples: list.filter((r) => r.isSample) };
  }, [rows, tab]);
  const visible = real.length + samples.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e)) return;
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }
      if (e.key !== "j" && e.key !== "k" && e.key !== "Enter") return;
      const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-ad-row]") ?? []);
      if (links.length === 0) return;
      const idx = links.findIndex((el) => el === document.activeElement);
      if (e.key === "Enter") {
        if (idx >= 0) {
          e.preventDefault();
          router.push(links[idx].getAttribute("href") ?? "/ads");
        }
        return;
      }
      e.preventDefault();
      const next = e.key === "j" ? Math.min(links.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      links[next]?.focus();
      links[next]?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="space-y-3">
      <AutoRefresh active={anyChecking} />
      <div className="flex items-center justify-between gap-2">
        <nav ref={navRef} aria-label="Ad status" className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 py-0.5">
          {TABS.map((t) => {
            const active = t.key === tab;
            const n = counts[t.key];
            return (
              <Link
                key={t.key}
                href={t.key === "needs_review" ? "/ads" : `/ads?tab=${t.key}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("tabular-nums", active ? "text-foreground/70" : "text-muted-foreground/80")}>{n.toLocaleString("en-US")}</span>
              </Link>
            );
          })}
        </nav>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} className="hidden sm:inline-flex">
          <Keyboard />
        </Button>
      </div>

      {tab === "needs_review" && <TriageRows items={triage} now={now} />}

      {visible === 0 ? (
        <Empty className="rounded-xl border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>{EMPTY_COPY[tab].title}</EmptyTitle>
            <EmptyDescription>{EMPTY_COPY[tab].body}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div ref={listRef} className="space-y-3">
          {real.length > 0 && (
            <AnimatedUl className="divide-y rounded-xl border bg-card" aria-label={`${TABS.find((t) => t.key === tab)?.label} ads`}>
              {real.map((row) => (
                <AdRow key={row.id} row={row} now={now} />
              ))}
            </AnimatedUl>
          )}
          {samples.length > 0 && (
            <section aria-labelledby="samples-heading">
              <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Sparkles aria-hidden className="size-3.5" />
                <h2 id="samples-heading" className="font-medium">
                  Samples
                </h2>
                <span>· not counted · clear them in Workspace settings</span>
              </div>
              <ul className="divide-y rounded-xl border border-dashed bg-card" aria-label="Sample ads">
                {samples.map((row) => (
                  <AdRow key={row.id} row={row} now={now} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === "needs_review" && <SkippedLine items={skipped} now={now} />}
      {truncated && (
        <p className="px-1 text-xs text-muted-foreground" role="note">
          Showing the newest {LIST_CAP.toLocaleString("en-US")} ads. Older ones still open from their links and from the audit export.
        </p>
      )}

      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} shortcuts={LIST_SHORTCUTS} />
    </div>
  );
}
