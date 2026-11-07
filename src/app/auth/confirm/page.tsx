import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthShell, AuthShellSkeleton } from "@/features/auth/components/auth-shell";
import { safeNextPath } from "@/features/auth/redirect";

import { ConfirmForm } from "@/features/auth/components/confirm-form";

export const metadata: Metadata = {
  title: "Continue sign-in",
  // The URL carries a one-time token; never leak it via Referer.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TYPES = {
  email: { title: "Finish signing in", label: "Continue" },
  magiclink: { title: "Finish signing in", label: "Continue" },
  signup: { title: "Confirm your email", label: "Confirm and continue" },
  invite: { title: "You're invited", label: "Continue" },
  recovery: { title: "Reset your password", label: "Continue to reset password" },
  email_change: { title: "Confirm your new email", label: "Confirm email change" },
} as const;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Landing page for every Supabase auth email link:
 *   /auth/confirm?token_hash=...&type=email|signup|invite|recovery|email_change&next=...
 *
 * GET never spends the token (email security scanners prefetch links). The
 * user clicks Continue, which POSTs to the confirmEmailLink Server Action.
 */
export default function ConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <ConfirmContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ConfirmContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tokenHash = first(sp.token_hash)?.trim() ?? "";
  const rawType = first(sp.type) ?? "";
  const next = safeNextPath(first(sp.next));

  const known = Object.prototype.hasOwnProperty.call(TYPES, rawType);
  if (!tokenHash || !known) {
    return (
      <AuthShell
        title="Link not recognized"
        description="This sign-in link is incomplete or malformed."
        footer={
          <Link href="/signin" className="underline underline-offset-4">
            Back to sign in
          </Link>
        }
      />
    );
  }

  const copy = TYPES[rawType as keyof typeof TYPES];
  return (
    <AuthShell
      title={copy.title}
      description="For your security, confirm it's you to continue. Links work once and expire."
      footer={
        <span>
          Didn&apos;t request this? You can close this page.{" "}
          <Link href="/signin" className="underline underline-offset-4">
            Sign in another way
          </Link>
        </span>
      }
    >
      <ConfirmForm tokenHash={tokenHash} type={rawType} next={next} label={copy.label} />
    </AuthShell>
  );
}
