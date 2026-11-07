"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { factKey, factLabel, TERM_FIELDS, TEXT_TERM_KEYS, TEXT_TERM_LABELS, type TermField } from "./term-fields";

/**
 * Editable product facts. Nothing is fixed: every fact is a row the
 * workspace can add, edit or remove, and the lender fields the check knows
 * how to compare in code (lowest APR, annual fee, ...) are offered as
 * suggestions, never forced. Values are strings here; the action converts
 * numbers and booleans. Three prose fields (summary, representative example,
 * notes) sit outside the list.
 */
export type TermFormValues = Record<string, string>;

const UNIT: Partial<Record<TermField["kind"], string>> = { percent: "%", money: "$", months: "months", date: "YYYY-MM-DD" };
const PROSE = new Set<string>(TEXT_TERM_KEYS);
const BY_KEY = new Map(TERM_FIELDS.map((f) => [f.key, f]));

export function ProductTermFields({
  idPrefix,
  fields,
  values,
  onChange,
}: {
  idPrefix: string;
  /** Fields to suggest (the known ones for this product); shown as "Add" chips while absent. */
  fields: TermField[];
  values: TermFormValues;
  onChange: (key: string, value: string) => void;
}) {
  // Rows added from a suggestion or by name but not yet given a value.
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [factError, setFactError] = useState<string | null>(null);

  const present = Object.keys(values).filter((k) => !PROSE.has(k) && values[k] !== "");
  const rows = Array.from(new Set([...present, ...pendingKeys]));
  const suggestions = fields.filter((f) => !rows.includes(f.key));

  function remove(key: string) {
    onChange(key, "");
    setPendingKeys((cur) => cur.filter((k) => k !== key));
  }
  function addKey(key: string, value: string) {
    if (value) onChange(key, value);
    else setPendingKeys((cur) => (cur.includes(key) ? cur : [...cur, key]));
  }
  function addFact() {
    const key = factKey(newName);
    if (!key) return setFactError("Name the fact first.");
    if (rows.includes(key) || PROSE.has(key)) return setFactError("A fact with that name is already in the list.");
    addKey(key, newValue.trim());
    setNewName("");
    setNewValue("");
    setFactError(null);
  }

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-summary`}>{TEXT_TERM_LABELS.summary}</FieldLabel>
        <Textarea
          id={`${idPrefix}-summary`}
          value={values.summary ?? ""}
          onChange={(e) => onChange("summary", e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="One or two sentences a person can read: who it is for, the price or rate range, the main fees."
        />
        <FieldDescription>Shown on the product card and quoted in issues.</FieldDescription>
      </Field>

      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">Facts</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What is actually true about this product: prices, rates, fees, limits, guarantees, eligibility. Every claim in an ad is checked against
          these. Add your own, edit any, remove what does not apply.
        </p>

        {rows.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {rows.map((k) => {
              const known = BY_KEY.get(k);
              const label = known?.label ?? factLabel(k);
              const unit = known ? UNIT[known.kind] : undefined;
              if (known?.kind === "boolean") {
                return (
                  <li key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <span className="truncate text-sm" title={k}>
                      {label}
                    </span>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox id={`${idPrefix}-${k}`} checked={values[k] === "true"} onCheckedChange={(c) => onChange(k, c === true ? "true" : "false")} />
                      <span className="text-muted-foreground">{values[k] === "true" ? "yes" : "no"}</span>
                    </label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => remove(k)} aria-label={`Remove ${label}`}>
                      Remove
                    </Button>
                  </li>
                );
              }
              return (
                <li key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <label htmlFor={`${idPrefix}-${k}`} className="truncate text-sm" title={known?.hint ?? k}>
                    {label}
                    {unit ? <span className="ml-1 text-xs text-muted-foreground">{unit}</span> : null}
                  </label>
                  <Input
                    id={`${idPrefix}-${k}`}
                    aria-label={`${label} value`}
                    value={values[k] ?? ""}
                    onChange={(e) => onChange(k, e.target.value)}
                    inputMode={!known || known.kind === "text" || known.kind === "date" ? "text" : "decimal"}
                    placeholder={known?.hint ?? ""}
                    className={known && known.kind !== "text" ? "tabular-nums" : undefined}
                    maxLength={300}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(k)} aria-label={`Remove ${label}`}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No facts yet. Add one below, or pick from the suggestions.</p>
        )}

        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input
            id={`${idPrefix}-fact-name`}
            aria-label="New fact name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            placeholder="Name, e.g. Uptime SLA"
          />
          <Input
            id={`${idPrefix}-fact-value`}
            aria-label="New fact value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            maxLength={300}
            placeholder="Value, e.g. 99.9%"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFact();
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={addFact}>
            Add fact
          </Button>
        </div>
        {factError ? <p className="mt-1 text-xs text-destructive">{factError}</p> : null}

        {suggestions.length > 0 ? (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground">Suggestions for lenders (the check compares these in code):</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-xs"
                  onClick={() => addKey(f.key, f.kind === "boolean" ? "false" : "")}
                  aria-label={`Add ${f.label}`}
                >
                  + {f.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-representative_example`}>
          {TEXT_TERM_LABELS.representative_example} <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id={`${idPrefix}-representative_example`}
          value={values.representative_example ?? ""}
          onChange={(e) => onChange("representative_example", e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="A worked example with amount, term, rate, fees and the resulting APR and payment."
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-notes`}>
          {TEXT_TERM_LABELS.notes} <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id={`${idPrefix}-notes`}
          value={values.notes ?? ""}
          onChange={(e) => onChange("notes", e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Anything else a reviewer or the check should know about this product."
        />
      </Field>
    </>
  );
}
