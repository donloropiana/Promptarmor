"use client";

import { ChevronDown, ChevronRight, HardDrive, Mail, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { triageSourceItem } from "@/lib/actions/ads";
import type { SkippedRow, TriageRow } from "@/lib/data/ads";

import { channelLabel, productLabel, providerName, relativeTime } from "./format";

/**
 * Things that arrived from a connected inbox or drive and look like ads.
 * No gate: click a row and it opens as an ad (the check starts); the trash
 * can drops it. Visible only to the member whose account it came from.
 */
export function TriageRows({ items, now }: { items: TriageRow[]; now: number }) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y rounded-xl border bg-card" aria-label="Arrived from your inbox and drive">
      {items.map((t) => (
        <TriageItem key={t.id} item={t} now={now} />
      ))}
    </ul>
  );
}

function TriageItem({ item, now }: { item: TriageRow; now: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"open" | "drop" | null>(null);
  const answer = (accept: boolean) => {
    setChoice(accept ? "open" : "drop");
    startTransition(async () => {
      const res = await triageSourceItem({ sourceItemId: item.id, accept });
      if (!res.ok) {
        toast.error(res.error);
        setChoice(null);
        return;
      }
      if (accept && res.data.assetId) {
        router.push(`/ads/${res.data.assetId}`);
      } else {
        toast("Dropped. It is under “skipped” if you need it back.");
      }
    });
  };
  const isMail = item.provider === "google-mail" || item.provider === "outlook";
  const why = item.candidateAssetId ? `New version of “${item.candidateAssetTitle ?? "an ad"}”?` : item.classification === "marketing" ? "Looks like an ad" : "Might be an ad";
  return (
    <li className="group flex items-stretch">
      <button
        type="button"
        disabled={pending}
        onClick={() => answer(true)}
        aria-label={`Open ${item.title} as an ad`}
        className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset disabled:opacity-70 sm:px-4"
      >
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground sm:size-16" aria-hidden>
          {pending && choice === "open" ? <Spinner className="motion-reduce:animate-none" /> : isMail ? <Mail className="size-5" /> : <HardDrive className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium">
              <Sparkles aria-hidden className="size-3" />
              {why}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{relativeTime(item.occurredAt, now)}</span>
          </div>
          <div className="mt-1 truncate text-sm font-medium">{item.title}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {item.sender || item.senderEmail || "Unknown sender"} · {providerName(item.provider)}
            {item.reason ? ` · ${item.reason}` : ""}
            {item.product !== "unknown" ? ` · ${productLabel(item.product)}` : ""}
            {item.channel ? ` · ${channelLabel(item.channel)}` : ""}
            {" · "}
            <span className="text-foreground/70">{pending && choice === "open" ? "Opening…" : "Click to open and check"}</span>
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center pr-2 sm:pr-3">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={pending}
          onClick={() => answer(false)}
          aria-label={`Not an ad: drop ${item.title}`}
          title="Not an ad"
          className="text-muted-foreground hover:text-destructive"
        >
          {pending && choice === "drop" ? <Spinner className="motion-reduce:animate-none" /> : <Trash2 />}
        </Button>
      </div>
    </li>
  );
}

/** "14 skipped · show" with a collapsed list. */
export function SkippedLine({ items, now }: { items: SkippedRow[]; now: number }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        {open ? <ChevronDown aria-hidden className="size-3" /> : <ChevronRight aria-hidden className="size-3" />}
        {items.length} skipped · {open ? "hide" : "show"}
      </button>
      {open && (
        <ul className="mt-1 divide-y rounded-lg border bg-card">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-foreground">{s.title}</span>
              <span className="hidden truncate sm:inline">{s.sender ?? providerName(s.provider)}</span>
              <span className="shrink-0">{s.why === "declined" ? "you dropped it" : "not an ad"}</span>
              <span className="shrink-0 tabular-nums">{relativeTime(s.occurredAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
