"use client";

import { useActionState, useState, type ReactNode } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { Wordmark } from "@/components/shell/wordmark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  requestPasswordReset,
  sendEmailCode,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailCode,
  type AuthFormState,
} from "./actions";

export function SignInForm({
  next,
  errorMessage,
  invited,
}: {
  next: string;
  errorMessage?: string;
  invited?: boolean;
}) {
  return (
    <AuthShell
      brand={<Wordmark />}
      title={invited ? "Sign in to accept your invitation" : "Sign in"}
      description={
        invited
          ? "Use the email address the invitation was sent to."
          : "Review every ad before it runs. New here? Sign in with your work email and we'll create your account."
      }
      footer="By continuing you agree to use this workspace for authorized review work only."
    >
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="email">
        <TabsList className="w-full">
          <TabsTrigger value="email">Email link or code</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="pt-2">
          <EmailOtpPanel next={next} />
        </TabsContent>
        <TabsContent value="password" className="pt-2">
          <PasswordPanel next={next} />
        </TabsContent>
      </Tabs>
    </AuthShell>
  );
}

function FormMessage({ state }: { state: AuthFormState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  }
  if (state.message) {
    return (
      <Alert>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function SubmitButton({
  pending,
  children,
  variant = "default",
}: {
  pending: boolean;
  children: ReactNode;
  variant?: "default" | "outline" | "ghost" | "link";
}) {
  return (
    <Button type="submit" size="lg" variant={variant} className="w-full" disabled={pending}>
      {pending ? <Spinner /> : null}
      {children}
    </Button>
  );
}

/** Magic link + 6-digit code. One email carries both. */
function EmailOtpPanel({ next }: { next: string }) {
  const [sendState, sendAction, sending] = useActionState<AuthFormState, FormData>(
    sendEmailCode,
    null,
  );
  // "Use a different email" hides the current code step until the next send.
  const [dismissed, setDismissed] = useState<AuthFormState>(null);
  const codeStep = sendState?.ok && sendState.step === "code" && sendState !== dismissed;

  if (codeStep && sendState?.email) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage state={sendState} />
        <CodeForm email={sendState.email} next={next} />
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setDismissed(sendState)}>
            Use a different email
          </Button>
          <form action={sendAction}>
            <input type="hidden" name="email" value={sendState.email} />
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="link" size="sm" className="px-0" disabled={sending}>
              {sending ? "Sending…" : "Resend email"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form action={sendAction}>
      <input type="hidden" name="next" value={next} />
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="otp-email">Work email</FieldLabel>
          <Input
            id="otp-email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            required
            defaultValue={sendState?.email ?? ""}
            placeholder="you@company.com"
          />
          <FieldDescription>We&apos;ll email you a sign-in link. Open it on this device.</FieldDescription>
        </Field>
        {sendState && !sendState.ok ? <FormMessage state={sendState} /> : null}
        <SubmitButton pending={sending}>Email me a sign-in link</SubmitButton>
      </FieldGroup>
    </form>
  );
}

/** 6-digit code entry; shared by email sign-in and password sign-up confirmation. */
function CodeForm({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(verifyEmailCode, null);
  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`code-${email}`}>Got a code in the email? Enter it here</FieldLabel>
          <Input
            id={`code-${email}`}
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            pattern="[0-9 ]{6,12}"
            maxLength={12}
            required
            placeholder="123456"
            className="font-mono tracking-widest"
          />
          <FieldDescription>Or open the link in the email on this device.</FieldDescription>
        </Field>
        <FormMessage state={state} />
        <SubmitButton pending={pending}>Verify code</SubmitButton>
      </FieldGroup>
    </form>
  );
}

type PasswordMode = "signin" | "signup" | "forgot";

function PasswordPanel({ next }: { next: string }) {
  const [mode, setMode] = useState<PasswordMode>("signin");
  return (
    <div className="flex flex-col gap-3">
      {mode === "signin" ? <PasswordSignIn next={next} /> : null}
      {mode === "signup" ? <PasswordSignUp next={next} /> : null}
      {mode === "forgot" ? <ForgotPassword /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {mode !== "signin" ? (
          <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setMode("signin")}>
            Back to password sign-in
          </Button>
        ) : (
          <>
            <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setMode("forgot")}>
              Forgot password?
            </Button>
            <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setMode("signup")}>
              Create an account
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PasswordSignIn({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInWithPassword, null);
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="pw-email">Email</FieldLabel>
          <Input id="pw-email" name="email" type="email" autoComplete="email" spellCheck={false} required defaultValue={state?.email ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="pw-password">Password</FieldLabel>
          <Input id="pw-password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </FieldGroup>
    </form>
  );
}

function PasswordSignUp({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUpWithPassword, null);
  if (state?.ok && state.step === "code" && state.email) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage state={state} />
        <CodeForm email={state.email} next={next} />
      </div>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="su-email">Email</FieldLabel>
          <Input id="su-email" name="email" type="email" autoComplete="email" spellCheck={false} required defaultValue={state?.email ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="su-password">Password</FieldLabel>
          <Input id="su-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
          <FieldDescription>At least 8 characters. You&apos;ll confirm your email before signing in.</FieldDescription>
        </Field>
        <FormMessage state={state} />
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </FieldGroup>
    </form>
  );
}

function ForgotPassword() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestPasswordReset, null);
  return (
    <form action={action}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="fp-email">Email</FieldLabel>
          <Input id="fp-email" name="email" type="email" autoComplete="email" spellCheck={false} required defaultValue={state?.email ?? ""} />
          <FieldDescription>We&apos;ll email you a link to choose a new password.</FieldDescription>
        </Field>
        <FormMessage state={state} />
        <SubmitButton pending={pending}>Send reset link</SubmitButton>
      </FieldGroup>
    </form>
  );
}
