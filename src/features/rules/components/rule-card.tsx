"use client";

import { ExternalLinkIcon, HistoryIcon, PencilIcon } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { setRuleActive } from "@/features/rules/server/actions";
import type { WorkspaceRule } from "@/features/rules/server/queries";
import { PRODUCT_LABELS, RULE_KIND_LABELS } from "@/features/rules/labels";
import { cn } from "@/lib/utils";

import { RuleEditSheet } from "./rule-edit-sheet";
import { RuleHistorySheet } from "./rule-history-sheet";
import { SeverityLabel } from "./severity";

function excerpt(body: string, max = 220): string {
  const one = body.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30))}…`;
}

/** One rule: title, what it checks, severity, products, legal source, on/off, Edit, History. */
export function RuleCard({ rule }: { rule: WorkspaceRule }) {
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [active, setOptimisticActive] = useOptimistic(rule.active);
  const switchId = `rule-${rule.id}-active`;

  function toggle(next: boolean) {
    startTransition(async () => {
      setOptimisticActive(next);
      const res = await setRuleActive({ ruleId: rule.id, active: next });
      if (!res.ok) {
        toast.error(next ? "Couldn't turn the rule on" : "Couldn't turn the rule off", { description: res.error });
      }
    });
  }

  const v = rule.current;
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 transition-opacity",
        !active && "opacity-70",
      )}
      data-active={active}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-medium leading-snug">{v.title}</h3>
            <span className="text-xs text-muted-foreground tabular-nums">{rule.code}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SeverityLabel severity={v.defaultSeverity} />
            <span className="text-xs text-muted-foreground">{RULE_KIND_LABELS[rule.kind]}</span>
            {v.versionNo > 1 ? <span className="text-xs text-muted-foreground tabular-nums">V{v.versionNo}</span> : null}
          </div>
        </div>
        <label htmlFor={switchId} className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <span className="w-6 text-right tabular-nums">{active ? "On" : "Off"}</span>
          <Switch id={switchId} checked={active} onCheckedChange={toggle} disabled={pending} aria-label={`${v.title}: ${active ? "on" : "off"}`} />
        </label>
      </div>

      <p className="text-sm text-muted-foreground">{excerpt(v.body)}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        {v.appliesTo.map((p) => (
          <Badge key={p} variant="outline" className="font-normal">
            {PRODUCT_LABELS[p] ?? p}
          </Badge>
        ))}
        {rule.references.map((r) =>
          r.url ? (
            <a
              key={r.id}
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded-md px-1 text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              title={r.label}
            >
              {r.citation}
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <span key={r.id} className="px-1 text-xs text-muted-foreground" title={r.label}>
              {r.citation}
            </span>
          ),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          <PencilIcon />
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
          <HistoryIcon />
          History
          <span className="text-muted-foreground tabular-nums">({rule.versionCount})</span>
        </Button>
      </div>

      <RuleEditSheet rule={rule} open={editOpen} onOpenChange={setEditOpen} />
      <RuleHistorySheet rule={rule} open={historyOpen} onOpenChange={setHistoryOpen} />
    </li>
  );
}
