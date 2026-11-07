"use client";

import { cn } from "cn";

import type { AdFinding } from "@/features/ads/server/queries";

import type { PinRegion } from "../add-issue";

/**
 * Image notes: the reviewer's numbered pins over an image ad, which notes
 * get a pin and in what order, and where a click on the image drops a new one.
 */

export type Pin = { id: string; n: number; x: number; y: number; severity: AdFinding["severity"]; label: string };

/** Open (or accepted-as-exception) image notes, numbered in panel order. */
export function pinsFor(findings: AdFinding[]): Pin[] {
  const pins: Pin[] = [];
  for (const f of findings) {
    if (!f.imageAnchor) continue;
    if (!f.open && f.disposition?.disposition !== "accepted_exception") continue;
    pins.push({ id: f.id, n: pins.length + 1, x: f.imageAnchor.x, y: f.imageAnchor.y, severity: f.severity, label: f.quote ?? "" });
  }
  return pins;
}

const PIN_COLORS: Record<AdFinding["severity"], string> = {
  critical: "bg-destructive text-white",
  major: "bg-foreground text-background",
  minor: "bg-muted-foreground text-background",
};

/**
 * The image with the reviewer's pins over it. The wrapper hugs the image so
 * percentage offsets land on the same spot at any width. Clicking the image
 * (when allowed) drops a draft pin and opens the note dialog.
 */
export function PinnedImage({
  src,
  alt,
  pins,
  draft,
  selectedId,
  onSelect,
  onPlace,
}: {
  src: string;
  alt: string;
  pins: Pin[];
  /** Where a note is being written right now (dialog open). */
  draft: PinRegion | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Null when the ad cannot take notes (approved). */
  onPlace: ((region: PinRegion) => void) | null;
}) {
  const place = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!onPlace) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onPlace({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) });
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="relative mx-auto w-fit max-w-full" data-image-stage>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL from private storage */}
        <img src={src} alt={alt} draggable={false} onClick={place} className={cn("block max-h-[70vh] w-auto max-w-full select-none", onPlace && "cursor-crosshair")} />
        {pins.map((p) => {
          const selected = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              data-image-pin
              data-finding-id={p.id}
              data-selected={selected || undefined}
              aria-pressed={selected}
              aria-label={`Note ${p.n}${p.label ? `: ${p.label}` : ""}, ${p.severity}`}
              title={p.label || undefined}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(p.id);
              }}
              className={cn(
                "absolute z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold tabular-nums shadow-md transition-[transform,box-shadow] duration-150 motion-reduce:transition-none",
                "hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                PIN_COLORS[p.severity],
                selected && "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
            >
              {p.n}
            </button>
          );
        })}
        {draft && (
          <span
            aria-hidden
            data-image-pin-draft
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
            className="pointer-events-none absolute z-10 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-foreground bg-background/80 shadow-md"
          />
        )}
      </div>
      {(onPlace || pins.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {onPlace ? (
              <>
                Click or tap a spot on the image to pin a note, or{" "}
                <button
                  type="button"
                  className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  onClick={() => onPlace({ x: 0.5, y: 0.5 })}
                  aria-label="Pin a note at the centre of the image"
                >
                  pin one at the centre
                </button>
                .
              </>
            ) : (
              "Pins are the reviewer's notes on the image."
            )}
          </span>
          {pins.length > 0 && (
            <span className="tabular-nums">
              {pins.length} note{pins.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
