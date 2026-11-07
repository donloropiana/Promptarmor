import type { Metadata } from "next";
import { Suspense } from "react";

import { AiCapCard, ClearSamplesButton, ExportAuditButton, WorkspaceNameForm } from "@/features/workspaces/components/workspace-settings";
import { shortDate } from "@/lib/format";
import { Section } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { getActiveProfileId, requireMember } from "@/features/auth/server/dal";
import { getWorkspaceSettings } from "@/features/workspaces/server/queries";

export const metadata: Metadata = { title: "Workspace · Marketing Compliance Workbench" };
// Reads the session (see src/app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

export default function WorkspacePage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <WorkspaceContent />
    </Suspense>
  );
}

async function WorkspaceContent() {
  const profileId = await getActiveProfileId();
  if (!profileId) return null;
  await requireMember(profileId, "/settings/workspace");
  const settings = await getWorkspaceSettings(profileId);
  if (!settings) {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t load this workspace. Reload the page.</p>;
  }

  return (
    <>
      <Section title="Workspace" description={`Created ${shortDate(settings.createdAt)} · ${settings.memberCount} ${settings.memberCount === 1 ? "member" : "members"}`}>
        <WorkspaceNameForm settings={settings} />
      </Section>

      <Section title="AI daily cap" description="How much the AI checks may spend per day for this workspace.">
        <AiCapCard settings={settings} />
      </Section>

      <Section
        title="Sample ads"
        description={
          settings.sampleAdCount === 0
            ? "No sample ads in this workspace. Samples never count toward any number."
            : `${settings.sampleAdCount} sample ${settings.sampleAdCount === 1 ? "ad is" : "ads are"} in the Ads list. Samples never count toward any number.`
        }
      >
        <div>
          <ClearSamplesButton settings={settings} />
        </div>
      </Section>

      <Section title="Audit record" description="Every decision and every event, with who did what and when, as JSON you can copy into your records.">
        <div>
          <ExportAuditButton settings={settings} />
        </div>
      </Section>
    </>
  );
}
