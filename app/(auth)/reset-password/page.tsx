import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthShell, AuthShellSkeleton } from "@/components/auth/auth-shell";
import { getCurrentUser } from "@/lib/auth/dal";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

/**
 * Reached after /auth/confirm verifies a recovery link (type=recovery),
 * which leaves the user signed in with a recovery session.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

async function ResetPasswordContent() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <AuthShell
        title="Reset link expired"
        description="Open the latest reset email, or request a new link."
        footer={
          <Link href="/signin" className="underline underline-offset-4">
            Back to sign in
          </Link>
        }
      />
    );
  }
  return (
    <AuthShell title="Choose a new password" description={user.email ? `For ${user.email}` : undefined}>
      <ResetPasswordForm />
    </AuthShell>
  );
}
