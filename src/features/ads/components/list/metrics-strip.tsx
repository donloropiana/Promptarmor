import { AlertCircle, Unplug } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AdsMetrics, AdsSummary } from "@/features/ads/server/queries";

import { formatUsd, pluralise, providerName, relativeTime } from "@/features/ads/format";

/** "7 need review · 2 revisions in · synced from 4 accounts 2 min ago" */
export function SummaryLine({ summary }: { summary: AdsSummary }) {
  const parts: string[] = [];
  parts.push(summary.needReview === 0 ? "Nothing waiting for review" : `${summary.needReview.toLocaleString("en-US")} need${summary.needReview === 1 ? "s" : ""} review`);
  if (summary.revisionsIn > 0) parts.push(`${pluralise(summary.revisionsIn, "revision")} in`);
  if (summary.connectedAccounts > 0) {
    parts.push(
      `synced from ${pluralise(summary.connectedAccounts, "account")}${summary.lastSyncedAt ? ` ${relativeTime(summary.lastSyncedAt)}` : ""}`,
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {parts.join(" · ")}
      {summary.connectedAccounts === 0 && (
        <>
          {" · "}
          <Link href="/settings/accounts" className="underline underline-offset-4 hover:text-foreground">
            Connect an account
          </Link>{" "}
          to pull ads in automatically
        </>
      )}
    </p>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums leading-tight">{value}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

/** Five numbers. Everything but AI spend shows "—" until 5 decisions exist. */
export function MetricsStrip({ metrics }: { metrics: AdsMetrics }) {
  const dash = "—";
  const spend = metrics.aiSpendToday == null ? dash : formatUsd(metrics.aiSpendToday);
  const cap = metrics.aiCap == null ? null : `of ${formatUsd(metrics.aiCap)}`;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Workspace metrics">
      <Metric label="Minutes per ad" value={metrics.ready && metrics.minutesPerAd != null ? String(metrics.minutesPerAd) : dash} hint={metrics.ready ? "reviewer time" : undefined} />
      <Metric label="Days to approval" value={metrics.ready && metrics.daysToApproval != null ? String(metrics.daysToApproval) : dash} />
      <Metric label="Approved first time" value={metrics.ready && metrics.approvedFirstTimePct != null ? `${metrics.approvedFirstTimePct}%` : dash} />
      <Metric label="Exceptions" value={metrics.ready && metrics.exceptions != null ? String(metrics.exceptions) : dash} hint={metrics.ready ? "approved with" : undefined} />
      <Metric label="AI spend today" value={spend} hint={cap ?? undefined} />
      {!metrics.ready && (
        <p className="col-span-2 text-xs text-muted-foreground sm:col-span-5">
          Numbers appear after 5 decisions. {metrics.decisions > 0 ? `${metrics.decisions} so far.` : ""}
        </p>
      )}
    </div>
  );
}

/** Only two banners exist: a broken connection, or AI spend past 80% of the cap. */
export function Banners({ summary, metrics }: { summary: AdsSummary; metrics: AdsMetrics }) {
  const overBudget = metrics.aiCap != null && metrics.aiCap > 0 && metrics.aiSpendToday != null && metrics.aiSpendToday / metrics.aiCap >= 0.8;
  if (summary.brokenConnections.length === 0 && !overBudget) return null;
  return (
    <div className="space-y-2">
      {summary.brokenConnections.length > 0 && (
        <Alert>
          <Unplug />
          <AlertTitle>
            {summary.brokenConnections.length === 1
              ? `${providerName(summary.brokenConnections[0].provider)}${summary.brokenConnections[0].accountEmail ? ` (${summary.brokenConnections[0].accountEmail})` : ""} needs reconnecting`
              : `${summary.brokenConnections.length} connected accounts need reconnecting`}
          </AlertTitle>
          <AlertDescription>
            New ads from {summary.brokenConnections.length === 1 ? "that account" : "those accounts"} are not arriving.{" "}
            <Link href="/settings/accounts">Reconnect in Connected accounts</Link>.
          </AlertDescription>
        </Alert>
      )}
      {overBudget && (
        <Alert>
          <AlertCircle />
          <AlertTitle>
            AI spend is at {formatUsd(metrics.aiSpendToday)} of today&apos;s {formatUsd(metrics.aiCap)} cap
          </AlertTitle>
          <AlertDescription>
            When the cap is reached, new ads wait as &quot;Not AI-screened&quot; until midnight UTC and need a manual check.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
