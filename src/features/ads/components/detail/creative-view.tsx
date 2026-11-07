"use client";

import { FileText, Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { AdFinding, AdVersion } from "@/features/ads/server/queries";

import { AddIssueDialog, type RuleOption } from "./add-issue";
import { FloatingAddIssue, useAddIssueFlow } from "./creative/add-issue-flow";
import { HtmlPreview } from "./creative/html-preview";
import { marksFor } from "./creative/marked-text";
import { PinnedImage, pinsFor } from "./creative/pinned-image";
import { TextView, type FileRead } from "./creative/text-view";
import { CreativeToolbar } from "./creative/toolbar";

export type CreativeViewMode = "preview" | "text";

/**
 * The creative on the left of the ad page. Text ads render as a card with
 * sections; HTML in a sandboxed iframe; PDF as "Open PDF" + extracted text with
 * page breaks; images inline. Clicking an issue highlights its words in the
 * text view (the view switches to Text when needed).
 */
export function CreativeView({
  version,
  findings,
  fileUrl,
  selectedId,
  onSelect,
  channel,
  view,
  onViewChange,
  fileRead = "unknown",
  rulesInForce = [],
  canAddIssue = false,
  onIssueAdded,
  onEdit,
  editDisabledReason = null,
}: {
  version: AdVersion;
  findings: AdFinding[];
  fileUrl: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  channel: string | null;
  /** Controlled by the parent so selecting an issue can switch to the text view. */
  view: CreativeViewMode;
  onViewChange: (v: CreativeViewMode) => void;
  /**
   * For a PDF or image with no text layer: whether a model read it as an
   * image ("transcribed"), nothing read it ("unread"), or the check has not
   * finished ("unknown"). Decides what the empty text view says.
   */
  fileRead?: FileRead;
  /** Rules that are on, for the Add issue rule picker. */
  rulesInForce?: RuleOption[];
  /** "+ Add issue" is offered only while the ad can still take decisions (not approved). */
  canAddIssue?: boolean;
  /** Called with the new issue's id so the page can select it; `where` says which view shows it. */
  onIssueAdded?: (findingId: string, where: "text" | "image") => void;
  /** "Edit" (edit the copy or replace the file): opens the page's edit sheet. Hidden when absent. */
  onEdit?: () => void;
  /** Why "Edit" is disabled right now (approved, or a check is running); null when it is available. */
  editDisabledReason?: string | null;
}) {
  const format = version.content.format;
  const text = version.extractedText || version.content.text || "";
  const marks = useMemo(() => marksFor(findings, text), [findings, text]);
  const pins = useMemo(() => pinsFor(findings), [findings]);
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Selecting an issue: scroll its words (or its pin) into view (DOM only). Re-runs when
  // the findings change so a just-added issue is found once the page refreshes.
  useEffect(() => {
    if (!selectedId) return;
    const t = setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`mark[data-finding-id="${selectedId}"], [data-image-pin][data-finding-id="${selectedId}"]`);
      el?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    }, 30);
    return () => clearTimeout(t);
  }, [selectedId, view, reduceMotion, findings]);

  // "+ Add issue" from a text selection, or an image note from a click on the image.
  const showingText = (view === "text" || format === "text") && text.trim().length > 0;
  const addIssueAvailable = canAddIssue && showingText;
  const pinningAvailable = canAddIssue && format === "image" && view === "preview" && Boolean(fileUrl);
  const { textWrapRef, floating, dialog, captureSelection, onTextKeyUp, openDialog, openPinDialog, closeDialog } = useAddIssueFlow(addIssueAvailable);

  let body: React.ReactNode;
  if (view === "text" || format === "text") {
    body = <TextView version={version} text={text} marks={marks} selectedId={selectedId} onSelect={onSelect} fileRead={fileRead} />;
  } else if (format === "html") {
    body = version.content.html ? <HtmlPreview html={version.content.html} /> : <p className="text-sm text-muted-foreground">The HTML for this version is not available.</p>;
  } else if (format === "image") {
    body = fileUrl ? (
      <PinnedImage
        src={fileUrl}
        alt={version.content.filename ? `Ad image: ${version.content.filename}` : "Ad image"}
        pins={pins}
        draft={dialog?.region ?? null}
        selectedId={selectedId}
        onSelect={onSelect}
        onPlace={pinningAvailable ? openPinDialog : null}
      />
    ) : (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        <ImageIcon aria-hidden className="size-4" /> The image could not be loaded. Reload the page to get a fresh link.
      </div>
    );
  } else {
    // PDF preview: the browser's own viewer in a sandboxed frame; "Open PDF" for the full thing.
    body = fileUrl ? (
      <div className="overflow-hidden rounded-xl border bg-card">
        <iframe title="PDF preview" src={fileUrl} className="h-[70vh] w-full" />
      </div>
    ) : (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        <FileText aria-hidden className="size-4" /> The PDF could not be loaded. Reload the page to get a fresh link.
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <CreativeToolbar
        version={version}
        channel={channel}
        fileUrl={fileUrl}
        view={view}
        onViewChange={onViewChange}
        onAddIssue={addIssueAvailable ? () => openDialog(null) : null}
        onEdit={onEdit}
        editDisabledReason={editDisabledReason}
      />
      {addIssueAvailable ? (
        <div ref={textWrapRef} className="relative" onMouseUp={captureSelection} onTouchEnd={captureSelection} onKeyUp={onTextKeyUp}>
          {body}
          {floating && <FloatingAddIssue floating={floating} onOpen={openDialog} />}
        </div>
      ) : (
        body
      )}
      {(addIssueAvailable || pinningAvailable) && (
        <AddIssueDialog
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) closeDialog();
          }}
          assetVersionId={version.id}
          versionNo={version.versionNo}
          quote={dialog?.quote ?? ""}
          quoteEditable={dialog?.editable ?? false}
          region={dialog?.region ?? null}
          rules={rulesInForce}
          onAdded={(id) => onIssueAdded?.(id, dialog?.region ? "image" : "text")}
        />
      )}
    </div>
  );
}
