"use client";

import { CircleOff, MessageCircleQuestion, Send } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { askAboutAd } from "@/features/ads/server/actions";

/**
 * "Ask about this ad": the only AI chat in the product. Plain text in,
 * plain text out, state only (nothing is saved), no tools, no buttons in
 * answers. It sees this version, its issues and the rules they cite.
 */
export function AskBox({ versionId, versionNo }: { versionId: string; versionNo: number }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ask = () => {
    const q = question.trim();
    if (q.length < 2 || pending) return;
    setError(null);
    start(async () => {
      const res = await askAboutAd({ assetVersionId: versionId, question: q });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAnswer({ q, a: res.data.answer });
      setQuestion("");
    });
  };

  return (
    <section aria-label="Ask about this ad" className="rounded-xl border bg-card p-3.5">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <MessageCircleQuestion aria-hidden className="size-4 text-muted-foreground" />
        Ask about this ad
      </div>
      {answer && (
        <div className="mb-3 space-y-1.5 text-sm">
          <p className="text-muted-foreground">You: {answer.q}</p>
          <p className="whitespace-pre-wrap break-words" aria-live="polite">
            {answer.a}
          </p>
        </div>
      )}
      {pending && (
        <p className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Spinner className="size-3.5 motion-reduce:animate-none" /> Reading V{versionNo}…
        </p>
      )}
      {error && (
        <p role="alert" className="mb-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm">
          <CircleOff aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder="Why was the APR flagged? What does this rule require?"
          aria-label="Your question"
          className="min-h-9 flex-1 resize-none py-2 text-sm"
          rows={1}
          maxLength={1000}
        />
        <Button type="submit" size="icon" variant="outline" aria-label="Ask" disabled={pending || question.trim().length < 2}>
          {pending ? <Spinner className="motion-reduce:animate-none" /> : <Send />}
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">Reads and answers. Can&apos;t approve, reject or change rules.</p>
    </section>
  );
}
