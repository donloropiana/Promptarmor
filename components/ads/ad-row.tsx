"use client";

import {
  Copy,
  FileText,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Link2,
  Mail,
  Megaphone,
  MessageSquare,
  MonitorPlay,
  Search,
  Sparkles,
  Type,
  Upload,
  User,
} from "lucide-react";
import Link from "next/link";

import type { AdListRow, ThumbIcon } from "@/lib/data/ads";

import { relativeTime } from "./format";
import { useLocalDateTime } from "./local-time";
import { RiskMark } from "./severity";
import { ReasonTags, StatusWord } from "./status";

const THUMB_ICONS: Record<ThumbIcon, typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  email: Mail,
  social: Megaphone,
  web: Globe,
  display: MonitorPlay,
  search: Search,
  sms: MessageSquare,
  affiliate: Link2,
  text: Type,
};

function Thumb({ thumbnail, title }: { thumbnail: AdListRow["thumbnail"]; title: string }) {
  if (thumbnail.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL from private storage
      <img src={thumbnail.url} alt="" title={title} className="size-12 shrink-0 rounded-lg border object-cover sm:size-16" loading="lazy" decoding="async" />
    );
  }
  const Icon = THUMB_ICONS[thumbnail.icon];
  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground sm:size-16" aria-hidden>
      <Icon className="size-5 sm:size-6" />
    </div>
  );
}

function FromIcon({ kind, provider }: { kind: AdListRow["from"]["kind"]; provider: string | null }) {
  const cls = "size-3 shrink-0";
  if (kind === "sample") return <Sparkles aria-hidden className={cls} />;
  if (kind === "connector") {
    if (provider === "google-mail" || provider === "outlook") return <Mail aria-hidden className={cls} />;
    if (provider === "upload") return <Upload aria-hidden className={cls} />;
    return <HardDrive aria-hidden className={cls} />;
  }
  return <User aria-hidden className={cls} />;
}

export function AdRow({ row, now }: { row: AdListRow; now: number }) {
  const submittedAbsolute = useLocalDateTime(row.submittedAt);
  // Samples sit under their own heading in the list, so the tag would repeat it.
  const tags = row.isSample ? row.tags.filter((t) => t !== "Sample") : row.tags;
  // The risk mark only earns its place when there is something open; the
  // second line already says "No open issues" or "Not checked by AI".
  const showRiskMark = !row.checking && row.openCritical + row.openMajor + row.openMinor > 0;
  const openTotal = row.openCritical + row.openMajor + row.openMinor;
  return (
    <li>
      <Link
        data-ad-row
        href={`/ads/${row.id}`}
        className="group flex gap-3 px-3 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset sm:px-4"
        aria-label={`${row.title}. ${row.checking ? "Checking" : row.status.replace(/_/g, " ")}.`}
      >
        <Thumb thumbnail={row.thumbnail} title={row.title} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div data-ad-title className="min-w-0 truncate text-sm font-medium text-foreground" dir="auto" title={row.title}>
              {row.title}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusWord status={row.status} checking={row.checking} className="hidden sm:inline-flex" />
              <span className="text-xs tabular-nums text-muted-foreground" title={submittedAbsolute}>
                {relativeTime(row.submittedAt, now)}
              </span>
            </div>
          </div>

          <div className="mt-0.5 truncate text-sm text-muted-foreground" dir="auto">
            {row.checking ? (
              <span>Checking against the rules and product terms…</span>
            ) : row.hiddenText ? (
              // Hidden text is why the row sorts first: say so instead of quoting the instruction back.
              <span>
                Hidden text aimed at the reviewer{openTotal > 0 ? ` and ${openTotal} open issue${openTotal === 1 ? "" : "s"}` : ""}. Open to read it.
              </span>
            ) : row.topIssue ? (
              <>
                {row.topIssue.quote && <q className="font-medium text-foreground">{row.topIssue.quote}</q>}
                {row.topIssue.quote && row.topIssue.explanation && <span> — </span>}
                {row.topIssue.explanation && <span>{row.topIssue.explanation}</span>}
              </>
            ) : row.tab === "approved" ? (
              // The approval is the news on this tab, not the absence of open issues.
              <span>{row.withExceptions ? `Approved with ${row.exceptionCount || "recorded"} exception${row.exceptionCount === 1 ? "" : "s"}` : "Approved as written"}</span>
            ) : row.notScreened ? (
              <span>Not checked by AI. Review it by hand.</span>
            ) : row.noText ? (
              // A file nothing could read: "No open issues" would be a false all-clear.
              <span>No text could be read from this {row.thumbnail.kind === "icon" && row.thumbnail.icon === "pdf" ? "PDF" : "image"}. Open it and review by hand.</span>
            ) : (
              <span>No open issues</span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {showRiskMark && <RiskMark critical={row.openCritical} major={row.openMajor} minor={row.openMinor} />}
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <FromIcon kind={row.from.kind} provider={row.from.provider} />
              <span className="truncate">
                {row.from.label}
                {row.from.detail ? <span className="hidden sm:inline"> {row.from.detail}</span> : null}
              </span>
            </span>
            {row.seenIn > 1 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Copy aria-hidden className="size-3" />
                Seen in {row.seenIn} places
              </span>
            )}
            <StatusWord status={row.status} checking={row.checking} className="sm:hidden" />
            <ReasonTags tags={tags} />
            {row.approvedVersionNo != null && row.tab === "approved" && (
              <span className="text-xs text-muted-foreground">
                V{row.approvedVersionNo}
                {row.approvedBy ? ` by ${row.approvedBy}` : ""}
                {row.approvedAt ? ` · ${relativeTime(row.approvedAt, now)}` : ""}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
