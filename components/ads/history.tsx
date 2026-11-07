"use client";

import { Eye } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdDecision, AdDetail, AdEvent, AdRun } from "@/lib/data/ads";

import { formatDate, formatDuration, formatUsd, liveChannelLabel, productLabel, severityLabel, shortSha, statusWord } from "./format";
import { LocalDateTime, useLocalDateTime } from "./local-time";

type Entry = { id: string; at: string; who: string | null; what: string; detail?: string; decision?: AdDecision; run?: AdRun };

type Described = { what: string; detail?: string; /** The actor is already in `what`; do not repeat it. */ actorInline?: boolean };

function describeEvent(e: AdEvent, detail: AdDetail, notedVersionIds: Set<string>): Described | null {
  const d = e.data;
  switch (e.kind) {
    case "asset.created":
      return { what: "Ad created" };
    case "asset.submitted":
      return { what: "Submitted for review" };
    case "version.added": {
      // A reviewer's Edit copy / Replace file: "V2 by Riley: shortened the headline".
      const no = typeof d.version_no === "number" ? d.version_no : detail.versions.find((v) => v.id === d.asset_version_id)?.versionNo;
      const note = typeof d.note === "string" ? d.note.trim() : "";
      const file = d.how === "replace_file" && typeof d.filename === "string" && d.filename ? d.filename : null;
      return { what: `V${no ?? "?"} by ${e.actorLabel ?? "a member"}${note ? `: ${note}` : ""}`, detail: file ? `Replaced the file with ${file}` : undefined, actorInline: true };
    }
    case "version.created": {
      // The database logs this for every version; when the reviewer's own note exists for it, that entry speaks instead.
      if (typeof d.asset_version_id === "string" && notedVersionIds.has(d.asset_version_id)) return null;
      const no = typeof d.version_no === "number" ? d.version_no : detail.versions.find((v) => v.id === d.asset_version_id)?.versionNo;
      const origin = typeof d.origin === "string" ? d.origin : "";
      const how =
        origin === "suggestion_applied" ? "from a suggested fix" : origin === "reviewer_edit" ? "edited by a reviewer" : origin === "email" ? "arrived by email" : origin === "sync" ? "synced from a connected account" : origin === "paste" ? "pasted" : origin === "upload" ? "uploaded" : "";
      return { what: `V${no ?? "?"} ${how}`.trim() };
    }
    case "asset.status_changed": {
      const to = typeof d.to === "string" ? d.to : typeof d.new === "string" ? d.new : null;
      const why = to === "re_review_due" ? (detail.reReviewReason?.kind === "expired" ? " (approval expired)" : " (rates changed)") : to === "needs_manual_review" ? " (a person must decide)" : "";
      return to ? { what: `Status: ${statusWord(to)}${why}` } : null;
    }
    case "asset.metadata_updated": {
      const changed = d.changed && typeof d.changed === "object" ? (d.changed as Record<string, [unknown, unknown]>) : {};
      const parts = Object.entries(changed).map(([k, v]) => `${k.replace(/_/g, " ")}: ${fmt(k, v?.[0])} → ${fmt(k, v?.[1])}`);
      return { what: "Details changed", detail: parts.join(" · ") || undefined };
    }
    case "security_alert.acknowledged":
      return { what: "Hidden-text alert acknowledged" };
    case "decision.recorded":
      return null; // rendered from decisions, with "View as at decision"
    case "change_request.created":
      return { what: "Change request saved", detail: typeof d.item_count === "number" ? `${d.item_count} item${d.item_count === 1 ? "" : "s"}` : undefined };
    case "approval.revoked":
      return { what: "Approval revoked by a later decision" };
    case "approval.withdrawn":
      return { what: "Approval withdrawn", detail: typeof d.rationale === "string" ? d.rationale : undefined };
    case "triage.accepted":
      return { what: "Accepted as an ad from a connected account" };
    case "triage.declined":
      return { what: "Marked as not an ad" };
    case "asset.marked_live": {
      const where = liveChannelLabel(typeof d.live_channel === "string" ? d.live_channel : null);
      const from = typeof d.live_at === "string" ? `from ${formatDate(d.live_at)}` : "";
      const ends = typeof d.expires_at === "string" ? ` · ends ${formatDate(d.expires_at)}` : "";
      const link = typeof d.live_url === "string" && d.live_url ? ` · ${d.live_url}` : "";
      return { what: `Marked live${where ? ` on ${where}` : ""}`, detail: `${from}${ends}${link}`.trim() || undefined };
    }
    case "asset.expiry_set":
      return { what: typeof d.expires_at === "string" ? `End date set to ${formatDate(d.expires_at)}` : "End date cleared" };
    case "asset.expired":
      return { what: "Approval expired", detail: typeof d.expires_at === "string" ? `End date ${formatDate(d.expires_at)} passed; back to Needs review` : "Back to Needs review" };
    case "asset.archived":
      return { what: "Archived", detail: typeof d.reason === "string" ? d.reason : undefined };
    case "asset.unarchived":
      return { what: "Unarchived" };
    case "finding.added": {
      const sev = typeof d.severity === "string" ? d.severity : "";
      const quote = typeof d.quote === "string" ? d.quote : "";
      if (d.anchor_type === "image_region") return { what: `Note pinned on the image${sev ? ` (${severityLabel(sev)})` : ""}`, detail: quote || undefined };
      return { what: `Issue added${sev ? ` (${severityLabel(sev)})` : ""}`, detail: quote ? `“${quote}”` : undefined };
    }
    default:
      // analysis.completed / failed / declined_budget / manual_review are
      // rendered from the runs themselves (with model, tokens and cost).
      if (e.kind.startsWith("analysis.")) return null;
      return { what: e.kind.replace(/[._]/g, " ") };
  }
}

function fmt(key: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (key === "product") return productLabel(String(v));
  return String(v);
}

function describeRun(r: AdRun, detail: AdDetail): { what: string; detail?: string } {
  const v = detail.versions.find((x) => x.id === r.versionId)?.versionNo;
  const base = `Check on V${v ?? "?"}`;
  if (r.status === "complete") {
    if (r.mode === "off") return { what: `${base} complete`, detail: "AI step skipped (test mode) · product-terms check only · $0" };
    if (r.mode === "replay") return { what: `${base} complete`, detail: "recorded result replayed · no AI spend" };
    if (r.mode === "reused") return { what: `${base} complete`, detail: "reused from an identical ad · $0" };
    return { what: `${base} complete`, detail: `${r.model ?? "AI"} · ${(r.inputTokens + r.outputTokens).toLocaleString("en-US")} tokens · ${formatUsd(r.costUsd, { precise: true })}` };
  }
  if (r.status === "failed") return { what: `${base} failed`, detail: r.error ?? "Not AI-screened; review by hand." };
  if (r.status === "declined_budget") return { what: `${base} skipped: AI budget reached`, detail: "Not AI-screened; review by hand." };
  return { what: `${base} ${r.status}` };
}

function describeDecision(d: AdDecision): { what: string; detail?: string } {
  const v = d.versionNo != null ? `V${d.versionNo}` : "";
  switch (d.decision) {
    case "approved":
      return { what: `Approved ${v} · ${shortSha(d.contentSha256)}`, detail: d.rationale ?? undefined };
    case "approved_with_exceptions":
      return { what: `Approved ${v} with ${d.exceptions.length} exception${d.exceptions.length === 1 ? "" : "s"} · ${shortSha(d.contentSha256)}`, detail: d.rationale ?? undefined };
    case "changes_requested":
      return { what: `Changes requested on ${v}` };
    case "rejected":
      return { what: `Rejected ${v}`, detail: d.rationale ?? undefined };
    case "withdrawn":
      return { what: `Approval of ${v} withdrawn`, detail: d.rationale ?? undefined };
    default:
      return { what: `${d.decision} ${v}` };
  }
}

/** Who did what, checks with their cost, decisions with "View as at decision". */
export function History({ detail }: { detail: AdDetail }) {
  const [viewing, setViewing] = useState<AdDecision | null>(null);
  const entries: Entry[] = [];
  const notedVersionIds = new Set<string>();
  for (const e of detail.events) {
    if (e.kind === "version.added" && typeof e.data.asset_version_id === "string") notedVersionIds.add(e.data.asset_version_id);
  }
  for (const e of detail.events) {
    const desc = describeEvent(e, detail, notedVersionIds);
    if (desc) entries.push({ id: `e${e.id}`, at: e.createdAt, who: desc.actorInline ? null : e.actorLabel, what: desc.what, detail: desc.detail });
  }
  for (const r of detail.runs) {
    if (r.status === "queued" || r.status === "running") continue;
    const desc = describeRun(r, detail);
    entries.push({ id: `r${r.id}`, at: r.completedAt ?? r.createdAt, who: null, what: desc.what, detail: desc.detail, run: r });
  }
  for (const d of detail.decisions) {
    const desc = describeDecision(d);
    entries.push({ id: `d${d.id}`, at: d.createdAt, who: d.approverLabel, what: desc.what, detail: desc.detail, decision: d });
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section aria-label="History" className="rounded-xl border bg-card">
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <h2 className="text-sm font-medium">History</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          AI {formatUsd(detail.aiCostUsd, { precise: true })} · review time {formatDuration(detail.reviewSeconds)}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="border-t px-3.5 py-3 text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="divide-y border-t">
          {entries.map((en) => (
            <li key={en.id} className="flex gap-3 px-3.5 py-2 text-sm">
              <LocalDateTime iso={en.at} className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground sm:w-28" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{en.what}</span>
                  {en.who && <span className="text-xs text-muted-foreground">{en.who}</span>}
                  {!en.who && en.run && <span className="text-xs text-muted-foreground">AI</span>}
                  {en.decision && (
                    <Button type="button" size="xs" variant="ghost" onClick={() => setViewing(en.decision!)}>
                      <Eye data-icon="inline-start" /> View as at decision
                    </Button>
                  )}
                </div>
                {en.detail && <div className="mt-0.5 break-words text-xs text-muted-foreground">{en.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <DecisionSnapshotDialog decision={viewing} detail={detail} onClose={() => setViewing(null)} />
    </section>
  );
}

function DecisionSnapshotDialog({ decision: d, detail, onClose }: { decision: AdDecision | null; detail: AdDetail; onClose: () => void }) {
  const when = useLocalDateTime(d?.createdAt);
  if (!d) return null;
  const version = detail.versions.find((v) => v.id === d.versionId);
  const snap = d.snapshot;
  const rows: [string, string][] = [
    ["Decision", describeDecision(d).what],
    ["By", `${d.approverLabel}${d.selfApproved ? " (self-approval)" : ""}`],
    ["When", when],
    ["Version", version ? `V${version.versionNo} · ${d.contentSha256}` : d.contentSha256],
    ["Attested", d.attested ? "Yes" : "No"],
    ["AI screened", d.manualOnly ? "No (manual approval)" : "Yes"],
    ["Title then", typeof snap.title === "string" ? snap.title : "—"],
    ["Product then", productLabel(typeof snap.product === "string" ? snap.product : null)],
    ["Channel then", typeof snap.channel === "string" && snap.channel ? snap.channel : "—"],
    ["Status before", typeof snap.status === "string" ? statusWord(snap.status) : "—"],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>As at decision</DialogTitle>
          <DialogDescription>What the record shows for this decision. Exceptions and dismissals are copied at decision time and never change.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
        </dl>
        {d.rationale && (
          <div className="text-sm">
            <div className="text-muted-foreground">Rationale</div>
            <p className="whitespace-pre-wrap">{d.rationale}</p>
          </div>
        )}
        {d.exceptions.length > 0 && (
          <div className="text-sm">
            <div className="mb-1 text-muted-foreground">Exceptions ({d.exceptions.length})</div>
            <ul className="space-y-1.5">
              {d.exceptions.map((e, i) => {
                const f = detail.findings.find((x) => x.id === e.finding_id) ?? detail.previousFindings.find((x) => x.id === e.finding_id);
                return (
                  <li key={i} className="rounded-lg border p-2">
                    <div className="text-xs text-muted-foreground">
                      {e.severity ?? f?.severity ?? ""} {e.reason ? `· ${String(e.reason).replace(/_/g, " ")}` : ""}
                    </div>
                    {f?.quote && <q className="block text-xs [quotes:'“'_'”']">{f.quote}</q>}
                    <p className="mt-0.5">{e.text}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {d.dismissed.length > 0 && <p className="text-xs text-muted-foreground">{d.dismissed.length} Critical/Major issue{d.dismissed.length === 1 ? " was" : "s were"} dismissed or downgraded before this decision.</p>}
        {version && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Text of V{version.versionNo} as decided</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-sans text-xs">{version.extractedText || "(no text)"}</pre>
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}
