"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRODUCT_LABELS, RULE_APPLIES_TO, SEVERITIES } from "@/features/rules/labels";
import type { Severity } from "@/features/ads/types";

import { SEVERITY_LABELS } from "./severity";

/** Shared fields for Edit rule and Add rule. */
export type RuleFormValues = {
  title: string;
  body: string;
  severity: Severity;
  appliesTo: string[];
  reason: string;
};

export function RuleFormFields({
  idPrefix,
  values,
  onChange,
  reasonRequired,
  reasonPlaceholder = "Why this change? Shown in the rule's history.",
}: {
  idPrefix: string;
  values: RuleFormValues;
  onChange: (patch: Partial<RuleFormValues>) => void;
  reasonRequired: boolean;
  reasonPlaceholder?: string;
}) {
  function toggleProduct(p: string, checked: boolean) {
    let next: string[];
    if (p === "all") next = checked ? ["all"] : [];
    else {
      const without = values.appliesTo.filter((x) => x !== "all" && x !== p);
      next = checked ? [...without, p] : without;
    }
    onChange({ appliesTo: next });
  }

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-title`}>Title</FieldLabel>
        <Input
          id={`${idPrefix}-title`}
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          maxLength={200}
          required
          placeholder="Say what the rule is about in a few words"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-body`}>What it checks</FieldLabel>
        <Textarea
          id={`${idPrefix}-body`}
          value={values.body}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={7}
          maxLength={20000}
          required
          className="min-h-32 text-sm leading-relaxed"
          placeholder="Describe, in plain English, what the check should look for and what counts as a problem."
        />
        <FieldDescription>The AI reads this when it checks an ad. Be concrete: name the words, numbers or disclosures to look for.</FieldDescription>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-severity`}>Default severity</FieldLabel>
          <Select value={values.severity} onValueChange={(v) => onChange({ severity: v as Severity })}>
            <SelectTrigger id={`${idPrefix}-severity`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>Critical and Major issues need a written reason to approve over.</FieldDescription>
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Applies to</legend>
          <div className="flex flex-col gap-1.5">
            {RULE_APPLIES_TO.map((p) => {
              const checked = values.appliesTo.includes(p);
              const disabled = p !== "all" && values.appliesTo.includes("all");
              return (
                <label key={p} className="flex items-center gap-2 text-sm" data-disabled={disabled || undefined}>
                  <Checkbox
                    checked={checked || (p !== "all" && values.appliesTo.includes("all"))}
                    disabled={disabled}
                    onCheckedChange={(c) => toggleProduct(p, c === true)}
                    aria-label={PRODUCT_LABELS[p] ?? p}
                  />
                  <span className={disabled ? "text-muted-foreground" : undefined}>{PRODUCT_LABELS[p] ?? p}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-reason`}>
          Reason {reasonRequired ? null : <span className="font-normal text-muted-foreground">(optional)</span>}
        </FieldLabel>
        <Input
          id={`${idPrefix}-reason`}
          value={values.reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          maxLength={500}
          required={reasonRequired}
          placeholder={reasonPlaceholder}
        />
      </Field>
    </>
  );
}
