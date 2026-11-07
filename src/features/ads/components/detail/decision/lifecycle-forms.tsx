"use client";

import { Archive, Undo2 } from "lucide-react";
import { cn } from "cn";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { archiveAd } from "@/features/ads/server/actions/lifecycle";
import { withdrawApproval } from "@/features/ads/server/actions/review";
import type { AdDetail } from "@/features/ads/server/queries/detail";

import { APPROVED_STATUSES } from "@/features/ads/domain";

/**
 * The Withdraw approval and Archive dialogs: actions on the ad's life after
 * review rather than decisions on a version, so each confirms with a toast
 * and keeps you on the ad.
 */

export function WithdrawForm({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = rationale.trim().length >= 20;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Withdraw approval</DialogTitle>
        <DialogDescription>Takes the ad out of market. The approval record stays in the history.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          start(async () => {
            const res = await withdrawApproval({ assetId, rationale: rationale.trim() });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            toast.success("Approval withdrawn");
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="withdraw-rationale">Why (at least 20 characters)</Label>
          <Textarea id="withdraw-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-24" autoFocus />
          <div className={cn("text-xs tabular-nums", ok ? "text-muted-foreground" : "text-destructive")}>{rationale.trim().length} / 20</div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={pending || !ok}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <Undo2 data-icon="inline-start" />}
            Withdraw
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function ArchiveForm({ detail, onClose }: { detail: AdDetail; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 3;
  const approved = APPROVED_STATUSES.has(detail.status);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Archive this ad</DialogTitle>
        <DialogDescription>
          {approved
            ? "Moves it off the Approved and Live tabs. The approval record and every version stay; Unarchive brings it back."
            : "Moves it to the Archived tab. Nothing is deleted; Unarchive brings it back."}
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          start(async () => {
            const res = await archiveAd({ assetId: detail.id, reason: reason.trim() });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            toast.success("Archived");
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="archive-reason">Why (a few words)</Label>
          <Textarea id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" placeholder="Campaign ended, superseded by V3, no longer offered…" autoFocus />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !ok}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <Archive data-icon="inline-start" />}
            Archive
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
