"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { TEXT_TERM_LABELS, type TermField } from "./term-fields";

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
