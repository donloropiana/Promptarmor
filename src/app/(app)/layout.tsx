import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { NoWorkspace } from "@/features/workspaces/components/no-workspace";
import { ShellSkeleton } from "@/components/layout/shell-skeleton";
import { getActiveProfileId, getMyProfiles, requireUser } from "@/features/auth/server/dal";
import { getMyPendingInvitations } from "@/features/workspaces/server/queries";
import { ensureWorkspaceDefaults } from "@/features/workspaces/server/seed";

/**
 * Signed-in frame for Ads, Rules, Settings and New workspace.
 *
 * The gate reads the session cookie, so it renders behind <Suspense> (Cache
 * Components). Signed out -> /signin. No workspace -> the create/accept
 * screen in place of the app (every route, so there is no redirect loop
 * between the layout and /new-workspace). Otherwise the sidebar shell.
 */

/**
 * The gate verifies the session against a real request (and redirects when
 * signed out), so this segment blocks on the server by design. Opting out of
 * instant-navigation validation keeps the dev overlay from flagging it; pages
 * below still show their own Suspense skeletons while content streams.
 */
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppGate>{children}</AppGate>
    </Suspense>
  );
}

async function AppGate({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const profiles = await getMyProfiles();

  if (profiles.length === 0) {
    const invitations = await getMyPendingInvitations();
    return <NoWorkspace user={user} invitations={invitations} />;
  }

  // Cookie when valid, else the first membership (Server Components cannot
  // write cookies; setActiveProfile does that when the user switches).
  const activeProfileId = (await getActiveProfileId()) ?? profiles[0].id;

  // Idempotent and cheap (existence checks): starter rules + products for
  // workspaces created before the seed existed. Never blocks the page.
  try {
    await ensureWorkspaceDefaults(activeProfileId);
  } catch (err) {
    console.error("[app] ensureWorkspaceDefaults failed:", (err as Error).message);
  }

  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <AppShell
      user={{ id: user.id, name: user.fullName, email: user.email }}
      profiles={profiles}
      activeProfileId={activeProfileId}
      sidebarOpen={sidebarOpen}
    >
      {children}
    </AppShell>
  );
}
