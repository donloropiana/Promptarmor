import type { ReactNode } from "react";

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { ProfileSummary } from "@/lib/auth/dal";

import { AppSidebar, type ShellUser } from "./app-sidebar";
import { NotificationsBell } from "./notifications-bell";
import { SidebarReopen } from "./sidebar-reopen";
import { Wordmark } from "./wordmark";

/**
 * The signed-in frame: sidebar on the left (a sheet on phones), a slim top
 * bar on phones only, and the page in the middle with 16px side gutters.
 */
export function AppShell({
  user,
  profiles,
  activeProfileId,
  sidebarOpen = true,
  children,
}: {
  user: ShellUser;
  profiles: ProfileSummary[];
  activeProfileId: string;
  sidebarOpen?: boolean;
  children: ReactNode;
}) {
  const active = profiles.find((p) => p.id === activeProfileId);
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar user={user} profiles={profiles} activeProfileId={activeProfileId} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
          <SidebarTrigger aria-label="Open menu" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{active?.name ?? <Wordmark />}</span>
          <NotificationsBell />
        </header>
        <SidebarReopen />
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-4 md:px-6 md:py-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
