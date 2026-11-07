import "server-only";

import {
  base64ToBytes,
  bytesToText,
  charsetOf,
  clip,
  htmlToText,
  isInlineImage,
  isTextMime,
  MAX_STORE_BYTES,
  parseAddress,
  resolveMime,
} from "./content";
import { providerGetJson } from "./proxy";
import {
  ProviderHttpError,
  type AdapterCursor,
  type ConnectionContext,
  type FetchedItem,
  type FetchedPart,
  type ListBudget,
  type ListChangesResult,
  type RemoteItem,
  type SourceAdapter,
} from "./types";

/**
 * Gmail (Nango integration 'google-mail', proxy base https://gmail.googleapis.com).
 *
 * Initial: users.getProfile for the starting historyId, then a bounded
 * messages.list backfill with q 'newer_than:30d (has:attachment OR category:primary)'.
 * Incremental: users.history.list from the stored historyId (messageAdded).
 * Expired historyId (HTTP 404) => gap=true and a bounded rescan since
 * last_synced_at. Read-only endpoints only.
 */

const API = "/gmail/v1/users/me";
const SELECT_QUERY = "(has:attachment OR category:primary)";

interface GmailCursor {
  v: 1;
  historyId?: string;
  historyPageToken?: string | null;
  /** Highest historyId seen while paging a history listing; adopted when paging ends. */
  pendingHistoryId?: string | null;
  backfill?: {
    query: string;
    pageToken: string | null;
    processed: number;
    done: boolean;
  };
  gapAt?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

function readCursor(raw: AdapterCursor): GmailCursor {
  const c = raw as Partial<GmailCursor>;
  return {
    v: 1,
    historyId: typeof c.historyId === "string" ? c.historyId : undefined,
    historyPageToken: typeof c.historyPageToken === "string" ? c.historyPageToken : null,
    pendingHistoryId: typeof c.pendingHistoryId === "string" ? c.pendingHistoryId : null,
    backfill:
      c.backfill && typeof c.backfill === "object"
        ? {
            query: String(c.backfill.query ?? ""),
            pageToken: typeof c.backfill.pageToken === "string" ? c.backfill.pageToken : null,
            processed: Number(c.backfill.processed ?? 0) || 0,
            done: Boolean(c.backfill.done),
          }
        : undefined,
    gapAt: typeof c.gapAt === "string" ? c.gapAt : undefined,
  };
}

function maxHistoryId(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  try {
    return BigInt(a) >= BigInt(b) ? a : b;
  } catch {
    return b;
  }
}

function remoteFor(id: string, threadId: string | null | undefined): RemoteItem {
  return {
    externalId: id,
    sourceKey: `gmail:${id}:body`,
    revision: id, // Gmail messages are immutable; the id is the revision.
    kind: "email",
    parentExternalId: threadId ?? null,
    raw: { threadId: threadId ?? null },
  };
}

/**
 * Labels that make an added message worth fetching. Any inbox tab counts:
 * creative a colleague forwards with a PDF often lands in Updates or
 * Promotions, and the backfill query already imports those when they have an
 * attachment. classify.ts decides marketing vs not_marketing after the fetch.
 */
function wantedByLabels(labels: string[] | undefined): boolean {
  const l = new Set(labels ?? []);
  if (l.has("DRAFT") || l.has("SPAM") || l.has("TRASH") || l.has("CHAT")) return false;
  return l.has("INBOX");
}

async function freshStart(
  conn: ConnectionContext,
  query: string,
): Promise<GmailCursor> {
  const profile = await providerGetJson<{ historyId?: string; emailAddress?: string }>(conn, `${API}/profile`);
  return {
    v: 1,
    historyId: profile.historyId ? String(profile.historyId) : undefined,
    historyPageToken: null,
    pendingHistoryId: null,
    backfill: { query, pageToken: null, processed: 0, done: false },
  };
}

function rescanQuery(since: string | null, backfillDays: number): string {
  if (!since) return `newer_than:${backfillDays}d ${SELECT_QUERY}`;
  // Re-scan from a day before the last good sync; dedupe makes overlap free.
  const secs = Math.floor((Date.parse(since) - 24 * 3600 * 1000) / 1000);
  const floor = Math.floor((Date.now() - backfillDays * 24 * 3600 * 1000) / 1000);
  return `after:${Math.max(secs, floor)} ${SELECT_QUERY}`;
}

export const gmailAdapter: SourceAdapter = {
  provider: "google-mail",

  async listChanges(conn: ConnectionContext, rawCursor: AdapterCursor, budget: ListBudget): Promise<ListChangesResult> {
    let c = readCursor(rawCursor);

    if (!c.historyId) {
      c = await freshStart(conn, `newer_than:${budget.backfillDays}d ${SELECT_QUERY}`);
      if (!c.historyId) throw new ProviderHttpError(502, "Gmail returned no historyId");
    }

    // Phase 1: bounded backfill (initial sync or gap rescan).
    if (c.backfill && !c.backfill.done) {
      const remaining = budget.maxBackfillItems - c.backfill.processed;
      if (remaining <= 0) {
        c.backfill = { ...c.backfill, done: true, pageToken: null };
        return { items: [], nextCursor: c as unknown as AdapterCursor, hasMore: true };
      }
      const params: Record<string, string | number> = {
        q: c.backfill.query,
        maxResults: Math.max(1, Math.min(budget.maxItems, remaining, 100)),
      };
      if (c.backfill.pageToken) params.pageToken = c.backfill.pageToken;
      const list = await providerGetJson<{
        messages?: { id: string; threadId: string }[];
        nextPageToken?: string;
      }>(conn, `${API}/messages`, params);
      const items = (list.messages ?? []).map((m) => remoteFor(m.id, m.threadId));
      const processed = c.backfill.processed + items.length;
      const pageToken = list.nextPageToken ?? null;
      c.backfill = {
        ...c.backfill,
        processed,
        pageToken,
        done: !pageToken || processed >= budget.maxBackfillItems,
      };
      // hasMore stays true after the backfill so the same run moves on to history.
      return { items, nextCursor: c as unknown as AdapterCursor, hasMore: true };
    }

    // Phase 2: incremental via history.
    const params: Record<string, string | number> = {
      startHistoryId: c.historyId!,
      historyTypes: "messageAdded",
      maxResults: Math.max(1, Math.min(budget.maxItems, 500)),
    };
    if (c.historyPageToken) params.pageToken = c.historyPageToken;

    let res: {
      history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
      nextPageToken?: string;
      historyId?: string;
    };
    try {
      res = await providerGetJson(conn, `${API}/history`, params);
    } catch (err) {
      if (err instanceof ProviderHttpError && err.status === 404) {
        // startHistoryId is too old: Google says to do a full sync. Do a
        // bounded rescan since the last good sync instead.
        const next = await freshStart(conn, rescanQuery(conn.lastSyncedAt, budget.backfillDays));
        next.gapAt = new Date().toISOString();
        return { items: [], nextCursor: next as unknown as AdapterCursor, gap: true, hasMore: true };
      }
      throw err;
    }

    const seen = new Set<string>();
    const items: RemoteItem[] = [];
    let filtered = 0;
    for (const h of res.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        const m = added.message;
        if (!m?.id || seen.has(m.id)) continue;
        seen.add(m.id);
        if (!wantedByLabels(m.labelIds)) {
          filtered++;
          continue;
        }
        items.push(remoteFor(m.id, m.threadId));
      }
    }

    const pending = maxHistoryId(c.pendingHistoryId, res.historyId ?? null);
    if (res.nextPageToken) {
      c.historyPageToken = res.nextPageToken;
      c.pendingHistoryId = pending;
      return { items, nextCursor: c as unknown as AdapterCursor, hasMore: true, filtered };
    }
    c.historyId = pending ?? c.historyId;
    c.historyPageToken = null;
    c.pendingHistoryId = null;
    c.backfill = undefined;
    return { items, nextCursor: c as unknown as AdapterCursor, hasMore: false, filtered };
  },

  async fetchItem(conn: ConnectionContext, item: RemoteItem): Promise<FetchedItem> {
    const id = item.externalId;
    const msg = await providerGetJson<GmailMessage>(conn, `${API}/messages/${encodeURIComponent(id)}`, {
      format: "full",
    });

    const top = headerMap(msg.payload?.headers);
    const subject = clip(top.get("subject") ?? "(no subject)", 500) ?? "(no subject)";
    const from = parseAddress(top.get("from"));
    const occurredAt = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : top.get("date")
        ? safeIso(top.get("date")!)
        : null;
    const sourceUrl = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(msg.threadId ?? id)}`;

    const bodies: { html: GmailPart[]; plain: GmailPart[] } = { html: [], plain: [] };
    const attachmentParts: GmailPart[] = [];
    walk(msg.payload, bodies, attachmentParts);

    // ---- body ----
    let html: { bytes: Uint8Array; text: string } | null = null;
    let plain: { bytes: Uint8Array; text: string } | null = null;
    if (bodies.html[0]) html = await readTextPart(conn, id, bodies.html[0]);
    if (!html && bodies.plain[0]) plain = await readTextPart(conn, id, bodies.plain[0]);

    const snippet = msg.snippet ? htmlToText(msg.snippet) : "";
    const mainText = html ? htmlToText(html.text) : plain ? plain.text : snippet;
    const mainBytes = html?.bytes ?? plain?.bytes ?? new TextEncoder().encode(mainText);
    const mainMime = html ? "text/html" : "text/plain";

    const main: FetchedPart = {
      sourceKey: item.sourceKey,
      revision: item.revision,
      kind: "email",
      externalId: id,
      parentExternalId: msg.threadId ?? null,
      title: subject,
      filename: `${subject}.${html ? "html" : "txt"}`,
      mimeType: mainMime,
      sizeBytes: mainBytes.byteLength,
      bytes: mainBytes,
      text: mainText || null,
      sourceUrl,
      sender: from.name ?? from.email,
      senderEmail: from.email,
      occurredAt,
      metadata: {
        provider_message_id: id,
        thread_id: msg.threadId ?? null,
        label_ids: msg.labelIds ?? [],
        rfc822_message_id: top.get("message-id") ?? null,
        to: clip(top.get("to") ?? null, 1000),
        attachment_count: attachmentParts.length,
        body_format: html ? "html" : plain ? "plain" : "snippet",
      },
    };

    // ---- attachments ----
    const attachments: FetchedPart[] = [];
    const nameCounts = new Map<string, number>();
    for (const part of attachmentParts) {
      const ph = headerMap(part.headers);
      const rawName = (part.filename || "").trim() || `attachment-${part.partId ?? attachments.length + 1}`;
      const mime = resolveMime(part.mimeType, rawName);
      const size = typeof part.body?.size === "number" ? part.body.size : null;
      const contentId = ph.get("content-id") ?? ph.get("x-attachment-id") ?? null;
      const disposition = (ph.get("content-disposition") ?? "").toLowerCase();

      const n = (nameCounts.get(rawName) ?? 0) + 1;
      nameCounts.set(rawName, n);
      const keyName = n === 1 ? rawName : `${rawName}#${n}`;

      const base: FetchedPart = {
        sourceKey: `gmail:${id}:${keyName}`,
        revision: id,
        kind: "attachment",
        externalId: `${id}:${part.partId ?? keyName}`,
        parentExternalId: id,
        title: rawName,
        filename: rawName,
        mimeType: mime,
        sizeBytes: size,
        bytes: null,
        text: null,
        sourceUrl,
        sender: from.name ?? from.email,
        senderEmail: from.email,
        occurredAt,
        metadata: {
          provider_message_id: id,
          thread_id: msg.threadId ?? null,
          part_id: part.partId ?? null,
          content_id: contentId ? clip(contentId, 200) : null,
          disposition: disposition.split(";")[0] || null,
          email_subject: subject,
        },
      };

      if (isInlineImage(mime, size, contentId, disposition, rawName)) {
        attachments.push({ ...base, inlineImage: true, skipReason: "inline_image" });
        continue;
      }
      if (size != null && size > MAX_STORE_BYTES) {
        attachments.push({ ...base, skipReason: "too_large" });
        continue;
      }
      try {
        const bytes = await readPartBytes(conn, id, part);
        const text = isTextMime(mime)
          ? mime === "text/html"
            ? htmlToText(bytesToText(bytes, charsetOf(ph.get("content-type"))))
            : bytesToText(bytes, charsetOf(ph.get("content-type")))
          : null;
        attachments.push({ ...base, bytes, sizeBytes: bytes.byteLength, text });
      } catch (err) {
        attachments.push({
          ...base,
          skipReason: "fetch_failed",
          metadata: { ...base.metadata, fetch_error: errMessage(err) },
        });
      }
    }

    return { main, attachments };
  },
};

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

function headerMap(headers: GmailHeader[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of headers ?? []) {
    const k = h.name.toLowerCase();
    if (!m.has(k)) m.set(k, h.value);
  }
  return m;
}

function walk(part: GmailPart | undefined, bodies: { html: GmailPart[]; plain: GmailPart[] }, atts: GmailPart[]): void {
  if (!part) return;
  if (part.parts && part.parts.length) {
    for (const p of part.parts) walk(p, bodies, atts);
    return;
  }
  const mime = (part.mimeType ?? "").toLowerCase();
  const disposition = (headerMap(part.headers).get("content-disposition") ?? "").toLowerCase();
  const hasName = Boolean(part.filename && part.filename.trim());
  const isAttachment = hasName || disposition.startsWith("attachment");
  if (!isAttachment && mime === "text/html") {
    bodies.html.push(part);
    return;
  }
  if (!isAttachment && mime === "text/plain") {
    bodies.plain.push(part);
    return;
  }
  if (isAttachment || part.body?.attachmentId) {
    if (mime.startsWith("multipart/")) return;
    atts.push(part);
  }
}

async function readPartBytes(conn: ConnectionContext, messageId: string, part: GmailPart): Promise<Uint8Array> {
  if (part.body?.data) return base64ToBytes(part.body.data);
  if (part.body?.attachmentId) {
    const res = await providerGetJson<{ data?: string; size?: number }>(
      conn,
      `${API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
    );
    return res.data ? base64ToBytes(res.data) : new Uint8Array();
  }
  return new Uint8Array();
}

async function readTextPart(
  conn: ConnectionContext,
  messageId: string,
  part: GmailPart,
): Promise<{ bytes: Uint8Array; text: string } | null> {
  try {
    const bytes = await readPartBytes(conn, messageId, part);
    if (!bytes.byteLength) return null;
    const charset = charsetOf(headerMap(part.headers).get("content-type"));
    return { bytes, text: bytesToText(bytes, charset) };
  } catch {
    return null;
  }
}

function safeIso(s: string): string | null {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function errMessage(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 300);
}
