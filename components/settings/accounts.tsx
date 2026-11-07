"use client";

import { AlertTriangleIcon, CheckCircle2Icon, RefreshCwIcon, UnplugIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ReconnectButton } from "@/components/connections/connect-buttons";
import { drainConnectionSync } from "@/components/connections/sync-drain";
import { dateTime, timeAgo } from "@/components/shell/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ConnectionSummary, MemberConnections, SyncRunRow } from "@/lib/data/workspace";

import { SyncLogSheet } from "./sync-log-sheet";

/** "synced 2 min ago" / "reconnect needed" / "error", as icon + words. */
function StatusLine({ c }: { c: ConnectionSummary }) {
  if (c.status === "needs_reconnect") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
        reconnect needed
      </span>
    );
  }
  if (c.status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive" title={c.lastError ?? undefined}>
        <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
        error{c.lastError ? `: ${c.lastError}` : ""}
      </span>
    );
  }
  if (c.status === "syncing" && !c.lastSyncedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        first sync running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={dateTime(c.lastSyncedAt)} suppressHydrationWarning>
      <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
      {c.lastSyncedAt ? `synced ${timeAgo(c.lastSyncedAt)}` : "connected"}
    </span>
  );
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`;
}

function ConnectionRow({ c, canManage, profileId, runs }: { c: ConnectionSummary; canManage: boolean; profileId: string; runs: SyncRunRow[] }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function syncNow() {
    setSyncing(true);
    const toastId = toast.loading(`Syncing ${c.providerLabel}`, { description: "Looking back 14 days for ads." });
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(c.id)}/sync`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        hasMore?: boolean;
        skipped?: string;
        error?: string;
        stats?: { new?: number; modified?: number; skipped?: number; errors?: number };
      };
      if (res.status === 429 && body.skipped === "too_soon") {
        toast.info("Already up to date", { id: toastId, description: "This account was synced less than a minute ago." });
        return;
      }
      if (!res.ok) {
        toast.error(`${c.providerLabel} didn't sync`, { id: toastId, description: body.error ?? (await readError(res)) });
        return;
      }
      const s = body.stats ?? {};
      const parts: string[] = [];
      if (s.new) parts.push(`${s.new} new`);
      if (s.modified) parts.push(`${s.modified} changed`);
      if (s.skipped) parts.push(`${s.skipped} skipped`);
      if (s.errors) parts.push(`${s.errors} errors`);
      toast.success(`${c.providerLabel} synced`, {
        id: toastId,
        description: body.hasMore ? "More to go; continuing in the background." : parts.length ? parts.join(" · ") : "Nothing new.",
      });
      router.refresh();
      if (body.hasMore) {
        await drainConnectionSync(c.id, { onPass: () => router.refresh() });
        router.refresh();
      }
    } catch (err) {
      toast.error(`${c.providerLabel} didn't sync`, { id: toastId, description: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't disconnect", { description: await readError(res) });
        return;
      }
      toast.success(`${c.providerLabel} disconnected`, { description: "We no longer read from this account." });
      setConfirm(false);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't disconnect", { description: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setDisconnecting(false);
    }
  }

  const needsReconnect = c.status === "needs_reconnect" || c.status === "error";

  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm">
          {c.providerLabel}
          {c.accountEmail ? <span className="text-muted-foreground"> · {c.accountEmail}</span> : null}
        </p>
        <StatusLine c={c} />
      </div>
      {canManage ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {needsReconnect && c.group ? <ReconnectButton profileId={profileId} group={c.group} connectionId={c.id} size="sm" /> : null}
          <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing || disconnecting || c.status === "needs_reconnect"}>
            {syncing ? <Spinner /> : <RefreshCwIcon />}
            Sync now
          </Button>
          <SyncLogSheet runs={runs} connectionId={c.id} label="Log" />
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} disabled={syncing || disconnecting}>
            <UnplugIcon />
            Disconnect
          </Button>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect {c.providerLabel}?</AlertDialogTitle>
                <AlertDialogDescription>
                  We stop reading from {c.accountEmail ?? "this account"} and delete the access grant. Ads already in the workspace stay. You can
                  connect again any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={disconnecting}
                  onClick={(e) => {
                    e.preventDefault();
                    void disconnect();
                  }}
                >
                  {disconnecting ? <Spinner /> : null}
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <SyncLogSheet runs={runs} connectionId={c.id} label="Log" />
      )}
    </li>
  );
}

/** Connections listed by member: name · providers · status, with Sync now / Disconnect. */
export function ConnectionsByMember({
  profileId,
  groups,
  runs,
  myRole,
}: {
  profileId: string;
  groups: MemberConnections[];
  runs: SyncRunRow[];
  myRole: "owner" | "member";
}) {
  return (
    <ul className="flex flex-col gap-3">
      {groups.map((g) => {
        const canManage = g.isMe || myRole === "owner";
        const providers = [...new Set(g.connections.map((c) => c.providerLabel))].join(", ");
        return (
          <li key={g.userId ?? "former"} className="rounded-lg border bg-card px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium">
                {g.name}
                {g.isMe ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">{providers}</p>
            </div>
            <ul className="mt-1 divide-y">
              {g.connections.map((c) => (
                <ConnectionRow key={c.id} c={c} canManage={canManage} profileId={profileId} runs={runs} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
