"use client";

import { Archive, ArchiveRestore, ArrowRight, Check, MailCheck, MessageSquareWarning, MoreHorizontal, Undo2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { simulateRevision, unarchiveAd, type DecideResult } from "@/features/ads/server/actions";
import type { AdDetail } from "@/features/ads/server/queries";

import { APPROVED_STATUSES, ARCHIVABLE_STATUSES } from "@/features/ads/domain";
import { formatDate } from "@/features/ads/format";
import { ApproveForm } from "./decision/approve-form";
import { ArchiveForm, WithdrawForm } from "./decision/lifecycle-forms";
import { RejectForm } from "./decision/reject-form";
import { RequestChangesForm } from "./decision/request-changes-form";

export type DecisionDialogs = { approve: boolean; request: boolean; reject: boolean; withdraw: boolean; archive: boolean };
export const NO_DIALOGS: DecisionDialogs = { approve: false, request: false, reject: false, withdraw: false, archive: false };

/** Why a decision cannot be made right now, or null. */
export function blockingReason(detail: AdDetail): string | null {
  if (detail.alerts.some((a) => !a.acknowledgedAt)) return "Acknowledge the hidden-text alert first.";
  if (detail.checking) return "Wait for the check to finish.";
  const finished = detail.runs.some((r) => r.versionId === detail.latest.id && ["complete", "failed", "declined_budget"].includes(r.status));
  if (!finished) return "This version has not been checked yet.";
  return null;
}

/** Sticky decision bar with the Approve / Request changes sheets and the overflow menu. Dialog state is owned by the parent (keyboard shortcuts). */
export function DecisionBar({
  detail,
  userId,
  dialogs,
  onDialogs,
}: {
  detail: AdDetail;
  userId: string;
  dialogs: DecisionDialogs;
  onDialogs: (next: DecisionDialogs) => void;
}) {
  const router = useRouter();
  const [simulating, startSimulate] = useTransition();
  const [unarchiving, startUnarchive] = useTransition();
  const cancelAdvance = useRef(false);

  const approved = APPROVED_STATUSES.has(detail.status);
  const archived = Boolean(detail.archivedAt);
  const canArchive = !archived && ARCHIVABLE_STATUSES.has(detail.status);
  const blocked = blockingReason(detail);
  const versionNo = detail.latest.versionNo;
  const set = (patch: Partial<DecisionDialogs>) => onDialogs({ ...NO_DIALOGS, ...patch });

  const afterDecision = (label: string, result: DecideResult, opts: { advance?: boolean } = {}) => {
    cancelAdvance.current = false;
    const next = result.nextAdId;
    // Request changes keeps you here: the ad now waits for its revision and
    // the page shows that state. Approvals and rejections move on.
    const advance = opts.advance ?? true;
    const id = toast.custom(
      (t) => (
        <div
          onMouseEnter={() => {
            cancelAdvance.current = true;
          }}
          onClick={() => {
            cancelAdvance.current = true;
          }}
          className="flex w-full items-center gap-3 rounded-lg border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg"
        >
          <Check aria-hidden className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">{next ? (advance ? "Opening the next ad… hover to stay here." : "This ad now waits for a revision.") : "Nothing else needs review."}</div>
          </div>
          {next ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                toast.dismiss(t);
                router.push(`/ads/${next}`);
              }}
            >
              Open next
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                toast.dismiss(t);
                router.push("/ads");
              }}
            >
              Back to ads
            </Button>
          )}
        </div>
      ),
      { duration: 6000 },
    );
    if (next && advance) {
      setTimeout(() => {
        if (cancelAdvance.current) return;
        toast.dismiss(id);
        router.push(`/ads/${next}`);
      }, 1500);
    }
  };

  return (
    <div data-decision-bar className="sticky bottom-0 z-10 -mx-4 mt-3 border-t bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:mx-0 md:rounded-xl md:border md:px-3">
      <div className="flex items-center gap-2">
        {archived ? (
          <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            <span className="font-medium">Archived {formatDate(detail.archivedAt)}</span>
            {detail.archiveReason && <span className="text-muted-foreground"> · {detail.archiveReason}</span>}
          </div>
        ) : approved ? (
          <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            <span className="font-medium">Approved V{detail.approval?.versionNo ?? versionNo}</span>
            {detail.approval && (
              <span className="text-muted-foreground">
                {" "}
                · {detail.approval.approverLabel} ·{" "}
                {detail.approval.exceptions.length ? `${detail.approval.exceptions.length} exception${detail.approval.exceptions.length === 1 ? "" : "s"}` : "no exceptions"}
              </span>
            )}
          </div>
        ) : (
          <>
            <Button type="button" onClick={() => set({ approve: true })} disabled={Boolean(blocked)} title={blocked ?? undefined} className="min-w-0">
              <Check data-icon="inline-start" />
              <span className="truncate">Approve V{versionNo}</span>
              <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 font-mono text-[10px] sm:inline">A</kbd>
            </Button>
            <Button type="button" variant="outline" onClick={() => set({ request: true })} disabled={detail.checking} className="min-w-0">
              <MessageSquareWarning data-icon="inline-start" />
              <span className="truncate">Request changes</span>
              <kbd className="ml-1 hidden rounded border px-1 font-mono text-[10px] text-muted-foreground sm:inline">R</kbd>
            </Button>
            {blocked && <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:inline">{blocked}</span>}
          </>
        )}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!approved && !archived && (
                <DropdownMenuItem onSelect={() => set({ reject: true })} disabled={detail.checking}>
                  <XCircle /> Reject…
                </DropdownMenuItem>
              )}
              {approved && !archived && (
                <DropdownMenuItem onSelect={() => set({ withdraw: true })}>
                  <Undo2 /> Withdraw approval…
                </DropdownMenuItem>
              )}
              {canArchive && (
                <DropdownMenuItem onSelect={() => set({ archive: true })}>
                  <Archive /> Archive…
                </DropdownMenuItem>
              )}
              {archived && (
                <DropdownMenuItem
                  disabled={unarchiving}
                  onSelect={() =>
                    startUnarchive(async () => {
                      const res = await unarchiveAd(detail.id);
                      if (!res.ok) toast.error(res.error);
                      else toast.success("Back from the archive");
                    })
                  }
                >
                  <ArchiveRestore /> Unarchive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={simulating || detail.checking}
                onSelect={() =>
                  startSimulate(async () => {
                    const res = await simulateRevision(detail.id);
                    if (!res.ok) toast.error(res.error);
                    else toast.success(`V${res.data.versionNo} arrived. Checking it now.`);
                  })
                }
              >
                <MailCheck /> Simulate revision from Gmail <span className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">demo</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Sheet open={dialogs.approve} onOpenChange={(o) => set({ approve: o })}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-lg" aria-describedby="approve-desc">
          {dialogs.approve && <ApproveForm detail={detail} userId={userId} onClose={() => set({})} onDone={afterDecision} />}
        </SheetContent>
      </Sheet>
      <Sheet open={dialogs.request} onOpenChange={(o) => set({ request: o })}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-lg" aria-describedby="request-desc">
          {dialogs.request && <RequestChangesForm detail={detail} onClose={() => set({})} onDone={afterDecision} />}
        </SheetContent>
      </Sheet>
      <Dialog open={dialogs.reject} onOpenChange={(o) => set({ reject: o })}>
        <DialogContent>{dialogs.reject && <RejectForm detail={detail} onClose={() => set({})} onDone={afterDecision} />}</DialogContent>
      </Dialog>
      <Dialog open={dialogs.withdraw} onOpenChange={(o) => set({ withdraw: o })}>
        <DialogContent>{dialogs.withdraw && <WithdrawForm assetId={detail.id} onClose={() => set({})} />}</DialogContent>
      </Dialog>
      <Dialog open={dialogs.archive} onOpenChange={(o) => set({ archive: o })}>
        <DialogContent>{dialogs.archive && <ArchiveForm detail={detail} onClose={() => set({})} />}</DialogContent>
      </Dialog>
    </div>
  );
}
