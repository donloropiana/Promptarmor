import { ShieldCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Small product wordmark used on sign-in and the phone top bar. */
export function Wordmark({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium tracking-tight", size === "md" ? "text-base" : "text-sm", className)}>
      <ShieldCheckIcon className={cn("shrink-0 text-muted-foreground", size === "md" ? "size-5" : "size-4")} aria-hidden="true" />
      <span>Marketing Compliance Workbench</span>
    </span>
  );
}
