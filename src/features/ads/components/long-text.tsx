"use client";

import { cn } from "cn";
import { useId, useState } from "react";

/**
 * A note that can be 2,000 characters (an exception, a rationale) shows its
 * first lines and a "Show more" toggle, so the audit record stays readable
 * without hiding anything. Short text renders as a plain paragraph.
 */
export function LongText({ text, className, clampAt = 280 }: { text: string; className?: string; clampAt?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = text.length > clampAt;
  return (
    <div className={cn("min-w-0", className)}>
      <p id={id} className={cn("whitespace-pre-wrap break-words", long && !open && "line-clamp-4")}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="mt-1 rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          {open ? "Show less" : `Show all (${text.length.toLocaleString("en-US")} characters)`}
        </button>
      )}
    </div>
  );
}
