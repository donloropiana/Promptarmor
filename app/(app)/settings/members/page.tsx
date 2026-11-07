import type { Metadata } from "next";
import { Suspense } from "react";

import { InvitationsList } from "@/components/settings/invitations-list";
import { InviteForm } from "@/components/settings/invite-form";
import { MembersList } from "@/components/settings/members-list";
import { Section } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/shell-skeleton";
import { getActiveProfileId, requireMember } from "@/lib/auth/dal";
import { getMembers, getPendingInvitations } from "@/lib/data/workspace";

export const metadata: Metadata = { title: "Members · Marketing Compliance Workbench" };
// Reads the session (see app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

export default function MembersPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <MembersContent />
    </Suspense>
  );
}

async function MembersContent() {
  const profileId = await getActiveProfileId();
  if (!profileId) return null;
  const membership = await requireMember(profileId, "/settings/members");
  const [members, invitations] = await Promise.all([getMembers(profileId), getPendingInvitations(profileId)]);
  const isOwner = membership.role === "owner";

  return (
    <>
      <Section
        title={`Members · ${members.length}`}
        description="Everyone here can review and approve ads. Owners can also invite, remove and change roles."
      >
        <MembersList profileId={profileId} members={members} me={membership.user.id} myRole={membership.role} />
      </Section>

      {isOwner ? (
        <>
          <Section title="Invite someone" description="They sign in with the same email, then accept. You'll get a link to send them.">
            <InviteForm profileId={profileId} />
          </Section>
          <Section
            title={`Pending invitations${invitations.length ? ` · ${invitations.length}` : ""}`}
            description="Links work for 7 days. “Send again” makes a fresh link and expires the old one."
          >
            <InvitationsList invitations={invitations} />
          </Section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Only owners can invite people or change roles. Ask an owner if you need someone added.</p>
      )}
    </>
  );
}
