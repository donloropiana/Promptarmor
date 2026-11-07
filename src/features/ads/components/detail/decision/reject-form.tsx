"use client";

import { XCircle } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { decide, type DecideResult } from "@/features/ads/server/actions/review";
import type { AdDetail } from "@/features/ads/server/queries";

/** The Reject dialog: a required reason, then the reject decision, which closes the ad. */

export function RejectForm({ detail, onClose, onDone }: { detail: AdDetail; onClose: () => void; onDone: (label: string, r: DecideResult) => void }) {
  const [pending, start] = useTransition();
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Reject V{detail.latest.versionNo}</DialogTitle>
        <DialogDescription>Rejecting closes the ad. Use Request changes when a revision is expected.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!rationale.trim()) return;
          start(async () => {
            const res = await decide({ versionId: detail.latest.id, decision: "rejected", rationale: rationale.trim() });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            onDone(`Rejected V${detail.latest.versionNo}`, res.data);
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="reject-rationale">Why (required)</Label>
          <Textarea id="reject-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-24" autoFocus />
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
          <Button type="submit" variant="destructive" disabled={pending || !rationale.trim()}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <XCircle data-icon="inline-start" />}
            Reject
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
