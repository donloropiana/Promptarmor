"use client";

import { Copy, MessageSquareWarning } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { decide, type DecideResult } from "@/features/ads/server/actions";
import type { AdDetail, AdFinding } from "@/features/ads/server/queries";

import { severityLabel } from "@/features/rules/severity";
import { issueTitle } from "../issues-panel";

/**
 * The Request changes sheet: the note to the submitter built from the open
 * issues (editable and copyable; the app sends no email), the change-request
 * items recorded with it, and the optional due date.
 */

function buildNote(detail: AdDetail, open: AdFinding[]): string {
  const lines: string[] = [];
  lines.push(`Changes requested for “${detail.title}” (V${detail.latest.versionNo})`);
  lines.push("");
  if (open.length === 0) {
    lines.push("Please revise the ad as discussed and send the updated version back.");
  } else {
    open.forEach((f, i) => {
      lines.push(`${i + 1}. ${issueTitle(f)} (${severityLabel(f.severity)})`);
      if (f.imageAnchor) lines.push(`   Pinned on the image${f.quote ? `: ${f.quote}` : ""}`);
      else if (f.quote) lines.push(`   Quoted: “${f.quote}”`);
      if (f.rule) lines.push(`   Rule: ${f.rule.title}${f.rule.references[0] ? ` — ${f.rule.references[0].citation}` : ""}`);
      if (f.suggestedFix) lines.push(`   Fix: ${f.suggestedFix}`);
      else if (f.explanation) lines.push(`   Fix: ${f.explanation}`);
      if (f.suggestedCopy) lines.push(`   Suggested wording: “${f.suggestedCopy}”`);
      lines.push("");
    });
    lines.push("Please send the revised version back; it will be re-checked automatically.");
  }
  return lines.join("\n");
}

export function RequestChangesForm({ detail, onClose, onDone }: { detail: AdDetail; onClose: () => void; onDone: (label: string, r: DecideResult, opts?: { advance?: boolean }) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const openIssues = useMemo(() => detail.findings.filter((f) => f.open), [detail.findings]);
  const [text, setText] = useState(() => buildNote(detail, openIssues));
  const [due, setDue] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it yourself.");
    }
  };

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>Request changes on V{detail.latest.versionNo}</SheetTitle>
        <SheetDescription id="request-desc">
          Built from the open issues. Edit it and copy it to the submitter yourself; the app sends no email. The revision is re-checked when it arrives.
        </SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setError(null);
          start(async () => {
            const items =
              openIssues.length > 0
                ? openIssues.map((f) => ({
                    finding_id: f.id,
                    quote: f.quote ?? undefined,
                    rule: f.rule?.title ?? undefined,
                    required_fix: f.suggestedFix || f.explanation || issueTitle(f),
                    suggested_copy: f.suggestedCopy ?? undefined,
                  }))
                : [{ required_fix: text.trim().slice(0, 4000) }];
            const res = await decide({
              versionId: detail.latest.id,
              decision: "changes_requested",
              changeRequest: { items, note: text.trim(), message_text: text.trim(), due_date: due || undefined },
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            onDone(`Changes requested on V${detail.latest.versionNo}`, res.data, { advance: false });
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="request-text">Note to the submitter</Label>
              <Button type="button" size="xs" variant="ghost" onClick={copy}>
                <Copy data-icon="inline-start" /> Copy as text
              </Button>
            </div>
            <Textarea id="request-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-64 font-sans text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="request-due">Due date (optional)</Label>
            <Input id="request-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-fit" />
          </div>
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
          <Button type="submit" disabled={pending || !text.trim()}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <MessageSquareWarning data-icon="inline-start" />}
            Request changes
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}
