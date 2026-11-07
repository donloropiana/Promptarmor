"use client";

import { ArrowLeft, Copy, Keyboard, Sparkles } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useLocalDateTime } from "@/features/ads/components/local-time";
import { ReasonTags, StatusWord } from "@/features/ads/components/status";
import { adTags, isNotScreened } from "@/features/ads/domain";
import { relativeTime, shortSha } from "@/features/ads/format";
import type { AdDetail } from "@/features/ads/server/queries";

import { MetaChips } from "../meta-chips";

/**
 * The ad page's header: the way back to the list, status and tags, the
 * shortcuts button, the title with its version, sender and age, and the
 * product/channel chips.
 */

/** The same tags as the ad's row in the list. */
function tagsFor(detail: AdDetail): string[] {
  return adTags({
    status: detail.status,
    versionNo: detail.latest.versionNo,
    hasDecisions: detail.decisions.length > 0,
    hiddenText: detail.alerts.some((a) => !a.acknowledgedAt),
    changedAfterApproval: detail.changedAfterApproval,
    notScreened: isNotScreened(detail.status, detail.latestRun?.status),
    isSample: detail.isSample,
    reReviewReason: detail.reReviewReason,
  });
}

export function AdHeader({
  detail,
  live,
  archived,
  readOnly,
  onShowShortcuts,
}: {
  detail: AdDetail;
  live: boolean;
  archived: boolean;
  readOnly: boolean;
  onShowShortcuts: () => void;
}) {
  const submittedAbsolute = useLocalDateTime(detail.submittedAt ?? detail.createdAt);
  return (
    <header className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/ads" className="inline-flex items-center gap-1 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
          <ArrowLeft aria-hidden className="size-3.5" /> Ads
        </Link>
        <span aria-hidden>·</span>
        <StatusWord status={detail.status} checking={detail.checking} live={live} archived={archived} />
        <ReasonTags tags={tagsFor(detail)} />
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Keyboard shortcuts" onClick={() => onShowShortcuts()} className="ml-auto hidden sm:inline-flex">
          <Keyboard />
        </Button>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          {/* A headline can be a 400-character URL: break anywhere rather than scroll sideways. */}
          <h1 className="text-lg font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]" dir="auto">
            {detail.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">
              V{detail.latest.versionNo} · {shortSha(detail.latest.contentSha256)}
            </span>
            <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">
              {detail.isSample ? (
                <span className="inline-flex items-center gap-1">
                  <Sparkles aria-hidden className="size-3" /> Sample ad
                </span>
              ) : (
                <>From {detail.submitterName || detail.submitterEmail || detail.latest.authorLabel || "a member"}</>
              )}
            </span>
            <span title={submittedAbsolute}>{relativeTime(detail.submittedAt ?? detail.createdAt, detail.now)}</span>
            {detail.seenIn > 1 && (
              <span className="inline-flex items-center gap-1">
                <Copy aria-hidden className="size-3" /> Seen in {detail.seenIn} places
              </span>
            )}
          </div>
        </div>
        <MetaChips assetId={detail.id} product={detail.product} channel={detail.channel} inferred={detail.latest.content.meta?.inferred} disabled={readOnly} />
      </div>
    </header>
  );
}
