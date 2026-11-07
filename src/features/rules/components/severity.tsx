import { AlertTriangleIcon, InfoIcon, ShieldAlertIcon } from "lucide-react";

import type { Severity } from "@/features/ads/types";
import { cn } from "@/lib/utils";

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

const ICONS = {
  critical: ShieldAlertIcon,
  major: AlertTriangleIcon,
  minor: InfoIcon,
} as const;

/** Severity as icon + word, so it reads without color. */
export function SeverityLabel({ severity, className }: { severity: Severity; className?: string }) {
  const Icon = ICONS[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        severity === "critical" ? "text-destructive" : severity === "major" ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
