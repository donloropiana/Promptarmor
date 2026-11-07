"use client";

import { FileUp, Plus, UploadCloud } from "lucide-react";
import { cn } from "cn";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { uploadAd } from "@/features/ads/server/actions";
import { visibleLength } from "@/features/analysis/infer";

export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.html,.htm,.txt,application/pdf,image/png,image/jpeg,image/webp,text/html,text/plain";
const MAX_BYTES = 4 * 1024 * 1024;

function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) return "That file is over 4 MB. Export a smaller PDF or image and try again.";
  if (!/\.(pdf|png|jpe?g|webp|html?|txt)$/i.test(file.name) && !["application/pdf", "image/png", "image/jpeg", "image/webp", "text/html", "text/plain"].includes(file.type)) {
    return "Use a PDF, PNG, JPG, WebP, HTML or text file.";
  }
  return null;
}

/** Shared submit logic: one place that calls the uploadAd action and reports errors. */
export function useAdUpload() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    (fd: FormData) => {
      setError(null);
      startTransition(async () => {
        let res: Awaited<ReturnType<typeof uploadAd>> | null = null;
        try {
          res = await uploadAd(fd);
        } catch (err) {
          // The action itself did not answer: the request was refused before
          // it ran (a body too large for the server, a dropped connection).
          // The redirect on success is thrown by Next and must pass through.
          if (isNextRedirect(err)) throw err;
          const file = fd.get("file");
          const big = file instanceof File && file.size > 1024 * 1024;
          res = {
            ok: false,
            error: big
              ? "The upload did not go through: the server refused a file this large. Export a smaller PDF or image, or paste the text."
              : "The upload did not go through. Check your connection and try again.",
          };
        }
        // On success the action redirects to the new ad; only errors come back.
        if (res && res.ok === false) {
          setError(res.error);
          toast.error(res.error);
        }
      });
    },
    [startTransition],
  );

  const submitFile = useCallback(
    (file: File) => {
      const problem = validateFile(file);
      if (problem) {
        setError(problem);
        toast.error(problem);
        return;
      }
      const fd = new FormData();
      fd.set("file", file);
      submit(fd);
    },
    [submit],
  );

  const submitText = useCallback(
    (text: string, title?: string) => {
      const fd = new FormData();
      fd.set("text", text);
      if (title) fd.set("title", title);
      submit(fd);
    },
    [submit],
  );

  return { pending, error, submitFile, submitText, clearError: () => setError(null) };
}

/** Next signals redirect() by throwing; it must not be mistaken for a failure. */
function isNextRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function firstFile(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  const f = dt.files?.[0];
  return f ?? null;
}

/**
 * Full-window drop target: shows an overlay while a file is dragged over the
 * window and creates an ad on drop. Only reacts to file drags.
 */
export function WindowDropOverlay() {
  const { submitFile, pending } = useAdUpload();
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const file = firstFile(e.dataTransfer);
      if (file) submitFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [submitFile]);

  if (!over && !pending) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-foreground/40 bg-card px-8 py-10 text-center shadow-lg">
        {pending ? <Spinner className="size-6 motion-reduce:animate-none" /> : <UploadCloud aria-hidden className="size-7 text-muted-foreground" />}
        <div className="text-base font-medium">{pending ? "Adding your ad…" : "Drop to check this ad"}</div>
        <p className="text-sm text-muted-foreground">PDF, PNG, JPG, WebP, HTML or text. Up to 4 MB.</p>
      </div>
    </div>
  );
}

/** Hidden file input + trigger button. */
export function ChooseFileButton({
  onFile,
  pending,
  variant = "outline",
  size = "default",
  className,
  children,
}: {
  onFile: (f: File) => void;
  pending?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button type="button" variant={variant} size={size} className={className} disabled={pending} onClick={() => ref.current?.click()}>
        {pending ? <Spinner className="motion-reduce:animate-none" /> : <FileUp data-icon="inline-start" />}
        {children ?? "Choose file"}
      </Button>
    </>
  );
}

/** "New ad" dialog with File and Paste tabs. */
export function NewAdDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { submitFile, submitText, pending, error, clearError } = useAdUpload();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // Same rule as the server: whitespace and invisible characters do not count.
  const tooShort = visibleLength(text) < 10;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) clearError();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New ad</DialogTitle>
          <DialogDescription>The check starts right away. Product and channel are inferred; you can change them on the ad page.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="file">
          <TabsList>
            <TabsTrigger value="file">File</TabsTrigger>
            <TabsTrigger value="paste">Paste text</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="pt-3">
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
                "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
                dragOver ? "border-foreground/50 bg-muted" : "border-border",
              )}
            >
              <UploadCloud aria-hidden className="size-6 text-muted-foreground" />
              <div className="text-sm">Drop a file here</div>
              <ChooseFileButton onFile={submitFile} pending={pending} />
              <p className="text-xs text-muted-foreground">PDF, PNG, JPG, WebP, HTML or text. Up to 4 MB.</p>
            </div>
          </TabsContent>
          <TabsContent value="paste" className="space-y-3 pt-3">
            <div className="grid gap-1.5">
              <Label htmlFor="new-ad-title">Headline (optional)</Label>
              <Input id="new-ad-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Spring personal loan email" maxLength={200} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-ad-text">Ad text</Label>
              <Textarea
                id="new-ad-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the whole ad, including the fine print."
                className="min-h-40 font-sans"
                aria-describedby="new-ad-text-hint"
              />
              <p id="new-ad-text-hint" className="text-xs text-muted-foreground">
                Include every line a customer would see. Disclosures count.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" onClick={() => submitText(text.trim(), title.trim() || undefined)} disabled={pending || tooShort}>
                {pending ? <Spinner className="motion-reduce:animate-none" /> : <Plus data-icon="inline-start" />}
                Check this ad
              </Button>
            </div>
          </TabsContent>
        </Tabs>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Slim bar above the list: "Drop an ad here" + New ad. */
export function DropBar() {
  const { submitFile, pending } = useAdUpload();
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  return (
    <>
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
          "flex items-center gap-3 rounded-xl border border-dashed px-3 py-2 transition-colors sm:px-4",
          dragOver ? "border-foreground/50 bg-muted" : "border-border bg-card",
        )}
      >
        <UploadCloud aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-medium">Drop an ad here</span>
          <span className="hidden text-muted-foreground sm:inline"> or anywhere in the window. PDF, image, HTML or text.</span>
        </div>
        <ChooseFileButton onFile={submitFile} pending={pending} size="sm" variant="ghost" className="hidden sm:inline-flex" />
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" />
          New ad
        </Button>
      </div>
      <NewAdDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
