import { useCallback, useMemo, useState } from "react";

import type { AdFinding } from "@/features/ads/server/queries";
import type { VersionContent } from "@/features/ads/types";

import type { CreativeViewMode } from "../creative-view";

/**
 * The ad page's selection: which issue is selected, and which view of the
 * creative shows it (the latest version or the word diff; Preview or Text).
 * The three move together, so they live together.
 */

/** The left column on a revised ad: the latest version, or the word diff against the previous one. */
export type LeftView = "current" | "changes";

/** Selects an issue (null clears the selection); `where` says which view shows it. */
export type SelectIssue = (id: string | null, where?: "text" | "image") => void;

export function useIssueSelection(findings: AdFinding[], format: VersionContent["format"]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leftView, setLeftView] = useState<LeftView>("current");
  const [creativeView, setCreativeView] = useState<CreativeViewMode>(format === "text" ? "text" : "preview");

  const imageNoteIds = useMemo(() => new Set(findings.filter((f) => f.imageAnchor).map((f) => f.id)), [findings]);
  // Selecting an issue shows where it is: the Text view for quoted words, the
  // Preview for a pin on the image. `where` is passed for a just-added issue
  // the page has not re-rendered with yet.
  const select = useCallback<SelectIssue>(
    (id, where) => {
      setSelectedId(id);
      if (id) {
        setLeftView("current");
        setCreativeView((where ?? (imageNoteIds.has(id) ? "image" : "text")) === "image" ? "preview" : "text");
      }
    },
    [imageNoteIds],
  );

  return { selectedId, select, leftView, setLeftView, creativeView, setCreativeView };
}
