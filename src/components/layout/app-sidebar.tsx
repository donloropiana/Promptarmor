"use client";

import {
  BookOpenCheckIcon,
  CompassIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  FilesIcon,
  LogOutIcon,
  PlugZapIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { setActiveProfile } from "@/features/workspaces/server/actions";
import type { ProfileSummary } from "@/features/auth/server/dal";

import { initials } from "@/lib/format";
import { NotificationsBell } from "./notifications-bell";

export type ShellUser = { id: string; name: string | null; email: string | null };

const NAV = [
  { href: "/ads", label: "Ads", icon: FilesIcon },
  { href: "/rules", label: "Rules", icon: BookOpenCheckIcon },
  { href: "/get-started", label: "Get started", icon: CompassIcon },
] as const;

const WORKSPACE_MENU = [
  { href: "/settings/members", label: "Members", icon: UsersIcon },
  { href: "/settings/accounts", label: "Connected accounts", icon: PlugZapIcon },
  { href: "/settings/workspace", label: "Workspace", icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Compact sidebar: workspace switcher on top, Ads and Rules in the middle,
 * the workspace menu (Members, Connected accounts, Workspace, Sign out) at
 * the bottom. On phones it collapses into a sheet opened from the top bar.
 */
export function AppSidebar({
  user,
  profiles,
  activeProfileId,
}: {
  user: ShellUser;
  profiles: ProfileSummary[];
  activeProfileId: string;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="flex-row items-center gap-1 p-2">
        <WorkspaceSwitcher profiles={profiles} active={active} />
        <NotificationsBell className="shrink-0" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const current = isActive(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={current}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <WorkspaceMenu user={user} workspaceName={active?.name ?? "Workspace"} pathname={pathname} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function WorkspaceSwitcher({ profiles, active }: { profiles: ProfileSummary[]; active: ProfileSummary | undefined }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [pending, startTransition] = useTransition();

  function switchTo(profileId: string) {
    if (profileId === active?.id) return;
    startTransition(async () => {
      const res = await setActiveProfile({ profileId });
      if (!res.ok) {
        toast.error("Couldn't switch workspace", { description: res.error });
        return;
      }
      setOpenMobile(false);
      router.push("/ads");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="h-10 flex-1 min-w-0 data-[state=open]:bg-sidebar-accent"
          aria-label={`Workspace: ${active?.name ?? "none"}. Switch workspace`}
          disabled={pending}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            {initials(active?.name ?? "W")}
          </span>
          <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
            <span className="truncate text-sm font-medium">{active?.name ?? "Workspace"}</span>
            <span className="truncate text-xs text-muted-foreground">{active?.role === "owner" ? "Owner" : "Member"}</span>
          </span>
          <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        {profiles.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => switchTo(p.id)} className="gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold">
              {initials(p.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.id === active?.id ? <CheckIcon className="size-4 text-muted-foreground" aria-label="Current" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/new-workspace" onClick={() => setOpenMobile(false)}>
            <PlusIcon />
            New workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceMenu({ user, workspaceName, pathname }: { user: ShellUser; workspaceName: string; pathname: string }) {
  const { setOpenMobile } = useSidebar();
  const signOutForm = useRef<HTMLFormElement>(null);
  const label = user.name ?? user.email ?? "You";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="h-10 data-[state=open]:bg-sidebar-accent"
            aria-label={`Signed in as ${label}. Workspace menu`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {initials(user.name, user.email)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate text-sm">{label}</span>
              {user.name && user.email ? <span className="truncate text-xs text-muted-foreground">{user.email}</span> : null}
            </span>
            <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
          <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{workspaceName}</DropdownMenuLabel>
          {WORKSPACE_MENU.map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <Link
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                onClick={() => setOpenMobile(false)}
              >
                <item.icon />
                {item.label}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={signOutForm} method="post" action="/auth/signout" className="hidden" aria-hidden="true">
        <button type="submit" tabIndex={-1}>
          Sign out
        </button>
      </form>
    </>
  );
}
