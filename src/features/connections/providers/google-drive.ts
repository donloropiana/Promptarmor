import "server-only";

import { bytesToText, clip, htmlToText, isTextMime, MAX_STORE_BYTES, resolveMime } from "@/features/connections/content";
import { providerGetBytes, providerGetJson } from "./proxy";
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
 * Google Drive (Nango integration 'google-drive', proxy base https://www.googleapis.com).
 *
 * Initial: changes.getStartPageToken (so nothing is missed while the backfill
 * runs), then files.list of recent files (modifiedTime > now-30d, not
 * trashed, not folders), bounded by maxBackfillItems.
 * Incremental: changes.list from the stored page token.
 * Binary files download with files.get alt=media; Docs/Slides export to PDF
 * (stored) plus text/plain (extracted text, hashed), Sheets export to CSV,
 * Drawings to PNG. Read-only endpoints only.
 */

const API = "/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const GDOC = "application/vnd.google-apps.document";
const GSLIDES = "application/vnd.google-apps.presentation";
const GSHEET = "application/vnd.google-apps.spreadsheet";
const GDRAWING = "application/vnd.google-apps.drawing";

const FILE_FIELDS =
  "id,name,mimeType,md5Checksum,headRevisionId,modifiedTime,size,trashed,webViewLink,parents," +
  "owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress)";

/** Binary types worth importing (everything else is filtered before fetching). */
const WANTED_BINARY = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "text/html",
  "text/plain",
  "text/csv",
  "message/rfc822",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Not imported: .pptx/.ppt/.doc/.xls are not storable (bucket allowlist)
  // and Drive can only convert binary Office files by copying them, which is
  // a write. Native Google Docs/Slides are exported instead.
]);
const WANTED_NATIVE = new Set([GDOC, GSLIDES, GSHEET, GDRAWING]);

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  md5Checksum?: string;
  headRevisionId?: string;
  modifiedTime?: string;
  size?: string;
  trashed?: boolean;
  webViewLink?: string;
  parents?: string[];
  owners?: { displayName?: string; emailAddress?: string }[];
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

interface DriveCursor {
  v: 1;
  changesPageToken?: string;
  backfill?: { since: string; pageToken: string | null; processed: number; done: boolean };
  gapAt?: string;
}

function readCursor(raw: AdapterCursor): DriveCursor {
  const c = raw as Partial<DriveCursor>;
  return {
    v: 1,
    changesPageToken: typeof c.changesPageToken === "string" ? c.changesPageToken : undefined,
    backfill:
      c.backfill && typeof c.backfill === "object"
        ? {
            since: String(c.backfill.since ?? ""),
            pageToken: typeof c.backfill.pageToken === "string" ? c.backfill.pageToken : null,
            processed: Number(c.backfill.processed ?? 0) || 0,
            done: Boolean(c.backfill.done),
          }
        : undefined,
    gapAt: typeof c.gapAt === "string" ? c.gapAt : undefined,
  };
}

function wanted(f: DriveFile | undefined): f is DriveFile {
  if (!f || !f.id || f.trashed) return false;
  const mime = (f.mimeType ?? "").toLowerCase();
  if (mime === FOLDER) return false;
  if (mime.startsWith("application/vnd.google-apps.")) return WANTED_NATIVE.has(mime);
  return WANTED_BINARY.has(resolveMime(mime, f.name));
}

function revisionOf(f: DriveFile): string | null {
  return f.headRevisionId ?? f.md5Checksum ?? f.modifiedTime ?? null;
}

function toRemote(f: DriveFile): RemoteItem {
  return {
    externalId: f.id,
    sourceKey: `gdrive:${f.id}`,
    revision: revisionOf(f),
    kind: "file",
    title: f.name ?? null,
    mimeType: f.mimeType ?? null,
    sizeBytes: f.size != null ? Number(f.size) : null,
    modifiedAt: f.modifiedTime ?? null,
    parentExternalId: f.parents?.[0] ?? null,
    raw: { file: f as unknown as Record<string, unknown> },
  };
}

async function startToken(conn: ConnectionContext): Promise<string> {
  const res = await providerGetJson<{ startPageToken?: string }>(conn, `${API}/changes/startPageToken`, {
    supportsAllDrives: "true",
  });
  if (!res.startPageToken) throw new ProviderHttpError(502, "Drive returned no startPageToken");
  return res.startPageToken;
}

function sinceIso(lastSyncedAt: string | null, backfillDays: number): string {
  const floor = Date.now() - backfillDays * 24 * 3600 * 1000;
  if (!lastSyncedAt) return new Date(floor).toISOString();
  const t = Date.parse(lastSyncedAt) - 24 * 3600 * 1000;
  return new Date(Number.isFinite(t) ? Math.max(t, floor) : floor).toISOString();
}

function isExpiredTokenError(err: unknown): boolean {
  if (!(err instanceof ProviderHttpError)) return false;
  if (err.status === 404 || err.status === 410) return true;
  return err.status === 400 && /page ?token|invalid value/i.test(err.message);
}

export const googleDriveAdapter: SourceAdapter = {
  provider: "google-drive",

  async listChanges(conn: ConnectionContext, rawCursor: AdapterCursor, budget: ListBudget): Promise<ListChangesResult> {
    let c = readCursor(rawCursor);

    if (!c.changesPageToken) {
      c = {
        v: 1,
        changesPageToken: await startToken(conn),
        backfill: { since: sinceIso(null, budget.backfillDays), pageToken: null, processed: 0, done: false },
      };
    }

    // Phase 1: recent files backfill.
    if (c.backfill && !c.backfill.done) {
      const remaining = budget.maxBackfillItems - c.backfill.processed;
      if (remaining <= 0) {
        c.backfill = { ...c.backfill, done: true, pageToken: null };
        return { items: [], nextCursor: c as unknown as AdapterCursor, hasMore: true };
      }
      const params: Record<string, string | number> = {
        q: `modifiedTime > '${c.backfill.since.replace(/\.\d{3}Z$/, "Z")}' and trashed = false and mimeType != '${FOLDER}'`,
        orderBy: "modifiedTime desc",
        pageSize: Math.max(1, Math.min(budget.maxItems, remaining, 100)),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        spaces: "drive",
        // Same coverage as changes.list (which includes shared drives).
        corpora: "allDrives",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      };
      if (c.backfill.pageToken) params.pageToken = c.backfill.pageToken;
      const res = await providerGetJson<{ files?: DriveFile[]; nextPageToken?: string }>(conn, `${API}/files`, params);
      const files = res.files ?? [];
      const items = files.filter(wanted).map(toRemote);
      const processed = c.backfill.processed + files.length;
      const pageToken = res.nextPageToken ?? null;
      c.backfill = { ...c.backfill, processed, pageToken, done: !pageToken || processed >= budget.maxBackfillItems };
      return {
        items,
        nextCursor: c as unknown as AdapterCursor,
        hasMore: true,
        filtered: files.length - items.length,
      };
    }

    // Phase 2: incremental changes.
    let res: {
      changes?: { fileId?: string; removed?: boolean; changeType?: string; file?: DriveFile }[];
      nextPageToken?: string;
      newStartPageToken?: string;
    };
    try {
      res = await providerGetJson(conn, `${API}/changes`, {
        pageToken: c.changesPageToken!,
        pageSize: Math.max(1, Math.min(budget.maxItems * 4, 1000)),
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,changeType,file(${FILE_FIELDS}))`,
        includeRemoved: "false",
        spaces: "drive",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
    } catch (err) {
      if (isExpiredTokenError(err)) {
        const next: DriveCursor = {
          v: 1,
          changesPageToken: await startToken(conn),
          backfill: {
            since: sinceIso(conn.lastSyncedAt, budget.backfillDays),
            pageToken: null,
            processed: 0,
            done: false,
          },
          gapAt: new Date().toISOString(),
        };
        return { items: [], nextCursor: next as unknown as AdapterCursor, gap: true, hasMore: true };
      }
      throw err;
    }

    const seen = new Set<string>();
    const items: RemoteItem[] = [];
    let filtered = 0;
    for (const ch of res.changes ?? []) {
      if (ch.removed || (ch.changeType && ch.changeType !== "file")) {
        filtered++;
        continue;
      }
      const f = ch.file;
      if (!wanted(f) || seen.has(f.id)) {
        filtered++;
        continue;
      }
      seen.add(f.id);
      items.push(toRemote(f));
    }

    if (res.nextPageToken) {
      c.changesPageToken = res.nextPageToken;
      return { items, nextCursor: c as unknown as AdapterCursor, hasMore: true, filtered };
    }
    c.changesPageToken = res.newStartPageToken ?? c.changesPageToken;
    c.backfill = undefined;
    return { items, nextCursor: c as unknown as AdapterCursor, hasMore: false, filtered };
  },

  async fetchItem(conn: ConnectionContext, item: RemoteItem): Promise<FetchedItem> {
    const f = ((item.raw?.file as DriveFile | undefined) ?? { id: item.externalId }) as DriveFile;
    const id = encodeURIComponent(f.id);
    const name = f.name ?? "Untitled";
    const nativeMime = (f.mimeType ?? "").toLowerCase();
    const owner = f.lastModifyingUser ?? f.owners?.[0];

    const base: Omit<FetchedPart, "filename" | "mimeType" | "bytes" | "text" | "sizeBytes"> = {
      sourceKey: item.sourceKey,
      revision: item.revision,
      kind: "file",
      externalId: f.id,
      parentExternalId: f.parents?.[0] ?? null,
      title: clip(name, 500) ?? "Untitled",
      sourceUrl: f.webViewLink ?? `https://drive.google.com/file/d/${id}/view`,
      sender: owner?.displayName ?? owner?.emailAddress ?? null,
      senderEmail: owner?.emailAddress?.toLowerCase() ?? null,
      occurredAt: f.modifiedTime ?? null,
      metadata: {
        drive_file_id: f.id,
        drive_mime_type: f.mimeType ?? null,
        md5_checksum: f.md5Checksum ?? null,
        head_revision_id: f.headRevisionId ?? null,
        modified_time: f.modifiedTime ?? null,
        owner_email: f.owners?.[0]?.emailAddress ?? null,
      },
    };

    // Google-native files: export.
    if (nativeMime === GDOC || nativeMime === GSLIDES) {
      const pdf = await exportAs(conn, id, "application/pdf");
      let text: string | null = null;
      try {
        const txt = await exportAs(conn, id, "text/plain");
        text = bytesToText(txt.bytes).trim() || null;
      } catch {
        text = null;
      }
      return {
        main: {
          ...base,
          filename: `${name}.pdf`,
          mimeType: "application/pdf",
          bytes: pdf.bytes,
          sizeBytes: pdf.bytes.byteLength,
          text,
          // PDF exports embed timestamps; hash the exported text when we have it.
          hashBasis: text ? "exported_text" : "bytes",
          metadata: { ...base.metadata, export: "application/pdf", text_export: text ? "text/plain" : null },
        },
        attachments: [],
      };
    }
    if (nativeMime === GSHEET) {
      const csv = await exportAs(conn, id, "text/csv");
      return {
        main: {
          ...base,
          filename: `${name}.csv`,
          mimeType: "text/csv",
          bytes: csv.bytes,
          sizeBytes: csv.bytes.byteLength,
          text: bytesToText(csv.bytes),
          metadata: { ...base.metadata, export: "text/csv", export_note: "first sheet only" },
        },
        attachments: [],
      };
    }
    if (nativeMime === GDRAWING) {
      const png = await exportAs(conn, id, "image/png");
      return {
        main: {
          ...base,
          filename: `${name}.png`,
          mimeType: "image/png",
          bytes: png.bytes,
          sizeBytes: png.bytes.byteLength,
          text: null,
          metadata: { ...base.metadata, export: "image/png" },
        },
        attachments: [],
      };
    }

    // Binary content.
    const mime = resolveMime(f.mimeType, name);
    const size = f.size != null ? Number(f.size) : null;
    if (size != null && size > MAX_STORE_BYTES) {
      return {
        main: { ...base, filename: name, mimeType: mime, bytes: null, sizeBytes: size, text: null, skipReason: "too_large" },
        attachments: [],
      };
    }
    const dl = await providerGetBytes(conn, `${API}/files/${id}`, { alt: "media", supportsAllDrives: "true" });
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

async function exportAs(conn: ConnectionContext, encodedId: string, mimeType: string) {
  return providerGetBytes(conn, `${API}/files/${encodedId}/export`, { mimeType });
}
