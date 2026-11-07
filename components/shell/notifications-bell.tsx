"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceEvent } from "@/lib/data/workspace";

import { timeAgo } from "./format";
import { fetchRecentEvents } from "./notifications-actions";

/**
 * In-app notifications: the last 10 workspace events in plain English.
 * Loaded when opened (one server action), never on page load.
 */
export function NotificationsBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<WorkspaceEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await fetchRecentEvents();
      if (res.ok) setEvents(res.events);
      else setError(res.error);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="Activity">
          <BellIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Activity</p>
          <p className="text-xs text-muted-foreground">Last 10 events</p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading && events === null ? (
            <ul className="flex flex-col gap-3 p-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-16" />
                </li>
              ))}
            </ul>
          ) : error ? (
            <div className="flex flex-col items-start gap-2 p-3 text-sm">
              <p className="text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={load}>
                Try again
              </Button>
            </div>
          ) : events && events.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nothing yet. Decisions, revisions and finished checks show up here.</p>
          ) : (
            <ul className="divide-y">
              {(events ?? []).map((e) => {
                const inner = (
                  <>
                    <p className="text-sm leading-snug">{e.text}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{timeAgo(e.createdAt)}</p>
                  </>
                );
                return (
                  <li key={e.id}>
                    {e.href ? (
                      <Link
                        href={e.href}
                        onClick={() => setOpen(false)}
                        className="flex flex-col gap-0.5 px-3 py-2 outline-none hover:bg-muted focus-visible:bg-muted"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex flex-col gap-0.5 px-3 py-2">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
