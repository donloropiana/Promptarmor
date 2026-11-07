"use client";

import { FileJsonIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { clearSamples, exportAuditRecord, renameWorkspace } from "@/app/(app)/settings/workspace/actions";
import { usd } from "@/components/shell/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { AuditExport, WorkspaceSettings } from "@/lib/data/workspace";

import { CopyButton } from "./copy-button";

/** Workspace name. Owners edit; members see it read-only. */
export function WorkspaceNameForm({ settings }: { settings: WorkspaceSettings }) {
  const [name, setName] = useState(settings.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isOwner = settings.role === "owner";
  const changed = name.trim() !== settings.name && name.trim().length > 0;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await renameWorkspace({ profileId: settings.id, name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`Renamed to ${res.data.name}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="flex-1 sm:max-w-sm">
          <FieldLabel htmlFor="ws-name">Name</FieldLabel>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required readOnly={!isOwner} aria-readonly={!isOwner} />
          {!isOwner ? <FieldDescription>Only owners can rename the workspace.</FieldDescription> : null}
        </Field>
        {isOwner ? (
          <Button type="submit" disabled={pending || !changed}>
            {pending ? <Spinner /> : null}
            Save
          </Button>
        ) : null}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

/** Read-only AI daily cap, with today's spend. Operator-managed. */
export function AiCapCard({ settings }: { settings: WorkspaceSettings }) {
  const cap = settings.aiDailyCapUsd;
  const used = settings.aiUsedTodayUsd;
  const pct = cap && used !== null && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium tabular-nums">{usd(used)}</span>
          <span className="text-muted-foreground"> spent today of a </span>
          <span className="font-medium tabular-nums">{usd(cap)}</span>
          <span className="text-muted-foreground"> daily cap</span>
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">{settings.aiRemainingUsd !== null ? `${usd(settings.aiRemainingUsd)} left` : "—"}</p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-label="AI spend today">
        <div
          className="h-full w-full origin-left rounded-full bg-foreground transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${(pct ?? 0) / 100})` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Resets daily (UTC). When the cap is reached, new ads still get the rate and hidden-text checks, then wait for a person instead of the AI check. The
        cap is managed by the service, not from this page{settings.aiTrusted ? "; this workspace has extra headroom as a trusted workspace" : ""}.
      </p>
    </div>
  );
}

/** Hides the sample ads (nothing is deleted). */
export function ClearSamplesButton({ settings }: { settings: WorkspaceSettings }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const n = settings.sampleAdCount;

  function run() {
    startTransition(async () => {
      const res = await clearSamples({ profileId: settings.id });
      setOpen(false);
      if (!res.ok) {
        toast.error("Couldn't clear the samples", { description: res.error });
        return;
      }
      toast.success(res.data.cleared === 0 ? "No sample ads to clear" : `Cleared ${res.data.cleared} sample ${res.data.cleared === 1 ? "ad" : "ads"}`);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={n === 0}>
          Clear samples{n > 0 ? <span className="text-muted-foreground tabular-nums">({n})</span> : null}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear {n} sample {n === 1 ? "ad" : "ads"}?</AlertDialogTitle>
          <AlertDialogDescription>
            They disappear from the Ads list and from every count. Their checks and decisions stay in the audit record. You can try the samples again
            from an empty Ads page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              run();
            }}
          >
            {pending ? <Spinner /> : null}
            Clear samples
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Generates the audit JSON on demand and shows it with a Copy button (no download). */
export function ExportAuditButton({ settings }: { settings: WorkspaceSettings }) {
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<AuditExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    setRecord(null);
    setOpen(true);
    startTransition(async () => {
      const res = await exportAuditRecord({ profileId: settings.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRecord(res.data);
    });
  }

  const json = record ? JSON.stringify(record, null, 2) : "";

  return (
    <>
      <Button variant="outline" size="sm" onClick={generate}>
        <FileJsonIcon />
        Export audit record
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85svh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit record · {settings.name}</DialogTitle>
            <DialogDescription>
              {record
                ? `${record.decisions.length} ${record.decisions.length === 1 ? "decision" : "decisions"}, ${record.events.length} events and ${record.ads.length} ${record.ads.length === 1 ? "ad" : "ads"} (with live, end and archive dates), as JSON. Copy it into your records; nothing is downloaded.`
                : "Every decision, every event and every ad's status in this workspace, as JSON."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
            {pending && !record ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Spinner /> Building the record…
              </div>
            ) : error ? (
              <div className="flex flex-col items-start gap-2 p-4 text-sm">
                <p className="text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={generate}>
                  Try again
                </Button>
              </div>
            ) : (
              <pre className="max-h-[50svh] overflow-auto p-3 font-mono text-xs leading-relaxed" tabIndex={0} aria-label="Audit record JSON">
                {json}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <CopyButton text={json} label="Copy JSON" size="default" variant="default" disabled={!record} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
