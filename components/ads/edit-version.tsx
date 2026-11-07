"use client";

import { FileUp, Pencil, UploadCloud } from "lucide-react";
import { cn } from "cn";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { addReviewerVersion } from "@/lib/actions/ads";
import type { AdVersion } from "@/lib/data/ads";
import { visibleLength } from "@/lib/intake/infer";

import { ACCEPT } from "./uploader";

/**
 * "Edit": the reviewer makes the next version from the ad page. Two tabs in
 * one sheet: Edit copy (the current text, prefilled, in a textarea) and
 * Replace file (drop or choose a PDF, image, HTML or text file, or paste
 * text). Both need a one-line "What changed" note and both create a new
 * immutable version through addReviewerVersion, which re-checks it.
 */

export type EditTab = "copy" | "file";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_NOTE = 200;

function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) return "That file is over 4 MB. Export a smaller PDF or image and try again.";
  if (!/\.(pdf|png|jpe?g|webp|html?|txt)$/i.test(file.name) && !["application/pdf", "image/png", "image/jpeg", "image/webp", "text/html", "text/plain"].includes(file.type)) {
    return "Use a PDF, PNG, JPG, WebP, HTML or text file.";
  }
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The text a reviewer edits: the pasted text when there is one (its line breaks intact), otherwise what was extracted. */
export function editableText(version: AdVersion): string {
  if (version.content.format === "text" && version.content.text) return version.content.text;
  return version.extractedText || version.content.text || "";
}

export function EditVersionSheet({
  open,
  onOpenChange,
  assetId,
  version,
  initialTab,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assetId: string;
  version: AdVersion;
  initialTab: EditTab;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-lg" aria-describedby="edit-version-desc">
        {/* Mounted only while open, so every opening starts from the current version. */}
        {open && <EditVersionForm key={version.id} assetId={assetId} version={version} initialTab={initialTab} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function EditVersionForm({ assetId, version, initialTab, onClose }: { assetId: string; version: AdVersion; initialTab: EditTab; onClose: () => void }) {
  const original = editableText(version);
  const hasText = original.trim().length > 0;
  const [tab, setTab] = useState<EditTab>(hasText ? initialTab : "file");
  const [text, setText] = useState(original);
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Land on the thing to type: the text on Edit copy, the note on Replace file.
  useEffect(() => {
    const t = setTimeout(() => (tab === "copy" ? textRef.current : noteRef.current)?.focus(), 50);
    return () => clearTimeout(t);
  }, [tab]);

  const noteOk = note.trim().length > 0 && note.trim().length <= MAX_NOTE;
  const textChanged = text.replace(/\r\n?/g, "\n").trim() !== original.trim();
  const copyOk = visibleLength(text) >= 10 && textChanged;
  const fileOk = file !== null || visibleLength(pasted) >= 10;
  const canSave = noteOk && (tab === "copy" ? copyOk : fileOk) && !pending;

  const pickFile = (f: File) => {
    const problem = validateFile(f);
    if (problem) {
      setError(problem);
      toast.error(problem);
      return;
    }
    setError(null);
    setFile(f);
  };

  const submit = () => {
    if (!canSave) return;
    setError(null);
    const fd = new FormData();
    fd.set("assetId", assetId);
    fd.set("baseVersionId", version.id);
    fd.set("note", note.trim());
    if (tab === "copy") fd.set("text", text);
    else if (file) fd.set("file", file);
    else fd.set("text", pasted);
    start(async () => {
      let res: Awaited<ReturnType<typeof addReviewerVersion>>;
      try {
        res = await addReviewerVersion(fd);
      } catch {
        // The action did not answer: the request was refused before it ran (a body too large, a dropped connection).
        res = {
          ok: false,
          error: file && file.size > 1024 * 1024 ? "The upload did not go through: the server refused a file this large. Export a smaller file and try again." : "That did not go through. Check your connection and try again.",
          code: "failed",
        };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      toast.success(`Created V${res.data.versionNo}. Checking it now.`);
    });
  };

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>Edit V{version.versionNo}</SheetTitle>
        <SheetDescription id="edit-version-desc">
          Nothing is overwritten: your change becomes V{version.versionNo + 1}, checked again, with the old version kept in History. You will be
          listed as its author, so approving it yourself needs a written reason.
        </SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as EditTab)}>
            <TabsList>
              <TabsTrigger value="copy" disabled={!hasText} title={hasText ? undefined : "No text to edit on this version"}>
                Edit copy
              </TabsTrigger>
              <TabsTrigger value="file">Replace file</TabsTrigger>
            </TabsList>
            <TabsContent value="copy" className="pt-3">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-copy-text">Ad text</Label>
                <Textarea
                  id="edit-copy-text"
                  ref={textRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-64 font-sans text-sm"
                  aria-describedby="edit-copy-hint"
                  dir="auto"
                />
                <p id="edit-copy-hint" className="text-xs text-muted-foreground">
                  {version.content.format === "text"
                    ? "Keep every line a customer would see. Disclosures count."
                    : "This is the text read from the file; saving it makes a text version. To keep the layout, use Replace file instead."}
                </p>
              </div>
            </TabsContent>
            <TabsContent value="file" className="space-y-3 pt-3">
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
                  if (f) pickFile(f);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors",
                  dragOver ? "border-foreground/50 bg-muted" : "border-border",
                )}
              >
                <UploadCloud aria-hidden className="size-5 text-muted-foreground" />
                {file ? (
                  <div className="text-sm" data-edit-file>
                    <span className="font-medium [overflow-wrap:anywhere]">{file.name}</span> <span className="text-muted-foreground">· {formatBytes(file.size)}</span>
                  </div>
                ) : (
                  <div className="text-sm">Drop the new file here</div>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  data-edit-file-input
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickFile(f);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
                  <FileUp data-icon="inline-start" />
                  {file ? "Choose another" : "Choose file"}
                </Button>
                <p className="text-xs text-muted-foreground">PDF, PNG, JPG, WebP, HTML or text. Up to 4 MB.</p>
              </div>
              {!file && (
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-paste-text">Or paste the new text</Label>
                  <Textarea id="edit-paste-text" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the whole ad, including the fine print." className="min-h-28 font-sans text-sm" dir="auto" />
                </div>
              )}
            </TabsContent>
          </Tabs>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-version-note">What changed</Label>
            <Input
              id="edit-version-note"
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tab === "copy" ? "Shortened the headline" : "New artwork from the agency"}
              maxLength={MAX_NOTE}
              required
              aria-describedby="edit-version-note-hint"
            />
            <p id="edit-version-note-hint" className="text-xs text-muted-foreground">
              One line, shown in History next to V{version.versionNo + 1}.
            </p>
          </div>
          {tab === "copy" && hasText && !textChanged && <p className="text-xs text-muted-foreground">Change the text to save a new version.</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <Pencil data-icon="inline-start" />}
            Save as V{version.versionNo + 1}
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}
