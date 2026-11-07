"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { updateAdMeta } from "@/lib/actions/ads";
import type { Product } from "@/lib/types/ads";

import { CHANNEL_OPTIONS, PRODUCT_OPTIONS, channelLabel, normaliseChannel, productLabel } from "./format";

/** Product and channel as editable chips. Each change is an audit event. */
export function MetaChips({ assetId, product, channel, inferred, disabled }: { assetId: string; product: Product; channel: string | null; inferred?: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [p, setP] = useState<Product>(product);
  const [c, setC] = useState<string>(normaliseChannel(channel) ?? "");

  const save = (patch: { product?: Product; channel?: string | null }) =>
    start(async () => {
      const res = await updateAdMeta({ assetId, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        setP(product);
        setC(normaliseChannel(channel) ?? "");
      }
    });

  const channelOptions = c && !CHANNEL_OPTIONS.some((o) => o.value === c) ? [...CHANNEL_OPTIONS, { value: c, label: channelLabel(c) }] : CHANNEL_OPTIONS;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={p}
        disabled={disabled || pending}
        onValueChange={(v) => {
          setP(v as Product);
          save({ product: v as Product });
        }}
      >
        <SelectTrigger size="sm" aria-label="Product" className="h-6 gap-1 rounded-full border px-2 text-xs [&>svg]:size-3">
          <SelectValue>{productLabel(p)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PRODUCT_OPTIONS.map((o) => (
            <SelectItem key={o} value={o}>
              {productLabel(o)}
            </SelectItem>
          ))}
          {p === "unknown" && <SelectItem value="unknown">Unknown product</SelectItem>}
        </SelectContent>
      </Select>
      <Select
        value={c || "__none"}
        disabled={disabled || pending}
        onValueChange={(v) => {
          const next = v === "__none" ? "" : v;
          setC(next);
          save({ channel: next || null });
        }}
      >
        <SelectTrigger size="sm" aria-label="Channel" className="h-6 gap-1 rounded-full border px-2 text-xs [&>svg]:size-3">
          <SelectValue>{c ? channelLabel(c) : "Channel unknown"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Channel unknown</SelectItem>
          {channelOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Spinner className="size-3" />}
      {inferred && !pending && <span className="text-[11px] text-muted-foreground">inferred</span>}
    </div>
  );
}
