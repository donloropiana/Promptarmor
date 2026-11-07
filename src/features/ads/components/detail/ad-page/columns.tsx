"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

/**
 * The ad page's two columns, creative and review: side by side and resizable
 * from 768px, stacked below that. Owns where the pinned hidden-text alert
 * goes: atop the review column on a desktop, before the creative when stacked.
 */

function subscribeMedia(cb: () => void) {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useIsDesktop = () =>
  useSyncExternalStore(
    subscribeMedia,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false,
  );

export function AdColumns({ creative, review, alert, hasAlerts }: { creative: ReactNode; review: ReactNode; alert: ReactNode; hasAlerts: boolean }) {
  const isDesktop = useIsDesktop();

  const left = <div className="min-w-0 p-4 sm:p-5">{creative}</div>;
  const right = (
    <div className="min-w-0 space-y-4 p-4 sm:p-5">
      {isDesktop && alert}
      {review}
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
      {isDesktop ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-[60vh]">
          <ResizablePanel defaultSize="55%" minSize="32%">
            {left}
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="Resize columns" />
          <ResizablePanel defaultSize="45%" minSize="32%">
            {right}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        // A flex column, not an auto grid track: an unbreakable 400-character word would widen an auto track past the phone.
        <div className="flex min-w-0 flex-col">
          {/* Stacked: the pinned alert comes first, before the creative, so it is never below the fold. */}
          {hasAlerts && <div className="p-4 pb-0 sm:p-5 sm:pb-0">{alert}</div>}
          {left}
          <div className="border-t">{right}</div>
        </div>
      )}
    </div>
  );
}
