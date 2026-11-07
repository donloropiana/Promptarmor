import { diffWords } from "diff";

import { cn } from "@/lib/utils";

/**
 * Word-level redline of `before` -> `after`: removed words struck through,
 * added words underlined, both with a quiet background. Reads without color.
 */
export function Redline({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = diffWords(before, after);
  const changed = parts.some((p) => p.added || p.removed);
  return (
    <p className={cn("whitespace-pre-wrap text-sm leading-relaxed", className)}>
      {!changed ? <span className="text-muted-foreground">(unchanged)</span> : null}
      {parts.map((p, i) =>
        p.added ? (
          <ins key={i} className="rounded-sm bg-primary/10 px-0.5 no-underline decoration-primary/60 underline-offset-2 [text-decoration-line:underline]">
            {p.value}
          </ins>
        ) : p.removed ? (
          <del key={i} className="rounded-sm bg-destructive/10 px-0.5 text-muted-foreground line-through">
            {p.value}
          </del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  );
}

/** A one-line "a → b" change, used for fields that are not prose. */
export function ValueChange({ before, after }: { before: string; after: string }) {
  if (before === after) return <span>{after || "—"}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <del className="rounded-sm bg-destructive/10 px-0.5 text-muted-foreground line-through">{before || "—"}</del>
      <span aria-hidden="true">→</span>
      <ins className="rounded-sm bg-primary/10 px-0.5 no-underline">{after || "—"}</ins>
    </span>
  );
}
