import { useEffect } from "react";

import type { AdFinding } from "@/features/ads/server/queries/detail";

import { NO_DIALOGS, type DecisionDialogs } from "../decision-bar";
import { isTypingTarget } from "../shortcuts-dialog";
import type { SelectIssue } from "./use-issue-selection";

/**
 * The ad page's single-key shortcuts (listed in AD_SHORTCUTS). A key whose
 * action is unavailable right now does nothing; none fire with a modifier
 * held or while the reviewer is typing.
 */
export function useAdShortcuts({
  readOnly,
  blocked,
  checking,
  findings,
  editDisabledReason,
  openEdit,
  selectedId,
  openIssueIds,
  select,
  onShowShortcuts,
  onDialogs,
  onFormFor,
}: {
  readOnly: boolean;
  /** Why approving is blocked right now, or null. */
  blocked: string | null;
  checking: boolean;
  findings: AdFinding[];
  editDisabledReason: string | null;
  openEdit: () => void;
  selectedId: string | null;
  /** The issues J/K step through, in list order. */
  openIssueIds: string[];
  select: SelectIssue;
  onShowShortcuts: (open: boolean) => void;
  onDialogs: (dialogs: DecisionDialogs) => void;
  onFormFor: (id: string | null) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e)) return;
      switch (e.key) {
        case "?":
          e.preventDefault();
          onShowShortcuts(true);
          break;
        case "a":
          if (readOnly || blocked) return;
          e.preventDefault();
          onDialogs({ ...NO_DIALOGS, approve: true });
          break;
        case "r":
          if (readOnly || checking) return;
          e.preventDefault();
          onDialogs({ ...NO_DIALOGS, request: true });
          break;
        case "e":
          if (editDisabledReason) return;
          e.preventDefault();
          openEdit();
          break;
        case "x":
          if (readOnly || !selectedId) return;
          if (!findings.some((f) => f.id === selectedId && f.open)) return;
          e.preventDefault();
          onFormFor(selectedId);
          break;
        case "j":
        case "k": {
          if (openIssueIds.length === 0) return;
          e.preventDefault();
          const idx = selectedId ? openIssueIds.indexOf(selectedId) : -1;
          const next = e.key === "j" ? Math.min(openIssueIds.length - 1, idx + 1) : Math.max(0, idx <= 0 ? 0 : idx - 1);
          select(openIssueIds[next]);
          break;
        }
        case "Escape":
          select(null);
          onFormFor(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, selectedId, openIssueIds, select, blocked, checking, findings, editDisabledReason, openEdit, onShowShortcuts, onDialogs, onFormFor]);
}
