import { Check, CircleDashed, MessageSquareWarning, Undo2, XCircle } from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

import { statusWord } from "./format";

const STATUS_ICON = {
  "Needs review": CircleDashed,
  "Changes requested": MessageSquareWarning,
  Approved: Check,
  Rejected: XCircle,
  Withdrawn: Undo2,
  Draft: CircleDashed,
} as const;

/** Status word with an icon (never colour alone). "Checking…" is a spinner, not a status. */
export function StatusWord({ status, checking, className }: { status: string; checking?: boolean; className?: string }) {
  if (checking) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Spinner className="size-3 motion-reduce:animate-none" />
        Checking…
      </span>
    );
  }
  const word = statusWord(status);
  const Icon = STATUS_ICON[word];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-foreground", className)}>
      <Icon aria-hidden className="size-3.5 text-muted-foreground" />
      {word}
    </span>
  );
}

/** Small neutral reason tags: New, V2, Rates changed, Hidden text, With exceptions… */
export function ReasonTags({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tags.map((t) => (
        <Badge key={t} variant={t === "Hidden text" ? "destructive" : "outline"} className="h-4.5 px-1.5 text-[11px] font-medium">
          {t}
        </Badge>
      ))}
    </span>
  );
}
