"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { readAdSelection, type AdSelection, type PinRegion } from "../add-issue";

/**
 * How a reviewer starts an issue from the creative: selecting ad words (the
 * floating "+ Add issue" button by the selection, or the toolbar's button)
 * or clicking a spot on an image. Owns reading the selection, placing the
 * floating button, and which Add issue dialog is open.
 */

/** Size the floating "+ Add issue" button is placed and clamped with (h-7 = 28px). */
const FLOAT_BUTTON_WIDTH = 112;
const FLOAT_BUTTON_HEIGHT = 28;

/** The floating button: the selected quote and where it sits inside the text wrapper. */
type Floating = { quote: string; left: number; top: number };

/**
 * `addIssueAvailable`: the text view is showing ad words and the ad can still
 * take a new issue. The returned `textWrapRef` goes on the element that wraps
 * the text view; `captureSelection` and `onTextKeyUp` are its handlers.
 */
export function useAddIssueFlow(addIssueAvailable: boolean) {
  const textWrapRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<Floating | null>(null);
  const [dialog, setDialog] = useState<{ quote: string; editable: boolean; region: PinRegion | null } | null>(null);

  // ---- Image notes: a click on the image pins a note ----------------------
  const openPinDialog = useCallback((region: PinRegion) => {
    setFloating(null);
    setDialog({ quote: "", editable: true, region });
  }, []);

  /** Reads the selection; shows the floating button by its last line when it is ad text. */
  const captureSelection = useCallback(() => {
    const wrap = textWrapRef.current;
    if (!addIssueAvailable || !wrap) return;
    const sel: AdSelection | null = readAdSelection(wrap);
    if (!sel) {
      setFloating(null);
      return;
    }
    // Above the first selected line (it never covers what comes next);
    // below the last line when there is no room above.
    const box = wrap.getBoundingClientRect();
    const above = sel.first.top - box.top - FLOAT_BUTTON_HEIGHT - 6;
    const anchor = above >= 0 ? sel.first : sel.rect;
    const left = Math.max(0, Math.min(anchor.right - box.left, box.width - FLOAT_BUTTON_WIDTH));
    const top = above >= 0 ? above : sel.rect.bottom - box.top + 6;
    setFloating({ quote: sel.quote, left, top });
  }, [addIssueAvailable]);

  // The button goes away as soon as the selection collapses or leaves the
  // text; a selection made by touch handles or the keyboard (no mouseup)
  // shows it once the selection settles.
  useEffect(() => {
    if (!addIssueAvailable) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      const s = window.getSelection();
      const wrap = textWrapRef.current;
      if (!s || s.isCollapsed || s.rangeCount === 0 || !wrap) {
        setFloating(null);
        return;
      }
      const r = s.getRangeAt(0);
      if (!wrap.contains(r.startContainer) || !wrap.contains(r.endContainer)) {
        setFloating(null);
        return;
      }
      timer = setTimeout(captureSelection, 250);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [addIssueAvailable, captureSelection]);

  // Keyboard selection (caret browsing, shift+arrows) ends on keyup.
  const onTextKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.shiftKey || e.key === "Shift") captureSelection();
    },
    [captureSelection],
  );

  const openDialog = useCallback(
    (quote: string | null) => {
      const q = (quote ?? readAdSelection(textWrapRef.current)?.quote ?? "").trim();
      setFloating(null);
      setDialog({ quote: q, editable: q.length === 0, region: null });
    },
    [],
  );

  const closeDialog = () => setDialog(null);

  return { textWrapRef, floating, dialog, captureSelection, onTextKeyUp, openDialog, openPinDialog, closeDialog };
}

/** The "+ Add issue" button that floats by a selection of ad words. */
export function FloatingAddIssue({ floating, onOpen }: { floating: Floating; onOpen: (quote: string) => void }) {
  return (
    <Button
      type="button"
      size="sm"
      data-add-issue-floating
      className="absolute z-10 h-7 shadow-md"
      style={{ left: floating.left, top: floating.top }}
      // Keep the selection: a mousedown on the button must not collapse it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onOpen(floating.quote)}
    >
      <Plus data-icon="inline-start" />
      Add issue
    </Button>
  );
}
