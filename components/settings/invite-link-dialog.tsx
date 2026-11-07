"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { CopyButton } from "./copy-button";

/**
 * Shows an invitation link once. The app sends no email of its own, so the
 * owner copies the link and sends it however they like.
 */
export function InviteLinkDialog({
  open,
  onOpenChange,
  email,
  inviteUrl,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  inviteUrl: string;
  message?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitation link for {email}</DialogTitle>
          <DialogDescription>
            {message ?? "Copy this link and send it to them. It works for 7 days and only for that email address."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Invitation link" />
          <CopyButton text={inviteUrl} size="default" />
        </div>
        <DialogFooter>
          <p className="text-xs text-muted-foreground">This link is shown once. Use “Send again” later to make a new one.</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
