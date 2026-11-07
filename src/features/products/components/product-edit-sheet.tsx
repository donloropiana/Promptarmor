"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { editOffer, previewOfferChange, type OfferChangePreview } from "@/features/products/server/actions";
import type { WorkspaceOffer } from "@/features/products/server/queries";

import { ProductTermFields, type TermFormValues } from "./product-term-fields";
import { fieldsForEdit, TERM_FIELDS, termInputValue } from "@/features/products/term-fields";

const TERM_KIND = new Map(TERM_FIELDS.map((f) => [f.key, f.kind]));

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}

/** Scalar terms become form strings; nested objects/arrays are kept aside and carried over on save. */
/** Stored numbers come into the editor with their unit ("2" -> "2%", "95" -> "$95") so the value says what it is; saving reads the number back out. */
function toFormValues(terms: Record<string, unknown>): TermFormValues {
  const out: TermFormValues = {};
  for (const [k, v] of Object.entries(terms)) {
    if (!isScalar(v)) continue;
    const kind = TERM_KIND.get(k);
    if (typeof v === "number" && kind === "percent") out[k] = `${termInputValue(v)}%`;
    else if (typeof v === "number" && kind === "money") out[k] = `$${termInputValue(v)}`;
    else if (typeof v === "number" && kind === "months") out[k] = `${termInputValue(v)} months`;
    else out[k] = termInputValue(v);
  }
  return out;
}

function toTerms(values: TermFormValues, carry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...carry };
  for (const [k, v] of Object.entries(values)) {
    const s = v.trim();
    if (s === "") continue;
    out[k] = s;
  }
  return out;
}

/**
 * "Edit terms" -> confirm "This sends N approved ads back to Needs review"
 * -> a new immutable terms version. N is computed on the server when the
 * confirm opens, from the checks that approved ads relied on.
 */
export function ProductEditSheet({ offer, open, onOpenChange }: { offer: WorkspaceOffer; open: boolean; onOpenChange: (open: boolean) => void }) {
  const initial = toFormValues(offer.current.terms);
  const carry = Object.fromEntries(Object.entries(offer.current.terms).filter(([, v]) => !isScalar(v)));
  const fields = fieldsForEdit(offer.current.terms);
  const [values, setValues] = useState<TermFormValues>(initial);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OfferChangePreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewing, startPreview] = useTransition();
  const [saving, startSave] = useTransition();
  const formId = `edit-offer-${offer.id}`;

  const changed = JSON.stringify(toTerms(values, carry)) !== JSON.stringify(toTerms(initial, carry));

  function reset() {
    setValues(initial);
    setReason("");
    setError(null);
    setPreview(null);
  }

  function openConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startPreview(async () => {
      const res = await previewOfferChange({ offerId: offer.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res.data);
      setConfirmOpen(true);
    });
  }

  function save() {
    startSave(async () => {
      const res = await editOffer({ offerId: offer.id, terms: toTerms(values, carry), reason });
      setConfirmOpen(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const n = res.data.affected;
      toast.success(`Saved ${offer.code} V${res.data.versionNo}`, {
        description:
          n === 0
            ? "No approved ads relied on the old terms."
            : `${n} approved ${n === 1 ? "ad is" : "ads are"} back in Needs review, tagged “Rates changed”.`,
      });
      onOpenChange(false);
      setReason("");
    });
  }

  const n = preview?.count ?? 0;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) reset();
          onOpenChange(next);
        }}
      >
        <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle className="text-base">Edit terms · {offer.code}</SheetTitle>
            <SheetDescription>
              {offer.name} · currently V{offer.current.versionNo}. Saving creates V{offer.current.versionNo + 1}; approved ads that relied on the old
              terms go back to Needs review.
            </SheetDescription>
          </SheetHeader>
          <form id={formId} onSubmit={openConfirm} className="flex-1 overflow-y-auto px-4 py-4">
            <FieldGroup className="gap-4">
              <ProductTermFields idPrefix={formId} fields={fields} values={values} onChange={(k, v) => setValues((cur) => ({ ...cur, [k]: v }))} />
              <Field>
                <FieldLabel htmlFor={`${formId}-reason`}>Reason</FieldLabel>
                <Input
                  id={`${formId}-reason`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  maxLength={500}
                  placeholder="Why did the terms change? Shown in the product's history."
                />
              </Field>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </form>
          <SheetFooter className="flex-row items-center justify-end gap-2 border-t px-4 py-3">
            {!changed ? <span className="mr-auto text-xs text-muted-foreground">No changes yet</span> : null}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving || previewing}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={saving || previewing || !changed || reason.trim().length < 3}>
              {previewing ? <Spinner /> : null}
              Save as V{offer.current.versionNo + 1}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {n === 0 ? "Save new terms?" : `This sends ${n} approved ${n === 1 ? "ad" : "ads"} back to Needs review`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {n === 0
                ? `No approved ad relied on ${offer.code} V${preview?.currentVersionNo ?? offer.current.versionNo}. Future checks use the new terms.`
                : `${n === 1 ? "It was" : "They were"} approved against ${offer.code} V${preview?.currentVersionNo ?? offer.current.versionNo}. Each one is tagged “Rates changed” and needs a fresh decision.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && preview.ads.length > 0 ? (
            <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
              {preview.ads.map((a) => (
                <li key={a.id} className="truncate border-b px-3 py-1.5 last:border-b-0">
                  {a.title}
                </li>
              ))}
            </ul>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                save();
              }}
              disabled={saving}
            >
              {saving ? <Spinner /> : null}
              {n === 0 ? "Save terms" : `Save and send ${n} back`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
