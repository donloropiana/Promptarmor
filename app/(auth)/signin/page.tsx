import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthShellSkeleton } from "@/components/auth/auth-shell";
import { getCurrentUser } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/auth/redirect";

import { SignInForm } from "./signin-form";

export const metadata: Metadata = {
  title: "Sign in · Marketing Compliance Workbench",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ERRORS: Record<string, string> = {
  link_expired: "That link is invalid or has expired. Send a new one.",
  callback: "We couldn't complete sign-in. Try again.",
  config: "Sign-in isn't configured on this deployment yet.",
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SignInContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNextPath(first(sp.next));

  // Already signed in: go where they were headed.
  if (await getCurrentUser()) redirect(next);

  const errorCode = first(sp.error);
  return (
    <SignInForm
      next={next}
      errorMessage={errorCode ? (ERRORS[errorCode] ?? ERRORS.callback) : undefined}
      invited={next.startsWith("/invite/")}
    />
  );
}
