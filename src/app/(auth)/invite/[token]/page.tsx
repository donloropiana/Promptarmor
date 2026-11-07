import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthShell, AuthShellSkeleton } from "@/features/auth/components/auth-shell";
import { shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/features/auth/server/dal";
import { signInPath } from "@/features/auth/redirect";
import { getSupabaseContext } from "@/lib/supabase/context";
import type { PeekInvitationRow } from "@/lib/supabase/types";

import { AcceptInviteForm } from "@/features/workspaces/components/accept-invite-form";

export const metadata: Metadata = {
  title: "Invitation",
  // The path carries the invitation token; never leak it via Referer.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type Params = Promise<{ token: string }>;

/**
 * /invite/<64-hex token>
 *
 * Signed out -> /signin?next=/invite/<token> (peek_invitation needs a user).
 * Signed in  -> peek_invitation renders who invited you to what; an explicit
 * Accept calls accept_invitation, which requires the user's VERIFIED email
 * to match the invitation email.
 */
export default function InvitePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <InviteContent params={params} />
    </Suspense>
  );
}

function BackHome({ label = "Go to the app" }: { label?: string }) {
  return (
    <Link href="/" className="underline underline-offset-4">
      {label}
    </Link>
  );
}

function SignOutAndReturn({ token }: { token: string }) {
  return (
    <form method="post" action="/auth/signout">
      <input type="hidden" name="next" value={`/invite/${token}`} />
      <Button type="submit" variant="outline" size="lg" className="w-full">
        Sign out and switch account
      </Button>
    </form>
  );
}

async function InviteContent({ params }: { params: Params }) {
  const { token: rawToken } = await params;
  const token = (rawToken ?? "").toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return (
      <AuthShell
        title="Invitation not found"
        description="This invitation link is not valid. Check that you copied the whole link."
        footer={<BackHome />}
      />
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect(signInPath(`/invite/${token}`));

  const ctx = await getSupabaseContext();
  if (!ctx) redirect(signInPath(`/invite/${token}`));

  const { data, error } = await ctx.supabase.rpc("peek_invitation", { p_token: token });
  if (error) console.error("[invite] peek failed:", error.code);
  const row = (Array.isArray(data) ? data[0] : data) as PeekInvitationRow | null | undefined;

  if (error || !row) {
    return (
      <AuthShell
        title="Invitation not found"
        description="This invitation doesn't exist or is no longer valid. Ask a workspace owner to send a new one."
        footer={<BackHome />}
      />
    );
  }

  const roleLabel = row.role === "owner" ? "Owner" : "Member";
  const inviter = row.invited_by_name?.trim() || "A workspace owner";

  if (row.status === "accepted") {
    return (
      <AuthShell
        title="Invitation already used"
        description={
          row.email_matches
            ? `You're already a member of ${row.profile_name}.`
            : "This invitation has already been accepted."
        }
        footer={<BackHome />}
      />
    );
  }
  if (row.status === "revoked") {
    return (
      <AuthShell
        title="Invitation revoked"
        description={`This invitation to ${row.profile_name} was revoked. Ask an owner to invite you again.`}
        footer={<BackHome />}
      />
    );
  }
  if (row.status === "expired") {
    return (
      <AuthShell
        title="Invitation expired"
        description={`This invitation to ${row.profile_name} has expired. Ask an owner to send it again.`}
        footer={<BackHome />}
      />
    );
  }

  if (!row.email_matches) {
    return (
      <AuthShell
        title="Wrong account"
        description={`This invitation was sent to ${row.masked_email}; you're signed in as ${user.email ?? "another account"}.`}
      >
        <SignOutAndReturn token={token} />
      </AuthShell>
    );
  }

  if (!row.email_verified) {
    return (
      <AuthShell
        title="Confirm your email first"
        description="Open the confirmation email we sent you (or sign in with an email code), then return to this link."
      >
        <SignOutAndReturn token={token} />
      </AuthShell>
    );
  }

  // Printed in the workspace time zone like every other date in the app.
  const expires = shortDate(row.expires_at);

  return (
    <AuthShell
      title={`Join ${row.profile_name}`}
      description={`${inviter} invited you to ${row.profile_name} as ${roleLabel}.`}
      footer={<span>Invitation for {row.masked_email} · expires {expires}</span>}
    >
      <AcceptInviteForm token={token} label={`Accept and join as ${roleLabel}`} />
    </AuthShell>
  );
}
