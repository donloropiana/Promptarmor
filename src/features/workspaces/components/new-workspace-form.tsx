"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import { createWorkspace } from "@/features/workspaces/server/create-workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { acceptInvitationById } from "@/features/workspaces/server/actions";
import type { PendingInvitation } from "@/features/workspaces/server/queries";

import { shortDate } from "@/lib/format";

type State = { error?: string } | null;

/** "Create a workspace" form. On success the action redirects to /ads. */
export function NewWorkspaceForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(async (_prev, fd) => {
    const res = await createWorkspace(fd);
    // createWorkspace redirects on success, so only failures reach here.
    return res.ok ? null : { error: res.error };
  }, null);

  return (
    <form action={action}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
          <Input
            id="ws-name"
            name="name"
            required
            maxLength={80}
            autoComplete="organization"
            placeholder="ClearPath Financial"
            autoFocus={autoFocus}
          />
          <FieldDescription>Usually your company or team. Starter rules and sample product terms are added for you.</FieldDescription>
        </Field>
        {state?.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? <Spinner /> : null}
          Create workspace
        </Button>
      </FieldGroup>
    </form>
  );
}

/** Invitations waiting for the signed-in user, each with an Accept button. */
export function PendingInvitationsList({ invitations }: { invitations: PendingInvitation[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (invitations.length === 0) return null;

  function accept(inv: PendingInvitation) {
    setBusy(inv.invitationId);
    startTransition(async () => {
      const res = await acceptInvitationById({ invitationId: inv.invitationId });
      setBusy(null);
      if (!res.ok) {
        toast.error("Couldn't accept the invitation", { description: res.error });
        return;
      }
      toast.success(`Welcome to ${inv.profileName}`);
      router.push("/ads");
    });
  }

  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {invitations.map((inv) => (
        <li key={inv.invitationId} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0 flex-col">
            <p className="truncate text-sm font-medium">{inv.profileName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {inv.invitedByName ?? inv.invitedByEmail ?? "A member"} invited you as {inv.role === "owner" ? "an owner" : "a member"} · expires{" "}
              {shortDate(inv.expiresAt)}
            </p>
          </div>
          <Button size="sm" onClick={() => accept(inv)} disabled={busy !== null}>
            {busy === inv.invitationId ? <Spinner /> : null}
            Accept
          </Button>
        </li>
      ))}
    </ul>
  );
}
