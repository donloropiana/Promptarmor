"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { factKey, factLabel, isKnownTermKey, TEXT_TERM_LABELS, type TermField } from "./term-fields";

/**
 * Editable term sheet: a summary people read, the known fields, a
 * representative example and free-form notes. Values are strings here; the
 * action converts numbers and booleans.
 */
export type TermFormValues = Record<string, string>;

const UNIT: Partial<Record<TermField["kind"], string>> = { percent: "%", money: "$", months: "months", date: "YYYY-MM-DD" };

export function ProductTermFields({
  idPrefix,
  fields,
  values,
  onChange,
}: {
  idPrefix: string;
  fields: TermField[];
  values: TermFormValues;
  onChange: (key: string, value: string) => void;
}) {
  const booleans = fields.filter((f) => f.kind === "boolean");
  const scalars = fields.filter((f) => f.kind !== "boolean");
  // Facts this workspace defined itself: any key the built-in fields do not own.
  const custom = Object.keys(values).filter((k) => !isKnownTermKey(k) && values[k] !== "");
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [factError, setFactError] = useState<string | null>(null);
  function addFact() {
    const key = factKey(newName);
    if (!key) return setFactError("Name the fact first.");
    if (isKnownTermKey(key) || values[key]) return setFactError("A fact with that name already exists.");
    if (!newValue.trim()) return setFactError("Give it a value.");
    onChange(key, newValue.trim());
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
          placeholder="One or two sentences a person can read: who it is for, the rate range, the main fees."
        />
        <FieldDescription>Shown on the product card and quoted in issues.</FieldDescription>
      </Field>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {scalars.map((f) => (
          <Field key={f.key}>
            <FieldLabel htmlFor={`${idPrefix}-${f.key}`} className="text-xs">
              {f.label}
              {UNIT[f.kind] ? <span className="font-normal text-muted-foreground">{UNIT[f.kind]}</span> : null}
            </FieldLabel>
            <Input
              id={`${idPrefix}-${f.key}`}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              inputMode={f.kind === "text" || f.kind === "date" ? "text" : "decimal"}
              placeholder={f.kind === "text" ? "" : "—"}
              className="tabular-nums"
              maxLength={f.kind === "text" ? 300 : 20}
            />
            {f.hint ? <FieldDescription className="text-xs">{f.hint}</FieldDescription> : null}
          </Field>
        ))}
      </div>
      {booleans.length > 0 ? (
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {booleans.map((f) => (
            <label key={f.key} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`${idPrefix}-${f.key}`}
                className="mt-0.5"
                checked={values[f.key] === "true"}
                onCheckedChange={(c) => onChange(f.key, c === true ? "true" : "false")}
              />
              <span className="flex flex-col">
                <span>{f.label}</span>
                {f.hint ? <span className="text-xs text-muted-foreground">{f.hint}</span> : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">Your own facts</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Anything true about this product that an ad could get wrong: a price, a guarantee, an eligibility rule, a limit. Name it, give it a value.
          The check compares every claim in an ad against these.
        </p>
        {custom.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {custom.map((k) => (
              <li key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <span className="truncate text-sm" title={k}>
                  {factLabel(k)}
                </span>
                <Input
                  id={`${idPrefix}-fact-${k}`}
                  aria-label={`${factLabel(k)} value`}
                  value={values[k] ?? ""}
                  onChange={(e) => onChange(k, e.target.value)}
                  maxLength={300}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(k, "")} aria-label={`Remove ${factLabel(k)}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
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
