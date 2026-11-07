"use client";

import { Archive, ArchiveRestore, CalendarClock, ExternalLink, Radio, Rocket } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { markLive, setExpiry, unarchiveAd } from "@/features/ads/server/actions";
import type { AdDetail } from "@/features/ads/server/queries";

import { LIVE_CHANNELS, isLive } from "@/features/ads/domain";
import { formatDate, lifecycleLine } from "@/features/ads/format";
import { LongText } from "@/features/ads/components/long-text";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Life after approval, on the ad page. Approved and not yet live: "Ship it"
 * with Mark as live (where, link, optional end date). Live: one line that
 * says where and since when, with the end date editable. Archived: when and
 * why, with Unarchive. Every change is a server action recorded as an event.
 */
export function ShipIt({ detail }: { detail: AdDetail }) {
  if (detail.archivedAt) return <ArchivedCard detail={detail} />;
  const live = isLive({ status: detail.status, liveAt: detail.liveAt, expiresAt: detail.expiresAt, archivedAt: detail.archivedAt }, detail.now);
  if (live) return <LiveCard detail={detail} />;
  return <MarkLiveCard detail={detail} />;
}

function MarkLiveCard({ detail }: { detail: AdDetail }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState("");
  const [url, setUrl] = useState("");
  const [ends, setEnds] = useState("");
  const was = lifecycleLine({ status: detail.status, liveAt: detail.liveAt, expiresAt: detail.expiresAt, archivedAt: null, liveChannel: detail.liveChannel }, detail.now);

  return (
    <section aria-label="Ship it" data-ship-it className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Rocket aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Ship it</div>
          <p className="text-sm text-muted-foreground">{was ? `${was}. Mark it live again when it runs next.` : "Approved and ready to run. Say where it is live so the record is complete."}</p>
          {!open ? (
            <Button type="button" size="sm" className="mt-3" onClick={() => setOpen(true)}>
              <Radio data-icon="inline-start" /> Mark as live
            </Button>
          ) : (
            <form
              className="mt-3 grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!channel) {
                  setError("Pick where the ad is live.");
                  return;
                }
                setError(null);
                start(async () => {
                  const res = await markLive({ assetId: detail.id, channel, url: url.trim() || undefined, expiresAt: ends || undefined });
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  toast.success("Marked as live");
                  setOpen(false);
                });
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="live-channel">Where</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger id="live-channel" className="w-full sm:w-56">
                    <SelectValue placeholder="Pick a channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {LIVE_CHANNELS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="live-url">Link (optional)</Label>
                <Input id="live-url" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="live-ends">End date (optional)</Label>
                <Input id="live-ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className="w-fit" />
                <p className="text-xs text-muted-foreground">When it passes, the ad comes back to Needs review tagged Expired.</p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? <Spinner className="motion-reduce:animate-none" /> : <Radio data-icon="inline-start" />}
                  Mark as live
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function LiveCard({ detail }: { detail: AdDetail }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ends, setEnds] = useState(detail.expiresAt ? detail.expiresAt.slice(0, 10) : "");
  const line = lifecycleLine({ status: detail.status, liveAt: detail.liveAt, expiresAt: detail.expiresAt, archivedAt: null, liveChannel: detail.liveChannel }, detail.now);
  const host = hostOf(detail.liveUrl);

  const save = (value: string | null) => {
    setError(null);
    start(async () => {
      const res = await setExpiry({ assetId: detail.id, expiresAt: value });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(value ? "End date saved" : "End date cleared");
      setEditing(false);
    });
  };

  return (
    <section aria-label="Live" data-ship-it className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Radio aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-medium">{line}</span>
            {detail.liveUrl && (
              <a href={detail.liveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                <ExternalLink aria-hidden className="size-3" /> {host ?? "link"}
              </a>
            )}
          </div>
          {!editing ? (
            <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => setEditing(true)}>
              <CalendarClock data-icon="inline-start" /> {detail.expiresAt ? "Change end date" : "Set an end date"}
            </Button>
          ) : (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                save(ends || null);
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="live-ends-edit">End date</Label>
                <Input id="live-ends-edit" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className="w-fit" />
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? <Spinner className="motion-reduce:animate-none" /> : null}
                Save
              </Button>
              {detail.expiresAt && (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => save(null)}>
                  No end date
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ArchivedCard({ detail }: { detail: AdDetail }) {
  const [pending, start] = useTransition();
  const was = detail.liveAt ? lifecycleLine({ status: detail.status, liveAt: detail.liveAt, expiresAt: detail.expiresAt, archivedAt: null, liveChannel: detail.liveChannel }, detail.now) : null;
  return (
    <section aria-label="Archived" data-ship-it className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Archive aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Archived {formatDate(detail.archivedAt)}</div>
          {detail.archiveReason && <LongText text={detail.archiveReason} className="mt-0.5 text-sm text-muted-foreground" />}
          {was && <p className="mt-0.5 text-xs text-muted-foreground">{was}</p>}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await unarchiveAd(detail.id);
                if (!res.ok) toast.error(res.error);
                else toast.success("Back from the archive");
              })
            }
          >
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <ArchiveRestore data-icon="inline-start" />}
            Unarchive
          </Button>
        </div>
      </div>
    </section>
  );
}
