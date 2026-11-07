"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { editRule } from "@/lib/actions/rules";
import type { WorkspaceRule } from "@/lib/data/rules";

import { RuleFormFields, type RuleFormValues } from "./rule-form-fields";

/**
 * Edit = a new immutable version. Title, what it checks, severity and
 * products are editable; a reason is required and shows in the history.
 */
export function RuleEditSheet({ rule, open, onOpenChange }: { rule: WorkspaceRule; open: boolean; onOpenChange: (open: boolean) => void }) {
  const v = rule.current;
  const initial: RuleFormValues = { title: v.title, body: v.body, severity: v.defaultSeverity, appliesTo: v.appliesTo, reason: "" };
  const [values, setValues] = useState<RuleFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = `edit-rule-${rule.id}`;

  const changed =
    values.title.trim() !== v.title ||
    values.body.trim() !== v.body ||
    values.severity !== v.defaultSeverity ||
    JSON.stringify([...values.appliesTo].sort()) !== JSON.stringify([...v.appliesTo].sort());

  function reset() {
    setValues(initial);
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
      const res = await editRule({
        ruleId: rule.id,
        title: values.title,
        body: values.body,
        severity: values.severity,
        appliesTo: values.appliesTo,
        reason: values.reason,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`Saved V${res.data.versionNo} of “${values.title.trim()}”`, {
        description: "New checks use this version. Earlier checks keep the version they ran with.",
      });
      onOpenChange(false);
      setValues({ ...values, reason: "" });
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">Edit rule</SheetTitle>
          <SheetDescription>
            {rule.code} · currently V{v.versionNo}. Saving creates V{v.versionNo + 1}; nothing is overwritten.
          </SheetDescription>
        </SheetHeader>
        <form id={formId} onSubmit={submit} className="flex-1 overflow-y-auto px-4 py-4">
          <FieldGroup className="gap-4">
            <RuleFormFields
              idPrefix={formId}
              values={values}
              onChange={(patch) => setValues((cur) => ({ ...cur, ...patch }))}
              reasonRequired
            />
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        </form>
        <SheetFooter className="flex-row items-center justify-end gap-2 border-t px-4 py-3">
          {!changed ? <span className="mr-auto text-xs text-muted-foreground">No changes yet</span> : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending || !changed || values.reason.trim().length < 3}>
            {pending ? <Spinner /> : null}
            Save as V{v.versionNo + 1}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
