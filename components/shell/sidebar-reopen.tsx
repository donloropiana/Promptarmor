"use client";

import { PanelLeftOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Shown on desktop only while the sidebar is collapsed (Cmd/Ctrl+B, or a
 * saved collapsed state), so the collapse is always recoverable without
 * knowing the shortcut. Phones use the top bar's "Open menu" instead.
 */
export function SidebarReopen() {
  const { state, isMobile, toggleSidebar } = useSidebar();
  if (isMobile || state !== "collapsed") return null;
  return (
    <div className="sticky top-0 z-20 hidden h-12 items-center border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:flex">
      <Button variant="ghost" size="sm" onClick={toggleSidebar} aria-label="Show sidebar" title="Show sidebar (Ctrl/Cmd+B)">
        <PanelLeftOpenIcon />
        Show sidebar
      </Button>
    </div>
  );
}
