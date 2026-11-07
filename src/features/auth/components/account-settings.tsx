"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateDisplayName, updateEmail, updatePassword } from "@/features/auth/server/account";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

/** Display name (user_metadata.full_name). */
export function NameForm({ initialName }: { initialName: string }) {
  const [saved, setSaved] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = name.trim().length > 0 && name.trim() !== saved;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateDisplayName({ name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(name.trim());
      toast.success(res.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="flex-1 sm:max-w-sm">
          <FieldLabel htmlFor="account-name">Name</FieldLabel>
          <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
        </Field>
        <Button type="submit" disabled={pending || !changed}>
          {pending ? <Spinner /> : null}
          Save
        </Button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

/** Sign-in email. The new address must confirm by link before it takes effect. */
export function EmailForm({ currentEmail, pendingEmail }: { currentEmail: string; pendingEmail: string | null }) {
  const [email, setEmail] = useState(currentEmail);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = email.trim().length > 0 && email.trim().toLowerCase() !== currentEmail.toLowerCase();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSent(null);
    startTransition(async () => {
      const res = await updateEmail({ email });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent(res.message);
      toast.success("Check your new inbox");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="flex-1 sm:max-w-sm">
          <FieldLabel htmlFor="account-email">Email</FieldLabel>
          <Input
            id="account-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={320}
            autoComplete="email"
            spellCheck={false}
            required
          />
          {pendingEmail && !sent ? (
            <FieldDescription>
              Waiting for confirmation from <span className="break-all font-medium text-foreground">{pendingEmail}</span>. Open the link we sent there, or
              save another address.
            </FieldDescription>
          ) : null}
        </Field>
        <Button type="submit" disabled={pending || !changed}>
          {pending ? <Spinner /> : null}
          Change email
        </Button>
      </div>
      {sent ? (
        <Alert>
          <AlertDescription className="break-words">{sent}</AlertDescription>
        </Alert>
      ) : null}
      <ErrorNote error={error} />
    </form>
  );
}

/** New password + confirmation. */
export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = password.length >= 8 && confirm.length >= 8;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updatePassword({ password, confirm });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPassword("");
      setConfirm("");
      toast.success(res.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:max-w-sm">
      <Field>
        <FieldLabel htmlFor="account-new-password">New password</FieldLabel>
        <Input
          id="account-new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="account-confirm-password">Confirm new password</FieldLabel>
        <Input
          id="account-confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
      </Field>
      <ErrorNote error={error} />
      <div>
        <Button type="submit" disabled={pending || !ready}>
          {pending ? <Spinner /> : null}
          Change password
        </Button>
      </div>
    </form>
  );
}
