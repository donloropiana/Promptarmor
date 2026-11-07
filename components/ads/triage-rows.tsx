"use client";

import { Check, ChevronDown, ChevronRight, HardDrive, HelpCircle, Mail, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { triageSourceItem } from "@/lib/actions/ads";
import type { SkippedRow, TriageRow } from "@/lib/data/ads";

import { channelLabel, productLabel, providerName, relativeTime } from "./format";

/** "Is this an ad?" rows with inline Yes / No. Visible only to the member whose account it came from. */
export function TriageRows({ items, now }: { items: TriageRow[]; now: number }) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y rounded-xl border bg-card" aria-label="Items that might be ads">
      {items.map((t) => (
        <TriageItem key={t.id} item={t} now={now} />
      ))}
    </ul>
  );
}

function TriageItem({ item, now }: { item: TriageRow; now: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"yes" | "no" | null>(null);
  const answer = (accept: boolean) => {
    setChoice(accept ? "yes" : "no");
    startTransition(async () => {
      const res = await triageSourceItem({ sourceItemId: item.id, accept });
      if (!res.ok) {
        toast.error(res.error);
        setChoice(null);
        return;
      }
      if (accept && res.data.assetId) {
        toast.success("Added. Checking it now.");
        router.push(`/ads/${res.data.assetId}`);
      } else {
        toast("Skipped");
      }
    });
  };
  const isMail = item.provider === "google-mail" || item.provider === "outlook";
  return (
    <li className="flex items-start gap-3 px-3 py-3 sm:px-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground sm:size-16" aria-hidden>
        {isMail ? <Mail className="size-5" /> : <HardDrive className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium">
            <HelpCircle aria-hidden className="size-3" />
            {item.candidateAssetId ? "New version?" : "Is this an ad?"}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{relativeTime(item.occurredAt, now)}</span>
        </div>
        <div className="mt-1 truncate text-sm font-medium">{item.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.sender || item.senderEmail || "Unknown sender"} · {providerName(item.provider)}
          {item.candidateAssetTitle ? ` · looks like a new version of “${item.candidateAssetTitle}”` : ""}
          {item.reason ? ` · ${item.reason}` : ""}
          {item.product !== "unknown" ? ` · ${productLabel(item.product)}` : ""}
          {item.channel ? ` · ${channelLabel(item.channel)}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => answer(true)} aria-label={`Yes, ${item.title} is an ad`}>
          {pending && choice === "yes" ? <Spinner /> : <Check data-icon="inline-start" />}
          Yes
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => answer(false)} aria-label={`No, ${item.title} is not an ad`}>
          {pending && choice === "no" ? <Spinner /> : <X data-icon="inline-start" />}
          No
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
              <span className="shrink-0">{s.why === "declined" ? "you said no" : "not an ad"}</span>
              <span className="shrink-0 tabular-nums">{relativeTime(s.occurredAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
