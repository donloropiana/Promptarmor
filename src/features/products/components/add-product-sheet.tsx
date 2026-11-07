"use client";

import { PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { addOffer } from "@/features/products/server/actions";
import { PRODUCT_LABELS, PRODUCT_TYPES, type ProductType } from "@/features/products/catalog";

import { ProductTermFields, type TermFormValues } from "./product-term-fields";
import { fieldsForEdit } from "@/features/products/term-fields";

const CORE_FIELDS = fieldsForEdit(null);

/** "Add product": an offers row plus its first terms version. */
export function AddProductSheet({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [product, setProduct] = useState<ProductType>("personal_loan");
  const [values, setValues] = useState<TermFormValues>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = "add-product-form";

  function reset() {
    setCode("");
    setName("");
    setProduct("personal_loan");
    setValues({});
    setReason("");
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const terms: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) terms[k] = v.trim();
    startTransition(async () => {
      const res = await addOffer({ profileId, code, product, name, terms, reason: reason.trim() || "Added by a member" });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`Added product ${code.toUpperCase()}`, { description: "The next check compares ads against these terms." });
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
          Add product
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">Add product</SheetTitle>
          <SheetDescription>The real terms ads are checked against. Leave fields that do not apply empty.</SheetDescription>
        </SheetHeader>
        <form id={formId} onSubmit={submit} className="flex-1 overflow-y-auto px-4 py-4">
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="add-product-code">Code</FieldLabel>
                <Input
                  id="add-product-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={40}
                  required
                  placeholder="PL-2"
                  className="font-mono uppercase"
                />
                <FieldDescription>Short and unique, like PL-1 or CC-2.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="add-product-type">Type</FieldLabel>
                <Select value={product} onValueChange={(v) => setProduct(v as ProductType)}>
                  <SelectTrigger id="add-product-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_TYPES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRODUCT_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="add-product-name">Name</FieldLabel>
              <Input id="add-product-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required placeholder="Everyday Rewards Card" />
            </Field>
            <ProductTermFields idPrefix={formId} fields={CORE_FIELDS} values={values} onChange={(k, v) => setValues((cur) => ({ ...cur, [k]: v }))} />
            <Field>
              <FieldLabel htmlFor="add-product-reason">
                Reason <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input id="add-product-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why add this product?" />
            </Field>
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
          <Button type="submit" form={formId} disabled={pending || !code.trim() || !name.trim()}>
            {pending ? <Spinner /> : null}
            Add product
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
