import type { Metadata } from "next";
import { Suspense } from "react";

import { EmailForm, NameForm, PasswordForm } from "@/features/auth/components/account-settings";
import { Section } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { getCurrentUser } from "@/features/auth/server/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your account · Marketing Compliance Workbench" };
// Reads the session (see src/app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

export default function AccountPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <AccountContent />
    </Suspense>
  );
}

async function AccountContent() {
  const me = await getCurrentUser();
  if (!me) return null;

  // Ask Auth directly: the token's claims can lag a just-saved name, and only
  // Auth knows about an email change still waiting for its confirmation link.
  let fullName = me.fullName ?? "";
  let email = me.email ?? "";
  let pendingEmail: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.full_name === "string") fullName = meta.full_name;
      email = data.user.email ?? email;
      pendingEmail = data.user.new_email ?? null;
    }
  } catch (err) {
    console.error("[account] getUser failed:", (err as Error).message);
  }

  return (
    <>
      <Section title="Name" description="Shown to your teammates in Members and next to everything you do in the audit record.">
        <NameForm initialName={fullName} />
      </Section>

      <Section title="Email" description="The address you sign in with. Invitations to workspaces are sent here.">
        <EmailForm currentEmail={email} pendingEmail={pendingEmail} />
      </Section>

      <Section title="Password" description="At least 8 characters. You can still sign in with an emailed link or code.">
        <PasswordForm />
      </Section>
    </>
  );
}
