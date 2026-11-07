"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/members", label: "Members" },
  { href: "/settings/accounts", label: "Connected accounts" },
  { href: "/settings/workspace", label: "Workspace" },
  { href: "/settings/account", label: "Your account" },
] as const;

/** Members | Connected accounts | Workspace | Your account, as a quiet underline nav. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-9 items-center border-b-2 px-3 text-sm outline-none transition-colors focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
