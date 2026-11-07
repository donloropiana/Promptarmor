"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { confirmEmailLink, type ConfirmState } from "@/features/auth/server/confirm";

export function ConfirmForm({
  tokenHash,
  type,
  next,
  label,
}: {
  tokenHash: string;
  type: string;
  next: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(
    confirmEmailLink,
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? <Spinner /> : null}
          {label}
        </Button>
      </form>
      {state?.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error}{" "}
            <Link href="/signin" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
