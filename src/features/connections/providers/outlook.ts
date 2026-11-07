import "server-only";

import { bytesToText, clip, htmlToText, isInlineImage } from "@/features/connections/content";
import { isTextMime, MAX_STORE_BYTES, resolveMime } from "@/lib/files";
import { providerGetBytes, providerGetJson, splitLink } from "./proxy";
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
} from "@/features/connections/types";

/**
 * Outlook mail (Nango integration 'outlook', proxy base https://graph.microsoft.com).
 *
 * Initial: /me/mailFolders/inbox/messages/delta with $select and
 * $filter=receivedDateTime ge {now-30d}; follow @odata.nextLink until the
 * @odata.deltaLink, which is the incremental cursor. Expired delta state
 * (410 / syncStateNotFound / resyncRequired) => gap=true and a fresh delta
 * filtered from last_synced_at. Attachments: list metadata, then download each
 * file attachment's raw bytes via /attachments/{id}/$value. Read-only.
 */

const DELTA_SELECT =
  "id,subject,from,receivedDateTime,hasAttachments,internetMessageId,conversationId,webLink,inferenceClassification,isDraft";
const MESSAGE_SELECT =
  "id,subject,from,sender,receivedDateTime,body,internetMessageId,conversationId,webLink,hasAttachments,toRecipients";

interface OutlookCursor {
  v: 1;
  /** In-progress @odata.nextLink. */
  link?: string | null;
  /** Completed round's @odata.deltaLink. */
  deltaLink?: string | null;
  /** Lower bound for a fresh delta (initial or gap rescan). */
  since?: string | null;
  gapAt?: string;
}

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessageLite {
  id: string;
  "@removed"?: unknown;
  subject?: string;
  from?: GraphAddress;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  conversationId?: string;
  webLink?: string;
  inferenceClassification?: string;
  isDraft?: boolean;
}

interface GraphMessage extends GraphMessageLite {
  body?: { contentType?: string; content?: string };
  internetMessageId?: string;
  sender?: GraphAddress;
  toRecipients?: GraphAddress[];
}

interface GraphAttachment {
  id: string;
  "@odata.type"?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
}

function readCursor(raw: AdapterCursor): OutlookCursor {
  const c = raw as Partial<OutlookCursor>;
  return {
    v: 1,
    link: typeof c.link === "string" ? c.link : null,
    deltaLink: typeof c.deltaLink === "string" ? c.deltaLink : null,
    since: typeof c.since === "string" ? c.since : null,
    gapAt: typeof c.gapAt === "string" ? c.gapAt : undefined,
  };
}

function isExpiredDelta(err: unknown): boolean {
  if (!(err instanceof ProviderHttpError)) return false;
  if (err.status === 410) return true;
  return (err.status === 400 || err.status === 404) && /syncStateNotFound|resyncRequired|syncStateInvalid/i.test(err.message);
}

function sinceIso(lastSyncedAt: string | null, backfillDays: number): string {
  const floor = Date.now() - backfillDays * 24 * 3600 * 1000;
  if (!lastSyncedAt) return new Date(floor).toISOString();
  const t = Date.parse(lastSyncedAt) - 24 * 3600 * 1000;
  return new Date(Number.isFinite(t) ? Math.max(t, floor) : floor).toISOString();
}

function toIsoNoMillis(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

export const outlookAdapter: SourceAdapter = {
  provider: "outlook",

  async listChanges(conn: ConnectionContext, rawCursor: AdapterCursor, budget: ListBudget): Promise<ListChangesResult> {
    const c = readCursor(rawCursor);
    const headers = { Prefer: `odata.maxpagesize=${Math.max(1, Math.min(budget.maxItems, 50))}` };

    let res: { value?: GraphMessageLite[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
    try {
      const link = c.link ?? c.deltaLink;
      if (link) {
        const { endpoint, params } = splitLink(link);
        res = await providerGetJson(conn, endpoint, params, headers);
      } else {
        const since = c.since ?? sinceIso(null, budget.backfillDays);
        c.since = since;
        res = await providerGetJson(
          conn,
          "/v1.0/me/mailFolders/inbox/messages/delta",
          { $select: DELTA_SELECT, $filter: `receivedDateTime ge ${toIsoNoMillis(since)}` },
          headers,
        );
      }
    } catch (err) {
      if (isExpiredDelta(err)) {
        const next: OutlookCursor = {
          v: 1,
          link: null,
          deltaLink: null,
          since: sinceIso(conn.lastSyncedAt, budget.backfillDays),
          gapAt: new Date().toISOString(),
        };
        return { items: [], nextCursor: next as unknown as AdapterCursor, gap: true, hasMore: true };
      }
      throw err;
    }

    const items: RemoteItem[] = [];
    let filtered = 0;
    for (const m of res.value ?? []) {
      if (!m?.id || m["@removed"] || m.isDraft) {
        filtered++;
        continue;
      }
      // Mirror Gmail's "primary or has attachments": skip "Other" (non-Focused) mail without attachments.
      if (!m.hasAttachments && m.inferenceClassification && m.inferenceClassification.toLowerCase() === "other") {
        filtered++;
        continue;
      }
      items.push({
        externalId: m.id,
        sourceKey: `outlook:${m.id}:body`,
        revision: m.id,
        kind: "email",
        title: m.subject ?? null,
        modifiedAt: m.receivedDateTime ?? null,
        parentExternalId: m.conversationId ?? null,
        raw: { hasAttachments: Boolean(m.hasAttachments) },
      });
    }

    const nextLink = res["@odata.nextLink"];
    const deltaLink = res["@odata.deltaLink"];
    if (nextLink) {
      c.link = nextLink;
      return { items, nextCursor: c as unknown as AdapterCursor, hasMore: true, filtered };
    }
    c.link = null;
    if (deltaLink) {
      c.deltaLink = deltaLink;
      c.since = null;
    }
    return { items, nextCursor: c as unknown as AdapterCursor, hasMore: false, filtered };
  },

  async fetchItem(conn: ConnectionContext, item: RemoteItem): Promise<FetchedItem> {
    const id = item.externalId;
    const enc = encodeURIComponent(id);
    const msg = await providerGetJson<GraphMessage>(conn, `/v1.0/me/messages/${enc}`, { $select: MESSAGE_SELECT });

    const subject = clip(msg.subject || "(no subject)", 500) ?? "(no subject)";
    const fromAddr = msg.from?.emailAddress ?? msg.sender?.emailAddress;
    const senderEmail = fromAddr?.address?.toLowerCase() ?? null;
    const sender = fromAddr?.name || senderEmail;
    const occurredAt = msg.receivedDateTime ?? null;
    const isHtml = (msg.body?.contentType ?? "").toLowerCase() === "html";
    const content = msg.body?.content ?? "";
    const bytes = new TextEncoder().encode(content);
    const text = isHtml ? htmlToText(content) : content;

    const main: FetchedPart = {
      sourceKey: item.sourceKey,
      revision: item.revision,
      kind: "email",
      externalId: id,
      parentExternalId: msg.conversationId ?? null,
      title: subject,
      filename: `${subject}.${isHtml ? "html" : "txt"}`,
      mimeType: isHtml ? "text/html" : "text/plain",
      sizeBytes: bytes.byteLength,
      bytes,
      text: text || null,
      sourceUrl: msg.webLink ?? null,
      sender,
      senderEmail,
      occurredAt,
      metadata: {
        provider_message_id: id,
        conversation_id: msg.conversationId ?? null,
        rfc822_message_id: msg.internetMessageId ?? null,
        to: clip(
          (msg.toRecipients ?? [])
            .map((r) => r.emailAddress?.address)
            .filter(Boolean)
            .join(", ") || null,
          1000,
        ),
        body_format: isHtml ? "html" : "plain",
      },
    };

    const attachments: FetchedPart[] = [];
    const wantsAttachments = Boolean(msg.hasAttachments) || (isHtml && /src\s*=\s*["']?cid:/i.test(content));
    if (wantsAttachments) {
      const list = await providerGetJson<{ value?: GraphAttachment[] }>(conn, `/v1.0/me/messages/${enc}/attachments`, {
        $select: "id,name,contentType,size,isInline",
      });
      const nameCounts = new Map<string, number>();
      for (const a of list.value ?? []) {
        const rawName = (a.name ?? "").trim() || `attachment-${attachments.length + 1}`;
        const n = (nameCounts.get(rawName) ?? 0) + 1;
        nameCounts.set(rawName, n);
        const keyName = n === 1 ? rawName : `${rawName}#${n}`;
        const mime = resolveMime(a.contentType, rawName);
        const size = typeof a.size === "number" ? a.size : null;
        const odataType = (a["@odata.type"] ?? "#microsoft.graph.fileAttachment").toLowerCase();

        const base: FetchedPart = {
          sourceKey: `outlook:${id}:${keyName}`,
          revision: id,
          kind: "attachment",
          externalId: `${id}:${a.id}`,
          parentExternalId: id,
          title: rawName,
          filename: rawName,
          mimeType: mime,
          sizeBytes: size,
          bytes: null,
          text: null,
          sourceUrl: msg.webLink ?? null,
          sender,
          senderEmail,
          occurredAt,
          metadata: {
            provider_message_id: id,
            attachment_id: a.id,
            is_inline: Boolean(a.isInline),
            email_subject: subject,
            odata_type: odataType,
          },
        };

        if (!odataType.endsWith("fileattachment")) {
          attachments.push({ ...base, skipReason: "unsupported_attachment_type" });
          continue;
        }
        if (isInlineImage(mime, size, a.isInline ? "cid" : null, a.isInline ? "inline" : "", rawName)) {
          attachments.push({ ...base, inlineImage: true, skipReason: "inline_image" });
          continue;
        }
        if (size != null && size > MAX_STORE_BYTES) {
          attachments.push({ ...base, skipReason: "too_large" });
          continue;
        }
        try {
          const dl = await providerGetBytes(
            conn,
            `/v1.0/me/messages/${enc}/attachments/${encodeURIComponent(a.id)}/$value`,
          );
          const t = isTextMime(mime)
            ? mime === "text/html"
              ? htmlToText(bytesToText(dl.bytes))
              : bytesToText(dl.bytes)
            : null;
          attachments.push({ ...base, bytes: dl.bytes, sizeBytes: dl.bytes.byteLength, text: t });
        } catch (err) {
          attachments.push({
            ...base,
            skipReason: "fetch_failed",
            metadata: { ...base.metadata, fetch_error: String(err instanceof Error ? err.message : err).slice(0, 300) },
          });
        }
      }
    }

    return { main, attachments };
  },
};
