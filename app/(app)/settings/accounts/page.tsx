import { EyeIcon, FilterIcon, HistoryIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ConnectButtons } from "@/components/connections/connect-buttons";
import { ConnectionsByMember } from "@/components/settings/accounts";
import { SyncLogSheet } from "@/components/settings/sync-log-sheet";
import { Section } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/shell-skeleton";
import { getActiveProfileId, requireMember } from "@/lib/auth/dal";
import { getConnectionsByMember, getMyConnectedIntegrations, getSyncRuns } from "@/lib/data/workspace";

export const metadata: Metadata = { title: "Connected accounts · Marketing Compliance Workbench" };
// Reads the session (see app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

export default function AccountsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <AccountsContent />
    </Suspense>
  );
}

const PROMISES = [
  { icon: EyeIcon, text: "Reads only. We never send, move or change anything." },
  { icon: HistoryIcon, text: "Looks back 14 days, then watches for new mail and files." },
  { icon: FilterIcon, text: "Keeps only ads. Everything else is skipped and its text is not stored." },
  { icon: LockIcon, text: "Google will list wider permissions than we use; our code blocks those." },
] as const;

async function AccountsContent() {
  const profileId = await getActiveProfileId();
  if (!profileId) return null;
  const membership = await requireMember(profileId, "/settings/accounts");
  const [groups, runs, mine] = await Promise.all([
    getConnectionsByMember(profileId),
    getSyncRuns(profileId, 50),
    getMyConnectedIntegrations(membership),
  ]);
  const total = groups.reduce((n, g) => n + g.connections.length, 0);

  return (
    <>
      <Section
        title="Connect your accounts"
        description="Ads people email you or share with you arrive here on their own. Each member connects their own accounts; they feed this workspace."
      >
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {PROMISES.map((p) => (
              <li key={p.text} className="flex items-start gap-2 text-sm">
                <p.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <ConnectButtons profileId={profileId} connectedIntegrations={mine} />
            <p className="text-xs text-muted-foreground">
              One click each. Google asks twice (Gmail, then Drive); Microsoft asks for Outlook, then OneDrive.
            </p>
          </div>
        </div>
      </Section>

      <Section
        title={total === 0 ? "Connected accounts" : `Connected accounts · ${total}`}
        description={total === 0 ? undefined : "Listed by the member who connected them."}
        actions={total > 0 ? <SyncLogSheet runs={runs} /> : undefined}
      >
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing connected yet. Connect an account above, or drop an ad on the Ads page to check one right away.
          </p>
        ) : (
          <ConnectionsByMember profileId={profileId} groups={groups} runs={runs} myRole={membership.role} />
        )}
      </Section>
    </>
  );
}
