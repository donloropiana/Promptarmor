"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { acceptInvitation, type ActionResult } from "@/lib/actions/profiles";

type State = ActionResult<{ profileId: string }> | null;

export function AcceptInviteForm({ token, label }: { token: string; label: string }) {
  const [state, action, pending] = useActionState<State, FormData>(
    (_prev, formData) => acceptInvitation(formData),
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : null}
        {label}
      </Button>
      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error}
            {state.hint ? ` ${state.hint}.` : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
