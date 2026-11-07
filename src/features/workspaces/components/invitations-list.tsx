"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { shortDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { reissueInvitation, revokeInvitation, type InviteResult } from "@/features/workspaces/server/actions";
import type { InvitationRow } from "@/features/workspaces/server/queries";

import { InviteLinkDialog } from "./invite-link-dialog";

/** Pending invitations with Send again (new link) and Revoke. Owners only. */
export function InvitationsList({ invitations }: { invitations: InvitationRow[] }) {
  const [busy, setBusy] = useState<{ id: string; what: "reissue" | "revoke" } | null>(null);
  const [link, setLink] = useState<InviteResult | null>(null);
  const [, startTransition] = useTransition();

  if (invitations.length === 0) {
    return <p className="text-sm text-muted-foreground">No pending invitations.</p>;
  }

  function reissue(inv: InvitationRow) {
    setBusy({ id: inv.id, what: "reissue" });
    startTransition(async () => {
      const res = await reissueInvitation({ invitationId: inv.id });
      setBusy(null);
      if (!res.ok) {
        toast.error("Couldn't make a new link", { description: res.error });
        return;
      }
      setLink(res.data);
    });
  }

  function revoke(inv: InvitationRow) {
    setBusy({ id: inv.id, what: "revoke" });
    startTransition(async () => {
      const res = await revokeInvitation({ invitationId: inv.id });
      setBusy(null);
      if (!res.ok) {
        toast.error("Couldn't revoke the invitation", { description: res.error });
        return;
      }
      toast.success(`Invitation for ${inv.email} revoked`);
    });
  }

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {invitations.map((inv) => {
          const isBusy = busy?.id === inv.id;
          return (
            <li key={inv.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm">{inv.email}</span>
                  <Badge variant="outline">{inv.role === "owner" ? "Owner" : "Member"}</Badge>
                  {inv.expired ? <Badge variant="secondary">Expired</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Invited {shortDate(inv.createdAt)}
                  {inv.invitedByName ? ` by ${inv.invitedByName}` : ""} · {inv.expired ? "expired" : "expires"} {shortDate(inv.expiresAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => reissue(inv)} disabled={isBusy}>
                  {isBusy && busy?.what === "reissue" ? <Spinner /> : null}
                  Send again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => revoke(inv)} disabled={isBusy}>
                  {isBusy && busy?.what === "revoke" ? <Spinner /> : null}
                  Revoke
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {link ? (
        <InviteLinkDialog
          open
          onOpenChange={(open) => {
            if (!open) setLink(null);
          }}
          email={link.email}
          inviteUrl={link.inviteUrl}
          message="A new link for 7 days. The old one no longer works."
        />
      ) : null}
    </>
  );
}
