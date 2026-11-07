"use client";

import { Check } from "lucide-react";
import { cn } from "cn";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { decide, type DecideResult } from "@/features/ads/server/actions/review";
import type { AdDetail } from "@/features/ads/server/queries/detail";

import { shortSha } from "@/features/ads/format";
import { SeverityWord } from "@/features/rules/components/severity";
import { issueTitle } from "../issues-panel";

/**
 * The Approve sheet: open Critical / Major issues become written exceptions,
 * the rationale rules (manual approval, self-approval), the attestation of the
 * exact version, and the approve decision itself.
 */

const EXCEPTION_REASONS = [
  { value: "business_decision", label: "Business decision: the risk is accepted" },
  { value: "disclosed_elsewhere", label: "Disclosed elsewhere in the customer journey" },
  { value: "not_applicable", label: "Rule does not apply to this product or channel" },
  { value: "legal_reviewed", label: "Reviewed and cleared by legal" },
] as const;

export function ApproveForm({ detail, userId, onClose, onDone }: { detail: AdDetail; userId: string; onClose: () => void; onDone: (label: string, r: DecideResult) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [rationale, setRationale] = useState("");
  // Only decision-grade issues (reviewer-added, or from a complete check) can
  // be accepted as exceptions; the database ignores the rest.
  const needsException = useMemo(
    () => detail.findings.filter((f) => f.decisionGrade && (f.severity === "critical" || f.severity === "major") && (f.open || f.disposition?.disposition === "accepted_exception")),
    [detail.findings],
  );
  const stillOpenUnscreened = useMemo(() => detail.findings.filter((f) => !f.decisionGrade && f.open), [detail.findings]);
  const [entries, setEntries] = useState<Record<string, { reason: string; text: string }>>(() =>
    Object.fromEntries(
      needsException.map((f) => [
        f.id,
        {
          reason: f.disposition?.disposition === "accepted_exception" ? (f.disposition.reason ?? "business_decision") : "",
          text: f.disposition?.disposition === "accepted_exception" ? (f.disposition.note ?? "") : "",
        },
      ]),
    ),
  );

  const isAuthor = detail.latest.authorId === userId;
  const noCompleteRun = !detail.aiScreened;
  const withExceptions = needsException.length > 0;
  const selfBlocked = withExceptions && isAuthor && detail.memberCount > 1;
  const rationaleMin = noCompleteRun ? 40 : isAuthor ? 20 : 0;
  const rationaleOk = rationale.trim().length >= rationaleMin;
  const entriesOk = needsException.every((f) => (entries[f.id]?.reason ?? "") !== "" && (entries[f.id]?.text ?? "").trim().length >= 40);
  const canSubmit = attested && rationaleOk && entriesOk && !selfBlocked && !pending;
  const sha = shortSha(detail.latest.contentSha256);
  const decisionLabel = withExceptions ? "Approve with exceptions" : "Approve";

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>
          Approve V{detail.latest.versionNo} · <span className="font-mono text-base">{sha}</span>
        </SheetTitle>
        <SheetDescription id="approve-desc">
          {withExceptions
            ? `${needsException.length} ${needsException.length === 1 ? "issue is" : "issues are"} still open. Each needs a written reason; together they become the recorded exceptions.`
            : noCompleteRun
              ? "The AI check did not run for this version, so this is a manual approval. It records the exact version you have in front of you."
              : "No Critical or Major issues are open. This records the exact version you have in front of you."}
        </SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setError(null);
          start(async () => {
            const res = await decide({
              versionId: detail.latest.id,
              decision: withExceptions ? "approved_with_exceptions" : "approved",
              exceptions: needsException.map((f) => ({ finding_id: f.id, reason: entries[f.id].reason, text: entries[f.id].text.trim() })),
              rationale: rationale.trim() || undefined,
              attested: true,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            onDone(`Approved V${detail.latest.versionNo}${withExceptions ? " with exceptions" : ""}`, res.data);
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {needsException.map((f) => (
            <fieldset key={f.id} className="space-y-2 rounded-lg border p-3">
              <legend className="px-1">
                <SeverityWord severity={f.severity} />
              </legend>
              <div className="text-sm font-medium [overflow-wrap:anywhere]">{issueTitle(f)}</div>
              {f.imageAnchor ? (
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">Pinned on the image{f.quote ? `: ${f.quote}` : ""}</p>
              ) : f.quote ? (
                <q className="block text-sm text-muted-foreground [overflow-wrap:anywhere] [quotes:'“'_'”']" dir="auto">
                  {f.quote}
                </q>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor={`exc-reason-${f.id}`}>Why approve anyway?</Label>
                <Select value={entries[f.id]?.reason ?? ""} onValueChange={(v) => setEntries((s) => ({ ...s, [f.id]: { ...(s[f.id] ?? { text: "" }), reason: v } }))}>
                  <SelectTrigger id={`exc-reason-${f.id}`} className="w-full">
                    <SelectValue placeholder="Pick a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXCEPTION_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`exc-text-${f.id}`}>Written reason (at least 40 characters)</Label>
                <Textarea
                  id={`exc-text-${f.id}`}
                  value={entries[f.id]?.text ?? ""}
                  onChange={(e) => setEntries((s) => ({ ...s, [f.id]: { ...(s[f.id] ?? { reason: "" }), text: e.target.value } }))}
                  className="min-h-20"
                  placeholder="What you checked, who agreed, and why the ad can run as written."
                />
                <div className={cn("text-xs tabular-nums", (entries[f.id]?.text ?? "").trim().length < 40 ? "text-destructive" : "text-muted-foreground")}>
                  {(entries[f.id]?.text ?? "").trim().length} / 40
                </div>
              </div>
            </fieldset>
          ))}

          {selfBlocked && (
            <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
              You wrote this version. With open issues, another member of the workspace has to approve it.
            </p>
          )}

          {stillOpenUnscreened.length > 0 && (
            <div className="rounded-lg border p-3">
              <div className="text-sm font-medium">
                {stillOpenUnscreened.length} open issue{stillOpenUnscreened.length === 1 ? "" : "s"} from the product-terms check
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Approving leaves {stillOpenUnscreened.length === 1 ? "it" : "them"} as written. Say why in the rationale, or mark each one Not a problem first.</p>
              <ul className="mt-2 space-y-1">
                {stillOpenUnscreened.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                    <SeverityWord severity={f.severity} />
                    <span className="min-w-0">{issueTitle(f)}</span>
                    {f.imageAnchor ? (
                      <span className="min-w-0 max-w-full text-muted-foreground [overflow-wrap:anywhere]">Pinned on the image{f.quote ? `: ${f.quote}` : ""}</span>
                    ) : f.quote ? (
                      <q className="min-w-0 max-w-full text-muted-foreground [overflow-wrap:anywhere] [quotes:'“'_'”']" dir="auto">
                        {f.quote}
                      </q>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="approve-rationale">Rationale{rationaleMin ? ` (required, at least ${rationaleMin} characters)` : " (optional)"}</Label>
            {noCompleteRun && (
              <p className="text-xs text-muted-foreground">The AI check did not run for this version, so this is a manual approval and is recorded as &quot;Not AI-screened&quot;.</p>
            )}
            {isAuthor && !noCompleteRun && <p className="text-xs text-muted-foreground">You wrote this version, so a short rationale is required.</p>}
            <Textarea id="approve-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-16" placeholder="Anything the audit record should say." />
            {rationaleMin > 0 && (
              <div className={cn("text-xs tabular-nums", rationaleOk ? "text-muted-foreground" : "text-destructive")}>
                {rationale.trim().length} / {rationaleMin}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} className="mt-0.5" aria-describedby="attest-desc" />
            <span id="attest-desc">
              I have read{" "}
              <strong>
                V{detail.latest.versionNo} · {sha}
              </strong>{" "}
              in full and approve this exact version for use.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <Check data-icon="inline-start" />}
            {decisionLabel} V{detail.latest.versionNo}
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}
