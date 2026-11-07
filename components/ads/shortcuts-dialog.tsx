"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type Shortcut = { keys: string[]; label: string };

export const LIST_SHORTCUTS: Shortcut[] = [
  { keys: ["J"], label: "Next ad" },
  { keys: ["K"], label: "Previous ad" },
  { keys: ["Enter"], label: "Open the focused ad" },
  { keys: ["?"], label: "Show shortcuts" },
];

export const AD_SHORTCUTS: Shortcut[] = [
  { keys: ["A"], label: "Approve this version" },
  { keys: ["R"], label: "Request changes" },
  { keys: ["X"], label: "Not a problem (selected issue)" },
  { keys: ["J", "K"], label: "Move between issues" },
  { keys: ["Esc"], label: "Clear selection / close" },
  { keys: ["?"], label: "Show shortcuts" },
];

export function ShortcutsDialog({ open, onOpenChange, shortcuts }: { open: boolean; onOpenChange: (o: boolean) => void; shortcuts: Shortcut[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>They work whenever you are not typing in a field.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {shortcuts.map((s) => (
            <div key={s.label} className="contents">
              <dt className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted px-1.5 font-mono text-xs text-foreground">
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{s.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/** True when a keydown should be ignored because the user is typing. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || Boolean(el.closest("[role=dialog]"));
}
