"use client";

import { EyeOff, Sparkles, UploadCloud } from "lucide-react";
import { cn } from "cn";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { trySample } from "@/lib/actions/ads";

import { channelLabel, productLabel } from "./format";
import { ChooseFileButton, useAdUpload } from "./uploader";

export type SampleChip = { key: string; title: string; description: string; product: string; channel: string; hiddenText: boolean };

/** Empty workspace: one big drop box, a paste toggle and three sample chips. */
export function EmptyWorkspace({ samples, workspaceName }: { samples: SampleChip[]; workspaceName: string }) {
  const { submitFile, submitText, pending, error } = useAdUpload();
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const tooShort = text.trim().length < 10;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Nothing to review yet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ads sent or shared with members of {workspaceName} arrive here on their own. Or check one now.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) submitFile(f);
        }}
        className={cn(
          "rounded-2xl border-2 border-dashed bg-card p-6 transition-colors sm:p-10",
          dragOver ? "border-foreground/50 bg-muted" : "border-border",
        )}
      >
        {!paste ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              {pending ? <Spinner className="size-5" /> : <UploadCloud aria-hidden className="size-5 text-muted-foreground" />}
            </div>
            <div>
              <div className="text-lg font-medium">Drop an ad to check it</div>
              <p className="mt-1 text-sm text-muted-foreground">PDF, PNG, JPG, WebP, HTML or plain text. Up to 4 MB. The check starts right away.</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ChooseFileButton onFile={submitFile} pending={pending} variant="default" />
              <Button type="button" variant="outline" onClick={() => setPaste(true)} disabled={pending}>
                Paste text instead
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label htmlFor="empty-paste" className="text-sm font-medium">
              Paste the ad text
            </label>
            <Textarea
              id="empty-paste"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the whole ad, including the fine print."
              className="min-h-44"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setPaste(false)} disabled={pending}>
                Drop a file instead
              </Button>
              <Button type="button" onClick={() => submitText(text.trim())} disabled={pending || tooShort}>
                {pending ? <Spinner /> : null}
                Check this ad
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      {samples.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles aria-hidden className="size-3.5" />
            Or try a sample. Samples are tagged and never count toward your numbers.
          </div>
          <SampleChips samples={samples} />
        </div>
      )}
    </div>
  );
}

export function SampleChips({ samples }: { samples: SampleChip[] }) {
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const start = (key: string) => {
    setActive(key);
    startTransition(async () => {
      const res = await trySample(key);
      if (res && res.ok === false) {
        toast.error(res.error);
        setActive(null);
      }
    });
  };
  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {samples.map((s) => (
        <li key={s.key}>
          <button
            type="button"
            onClick={() => start(s.key)}
            disabled={pending}
            className="flex w-full flex-col items-start gap-1 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 motion-safe:active:translate-y-px"
          >
            <span className="flex w-full items-center gap-2 text-sm font-medium">
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              {pending && active === s.key ? <Spinner className="size-3.5" /> : null}
            </span>
            <span className="text-xs text-muted-foreground">{s.description}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {productLabel(s.product)}
              {s.channel ? ` · ${channelLabel(s.channel)}` : ""}
              {s.hiddenText && (
                <span className="inline-flex items-center gap-1">
                  · <EyeOff aria-hidden className="size-3" /> hidden text
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
