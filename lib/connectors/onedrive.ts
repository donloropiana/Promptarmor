import "server-only";

import { bytesToText, clip, htmlToText, isTextMime, MAX_STORE_BYTES, resolveMime } from "./content";
import { providerGetBytes, providerGetJson, splitLink } from "./proxy";
import {
  ProviderHttpError,
  type AdapterCursor,
  type ConnectionContext,
  type ConnectorProvider,
  type FetchedItem,
  type ListBudget,
  type ListChangesResult,
  type RemoteItem,
  type SourceAdapter,
} from "./types";

/**
 * OneDrive for Business ('one-drive') and OneDrive Personal ('one-drive-personal').
 *
 * Both integrations call Microsoft Graph (/v1.0/me/drive/...). Nango's
 * one-drive-personal provider authorizes against the Microsoft identity
 * platform v2 /consumers endpoint, whose tokens are for Graph (Graph /me/drive
 * works for consumer MSA accounts), even though its proxy base URL is the
 * legacy https://api.onedrive.com. Every call therefore passes
 * baseUrlOverride = Graph, matching fetchAccountEmail. Paging links are
 * absolute URLs, split into endpoint + params, and only followed to Microsoft
 * API hosts.
 *
 * Initial: {drive}/root/delta from scratch (enumerates the drive); only files
 * modified in the backfill window are imported, capped at maxBackfillItems.
 * Incremental: the stored @odata.deltaLink. Expired delta (410 / resyncRequired)
 * => gap=true and a fresh enumeration limited to items modified since
 * last_synced_at. Download: {drive}/items/{id}/content; Word/PowerPoint files
 * are converted with ?format=pdf when the service supports it. Read-only.
 */

const DELTA_SELECT =
  "id,name,file,folder,package,deleted,size,lastModifiedDateTime,eTag,cTag,parentReference,webUrl,lastModifiedBy,createdBy";

const PROFILE: Record<"one-drive" | "one-drive-personal", { base: string; drive: string }> = {
  "one-drive": { base: "https://graph.microsoft.com", drive: "/v1.0/me/drive" },
  "one-drive-personal": { base: "https://graph.microsoft.com", drive: "/v1.0/me/drive" },
};

const WANTED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/html",
  "text/plain",
  "text/csv",
  "message/rfc822",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Converted to PDF on download (CONVERT_TO_PDF); legacy .xls is neither
  // convertible nor storable, so it is not imported.
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-powerpoint",
]);

/** Converted to PDF on download (PDF is storable and readable by the AI step). */
const CONVERT_TO_PDF = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-powerpoint",
]);

interface DriveItem {
  id: string;
  name?: string;
  file?: { mimeType?: string; hashes?: Record<string, string> };
  folder?: unknown;
  package?: unknown;
  deleted?: unknown;
  size?: number;
  lastModifiedDateTime?: string;
  eTag?: string;
  cTag?: string;
  parentReference?: { id?: string; driveId?: string; path?: string };
  webUrl?: string;
  lastModifiedBy?: { user?: { displayName?: string; email?: string } };
  createdBy?: { user?: { displayName?: string; email?: string } };
}

interface OneDriveCursor {
  v: 1;
  link?: string | null;
  deltaLink?: string | null;
  /** Set while enumerating from scratch (initial or gap): only items modified after this are imported. */
  since?: string | null;
  processed?: number;
  gapAt?: string;
}

function readCursor(raw: AdapterCursor): OneDriveCursor {
  const c = raw as Partial<OneDriveCursor>;
  return {
    v: 1,
    link: typeof c.link === "string" ? c.link : null,
    deltaLink: typeof c.deltaLink === "string" ? c.deltaLink : null,
    since: typeof c.since === "string" ? c.since : null,
    processed: Number(c.processed ?? 0) || 0,
    gapAt: typeof c.gapAt === "string" ? c.gapAt : undefined,
  };
}

function sinceIso(lastSyncedAt: string | null, backfillDays: number): string {
  const floor = Date.now() - backfillDays * 24 * 3600 * 1000;
  if (!lastSyncedAt) return new Date(floor).toISOString();
  const t = Date.parse(lastSyncedAt) - 24 * 3600 * 1000;
  return new Date(Number.isFinite(t) ? Math.max(t, floor) : floor).toISOString();
}

function isExpiredDelta(err: unknown): boolean {
  if (!(err instanceof ProviderHttpError)) return false;
  if (err.status === 410) return true;
  return (err.status === 400 || err.status === 404) && /resyncRequired|syncStateNotFound|invalid.*token/i.test(err.message);
}

function profileFor(provider: ConnectorProvider) {
  return provider === "one-drive-personal" ? PROFILE["one-drive-personal"] : PROFILE["one-drive"];
}

function makeAdapter(provider: "one-drive" | "one-drive-personal"): SourceAdapter {
  return {
    provider,

    async listChanges(conn: ConnectionContext, rawCursor: AdapterCursor, budget: ListBudget): Promise<ListChangesResult> {
      const p = profileFor(conn.provider);
      const c = readCursor(rawCursor);

      let res: { value?: DriveItem[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
      try {
        const link = c.link ?? c.deltaLink;
        if (link) {
          const { endpoint, params, origin } = splitLink(link);
          res = await getJsonAt(conn, p.base, origin, endpoint, params);
        } else {
          if (!c.since) c.since = sinceIso(null, budget.backfillDays);
          c.processed = 0;
          res = await providerGetJson(conn, `${p.drive}/root/delta`, { $select: DELTA_SELECT }, undefined, {
            baseUrlOverride: p.base,
          });
        }
      } catch (err) {
        if (isExpiredDelta(err)) {
          const next: OneDriveCursor = {
            v: 1,
            link: null,
            deltaLink: null,
            since: sinceIso(conn.lastSyncedAt, budget.backfillDays),
            processed: 0,
            gapAt: new Date().toISOString(),
          };
          return { items: [], nextCursor: next as unknown as AdapterCursor, gap: true, hasMore: true };
        }
        throw err;
      }

      const sinceMs = c.since ? Date.parse(c.since) : null;
      const items: RemoteItem[] = [];
      let filtered = 0;
      for (const it of res.value ?? []) {
        if (!it?.id || it.deleted || it.folder || it.package || !it.file) {
          filtered++;
          continue;
        }
        const mime = resolveMime(it.file.mimeType, it.name);
        if (!WANTED.has(mime)) {
          filtered++;
          continue;
        }
        if (sinceMs != null) {
          const t = it.lastModifiedDateTime ? Date.parse(it.lastModifiedDateTime) : NaN;
          if (!Number.isFinite(t) || t < sinceMs || (c.processed ?? 0) >= budget.maxBackfillItems) {
            filtered++;
            continue;
          }
          c.processed = (c.processed ?? 0) + 1;
        }
        items.push({
          externalId: it.id,
          sourceKey: `onedrive:${it.id}`,
          // cTag changes only when content changes (eTag also changes on renames).
          revision: it.cTag ?? it.eTag ?? it.lastModifiedDateTime ?? null,
          kind: "file",
          title: it.name ?? null,
          mimeType: mime,
          sizeBytes: typeof it.size === "number" ? it.size : null,
          modifiedAt: it.lastModifiedDateTime ?? null,
          parentExternalId: it.parentReference?.id ?? null,
          raw: { item: it as unknown as Record<string, unknown> },
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
        c.processed = 0;
      }
      return { items, nextCursor: c as unknown as AdapterCursor, hasMore: false, filtered };
    },

    async fetchItem(conn: ConnectionContext, item: RemoteItem): Promise<FetchedItem> {
      const p = profileFor(conn.provider);
      const it = ((item.raw?.item as DriveItem | undefined) ?? { id: item.externalId }) as DriveItem;
      const name = it.name ?? "Untitled";
      const mime = resolveMime(it.file?.mimeType, name);
      const size = typeof it.size === "number" ? it.size : null;
      const who = it.lastModifiedBy?.user ?? it.createdBy?.user;
      const contentEndpoint = `${p.drive}/items/${encodeURIComponent(it.id)}/content`;

      const base = {
        sourceKey: item.sourceKey,
        revision: item.revision,
        kind: "file" as const,
        externalId: it.id,
        parentExternalId: it.parentReference?.id ?? null,
        title: clip(name, 500) ?? "Untitled",
        sourceUrl: it.webUrl ?? null,
        sender: who?.displayName ?? who?.email ?? null,
        senderEmail: who?.email?.toLowerCase() ?? null,
        occurredAt: it.lastModifiedDateTime ?? null,
        metadata: {
          drive_item_id: it.id,
          drive_id: it.parentReference?.driveId ?? null,
          etag: it.eTag ?? null,
          ctag: it.cTag ?? null,
          hashes: it.file?.hashes ?? null,
          modified_time: it.lastModifiedDateTime ?? null,
          api_base: p.base,
        } as Record<string, unknown>,
      };

      if (CONVERT_TO_PDF.has(mime)) {
        try {
          const pdf = await providerGetBytes(conn, contentEndpoint, { format: "pdf" }, { baseUrlOverride: p.base });
          if (pdf.bytes.byteLength > 0 && pdf.bytes.byteLength <= MAX_STORE_BYTES) {
            return {
              main: {
                ...base,
                filename: `${name.replace(/\.[^.]+$/, "")}.pdf`,
                mimeType: "application/pdf",
                bytes: pdf.bytes,
                sizeBytes: pdf.bytes.byteLength,
                text: null,
                metadata: { ...base.metadata, converted_from: mime, conversion: "format=pdf" },
              },
              attachments: [],
            };
          }
        } catch {
          // Conversion unsupported (e.g. some personal drives): keep the original bytes.
        }
      }

      if (size != null && size > MAX_STORE_BYTES) {
        return {
          main: { ...base, filename: name, mimeType: mime, bytes: null, sizeBytes: size, text: null, skipReason: "too_large" },
          attachments: [],
        };
      }

      // /content answers 302 to a pre-authenticated download URL; an empty body
      // for a non-empty file means the redirect was not followed. Fail the item
      // (counted, retried when re-listed) instead of hashing an empty file.
      const dl = await providerGetBytes(conn, contentEndpoint, undefined, { baseUrlOverride: p.base });
      if (dl.bytes.byteLength === 0 && size != null && size > 0) {
        throw new ProviderHttpError(502, `OneDrive returned an empty download for a ${size}-byte file (fetch_failed)`);
      }
      const text = isTextMime(mime)
        ? mime === "text/html"
          ? htmlToText(bytesToText(dl.bytes))
          : bytesToText(dl.bytes)
        : null;
      return {
        main: { ...base, filename: name, mimeType: mime, bytes: dl.bytes, sizeBytes: dl.bytes.byteLength, text },
        attachments: [],
      };
    },
  };
}

async function getJsonAt<T>(
  conn: ConnectionContext,
  expectedBase: string,
  origin: string,
  endpoint: string,
  params: Record<string, string>,
): Promise<T> {
  // Only follow links to Microsoft's own API hosts.
  if (origin !== expectedBase && origin !== "https://graph.microsoft.com" && origin !== "https://api.onedrive.com") {
    throw new ProviderHttpError(400, `Refusing paging link to unexpected host ${origin}`);
  }
  return providerGetJson<T>(conn, endpoint, params, undefined, { baseUrlOverride: origin });
}

export const oneDriveAdapter = makeAdapter("one-drive");
export const oneDrivePersonalAdapter = makeAdapter("one-drive-personal");
