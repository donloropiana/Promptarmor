"use client";

import { PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { addRule } from "@/lib/actions/rules";
import type { Reference } from "@/lib/data/rules";
import { RULE_KIND_LABELS, type RuleKind } from "@/lib/data/rules-labels";

import { RuleFormFields, type RuleFormValues } from "./rule-form-fields";

const EMPTY: RuleFormValues = { title: "", body: "", severity: "major", appliesTo: ["all"], reason: "" };

/** "Add rule": a rules row plus its first version, with optional legal sources. */
export function AddRuleSheet({ profileId, library }: { profileId: string; library: Reference[] }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<RuleFormValues>(EMPTY);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<RuleKind>("policy");
  const [refs, setRefs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = "add-rule-form";

  function reset() {
    setValues(EMPTY);
    setCode("");
    setKind("policy");
    setRefs([]);
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (values.appliesTo.length === 0) {
      setError("Choose at least one product.");
      return;
    }
    startTransition(async () => {
      const res = await addRule({
        profileId,
        code,
        kind,
        title: values.title,
        body: values.body,
        severity: values.severity,
        appliesTo: values.appliesTo,
        referenceIds: refs,
        reason: values.reason.trim() || "Added by a member",
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`Added rule ${code.toUpperCase()}`, { description: "It is on and will be used by the next check." });
      setOpen(false);
      reset();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          Add rule
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">Add rule</SheetTitle>
          <SheetDescription>A rule of your own, checked alongside the starter rules. It starts on.</SheetDescription>
        </SheetHeader>
        <form id={formId} onSubmit={submit} className="flex-1 overflow-y-auto px-4 py-4">
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="add-rule-code">Code</FieldLabel>
                <Input
                  id="add-rule-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={40}
                  required
                  placeholder="POL-7"
                  className="font-mono uppercase"
                />
                <FieldDescription>Short and unique in this workspace.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="add-rule-kind">Kind</FieldLabel>
                <Select value={kind} onValueChange={(v) => setKind(v as RuleKind)}>
                  <SelectTrigger id="add-rule-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RULE_KIND_LABELS) as RuleKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {RULE_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <RuleFormFields
              idPrefix={formId}
              values={values}
              onChange={(patch) => setValues((cur) => ({ ...cur, ...patch }))}
              reasonRequired={false}
              reasonPlaceholder="Why add this rule? (shown in its history)"
            />
            {library.length > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Legal source <span className="font-normal text-muted-foreground">(optional)</span></legend>
                <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
                  {library.map((r) => (
                    <label key={r.id} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={refs.includes(r.id)}
                        onCheckedChange={(c) => setRefs((cur) => (c === true ? [...cur, r.id] : cur.filter((x) => x !== r.id)))}
                        aria-label={r.label}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{r.label}</span>
                        <span className="truncate text-xs text-muted-foreground">{r.citation}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        </form>
        <SheetFooter className="flex-row items-center justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending || !code.trim() || !values.title.trim() || !values.body.trim()}>
            {pending ? <Spinner /> : null}
            Add rule
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
