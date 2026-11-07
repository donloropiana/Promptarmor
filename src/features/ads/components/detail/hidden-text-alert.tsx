"use client";

import { EyeOff, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { acknowledgeAlert } from "@/features/ads/server/actions";
import type { AdAlert } from "@/features/ads/server/queries";

import { LocalDateTime } from "@/features/ads/components/local-time";

/**
 * Pinned alert for hidden or instruction-like text. The excerpt is shown as
 * inert quoted text. Decisions are blocked until every alert is acknowledged.
 */
export function HiddenTextAlert({ alerts, issueCount }: { alerts: AdAlert[]; issueCount: number }) {
  const open = alerts.filter((a) => !a.acknowledgedAt);
  const acknowledged = alerts.filter((a) => a.acknowledgedAt);
  if (alerts.length === 0) return null;

  return (
    <section
      role={open.length ? "alert" : "status"}
      aria-label="Hidden text alert"
      className="rounded-xl border border-destructive/40 bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-semibold">
            {open.length ? "Hidden text aimed at the reviewer" : "Hidden text was found and acknowledged"}
          </div>
          <p className="text-sm text-muted-foreground">
            This ad contains text a reader would not see. It was treated as content, not as instructions:{" "}
            {issueCount > 0 ? `the ${issueCount} real issue${issueCount === 1 ? " was" : "s were"} still flagged` : "the ad was still fully checked"}, and the AI has no way to
            approve anything. Only a member can.
          </p>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="rounded-lg border bg-muted/40 p-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{a.kind === "possible_injection" ? "Possible instruction" : "Hidden text"}</span>
                  {a.location && <span>· {a.location}</span>}
                  {a.acknowledgedAt && (
                    <span>
                      · acknowledged by {a.acknowledgedBy ?? "a member"} <LocalDateTime iso={a.acknowledgedAt} />
                    </span>
                  )}
                </div>
                <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-foreground [overflow-wrap:anywhere]" aria-label="Hidden text, shown as inert quoted content" dir="auto">
                  {a.excerpt?.trim() || "(empty)"}
                </blockquote>
              </li>
            ))}
          </ul>
          {open.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <AcknowledgeButton alertIds={open.map((a) => a.id)} />
            </div>
          )}
          {open.length === 0 && acknowledged.length > 0 && (
            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck aria-hidden className="size-3.5" /> Acknowledged. Decisions are unblocked.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One button for the whole card: every open excerpt is acknowledged together, and decisions unblock. */
function AcknowledgeButton({ alertIds }: { alertIds: string[] }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          const results = await Promise.all(alertIds.map((id) => acknowledgeAlert(id)));
          const failed = results.find((r) => !r.ok);
          if (failed && !failed.ok) toast.error(failed.error);
          else {
            setDone(true);
            toast.success("Acknowledged");
          }
        })
      }
    >
      {pending ? <Spinner className="motion-reduce:animate-none" /> : <ShieldCheck data-icon="inline-start" />}
      Acknowledge{alertIds.length > 1 ? ` (${alertIds.length})` : ""}
    </Button>
  );
}
