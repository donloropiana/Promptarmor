import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { cn } from "cn";

import type { Severity } from "@/features/ads/types";

import { severityLabel } from "@/features/ads/format";

const ICONS = { critical: ShieldAlert, major: AlertTriangle, minor: Info } as const;

/** Severity icon. Always pair with the word (SeverityWord) so colour is never the only signal. */
export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const Icon = ICONS[severity];
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5 shrink-0",
        severity === "critical" && "text-destructive",
        severity === "major" && "text-foreground",
        severity === "minor" && "text-muted-foreground",
        className,
      )}
    />
  );
}

/** Icon + word, e.g. "Critical". */
export function SeverityWord({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", severity === "critical" ? "text-destructive" : "text-foreground", className)}>
      <SeverityIcon severity={severity} />
      {severityLabel(severity)}
    </span>
  );
}

/** Compact "risk mark": one chip per non-zero severity, e.g. [!] 1  [▲] 2. */
export function RiskMark({ critical, major, minor, className }: { critical: number; major: number; minor: number; className?: string }) {
  if (!critical && !major && !minor) {
    return <span className={cn("text-xs text-muted-foreground", className)}>No open issues</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs tabular-nums", className)} aria-label={`${critical} critical, ${major} major, ${minor} minor open issues`}>
      {critical > 0 && (
        <span className="inline-flex items-center gap-1 font-medium text-destructive">
          <SeverityIcon severity="critical" />
          {critical} <span className="sr-only sm:not-sr-only">critical</span>
        </span>
      )}
      {major > 0 && (
        <span className="inline-flex items-center gap-1 font-medium">
          <SeverityIcon severity="major" />
          {major} <span className="sr-only sm:not-sr-only">major</span>
        </span>
      )}
      {minor > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <SeverityIcon severity="minor" />
          {minor} <span className="sr-only sm:not-sr-only">minor</span>
        </span>
      )}
    </span>
  );
}
