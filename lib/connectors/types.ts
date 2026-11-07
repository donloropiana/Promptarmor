/**
 * Connector sync contracts.
 *
 * A SourceAdapter knows how to page through one provider's changes (Gmail,
 * Drive, Outlook, OneDrive) and how to fetch one item's bytes. It never writes
 * to the database: lib/connectors/sync.ts owns hashing, storage, dedupe,
 * classification and the source_items rows.
 *
 * Every provider call is READ-ONLY and goes through Nango's proxy
 * (lib/connectors/proxy.ts -> lib/nango/server.ts).
 */

import type { IntegrationKey } from "@/lib/nango/integrations";

export type ConnectorProvider = IntegrationKey;

/** The connection row fields an adapter needs. Never built from browser input. */
export interface ConnectionContext {
  /** connections.id */
  id: string;
  profileId: string;
  provider: ConnectorProvider;
  /** Nango connection id (from our DB row only). */
  nangoConnectionId: string;
  /** Nango integration unique key (equals provider). */
  providerConfigKey: string;
  /** ISO timestamp of the last fully caught-up sync, or null. */
  lastSyncedAt: string | null;
}

/**
 * Opaque per-adapter cursor, persisted in connections.cursor (jsonb) after
 * every page. Adapters own its shape; it must stay JSON-serializable.
 */
export type AdapterCursor = Record<string, unknown>;

export interface ListBudget {
  /** Upper bound on items returned by this page. */
  maxItems: number;
  /** Epoch ms after which the adapter should stop making extra calls. */
  deadline: number;
  /** Total items to backfill on an initial sync or gap rescan. */
  maxBackfillItems: number;
  /** Initial backfill window (days). */
  backfillDays: number;
}

export interface RemoteItem {
  /** Provider id (Gmail message id, Drive file id, Graph id). */
  externalId: string;
  /** source_key of the primary part (email body or file). */
  sourceKey: string;
  /** source_revision of the primary part (Drive headRevisionId/modifiedTime, Graph cTag/eTag, message id). */
  revision: string | null;
  kind: "email" | "file";
  title?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  /** Thread or parent folder id. */
  parentExternalId?: string | null;
  /** Provider metadata the adapter needs again in fetchItem. JSON only. */
  raw?: Record<string, unknown>;
}

export interface ListChangesResult {
  items: RemoteItem[];
  /** Cursor to persist once every item of this page has been handled. */
  nextCursor: AdapterCursor;
  /** True when the provider said the stored cursor expired (Gmail history 404, Drive token, Graph 410). */
  gap?: boolean;
  /** True when another listChanges call would return more items right now. */
  hasMore: boolean;
  /** Changes seen but dropped by cheap filters (folders, trash, spam, deleted, out of window). */
  filtered?: number;
}

export type ItemKind = "email" | "attachment" | "file";

/**
 * One storable unit. An email yields one part for its body plus one per
 * attachment; a file yields one part.
 */
export interface FetchedPart {
  sourceKey: string;
  revision: string | null;
  kind: ItemKind;
  externalId: string;
  parentExternalId?: string | null;
  title: string;
  /** Original filename (unsanitized; sync sanitizes it for Storage). */
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  /** Exact bytes to hash and store. null when deliberately not fetched. */
  bytes: Uint8Array | null;
  /** Natively extracted text (plain/html/csv/exported text), else null. */
  text: string | null;
  /**
   * What content_sha256 is computed from. 'exported_text' is used for Google
   * Docs/Slides, whose PDF exports are not byte-stable (schema allows this).
   */
  hashBasis?: "bytes" | "exported_text";
  sourceUrl?: string | null;
  sender?: string | null;
  senderEmail?: string | null;
  occurredAt?: string | null;
  /** Signature logo / CID image: recorded as classification 'inline_image', bytes not fetched. */
  inlineImage?: boolean;
  /** Why bytes were not fetched (too_large, unsupported, inline, fetch_failed...). */
  skipReason?: string;
  metadata: Record<string, unknown>;
}

export interface FetchedItem {
  main: FetchedPart;
  attachments: FetchedPart[];
}

export interface SourceAdapter {
  provider: ConnectorProvider;
  /** Page through changes since `cursor` (an empty object means "never synced"). */
  listChanges(conn: ConnectionContext, cursor: AdapterCursor, budget: ListBudget): Promise<ListChangesResult>;
  /** Fetch one listed item with its bytes and attachments. Read-only. */
  fetchItem(conn: ConnectionContext, item: RemoteItem): Promise<FetchedItem>;
}

export type SyncKind = "initial" | "incremental" | "gap_rescan" | "manual";

export interface SyncStats {
  new: number;
  modified: number;
  duplicates: number;
  skipped: number;
  errors: number;
  /** Items already imported (dedupe key or revision already present). */
  unchanged: number;
  /** Changes dropped by adapter filters before fetching. */
  filtered: number;
  pages: number;
  marketing: number;
  not_marketing: number;
  uncertain: number;
  inline_images: number;
  gap: boolean;
  has_more: boolean;
  error_samples: string[];
}

/** Error thrown for non-2xx provider responses (normalized from the Nango proxy). */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Error that means the user must reconnect (revoked/expired credentials).
 * 401 only: Google and Graph also answer 403 for per-item problems (Drive
 * exportSizeLimitExceeded, cannotDownloadAbusiveFile, insufficientFilePermissions
 * on a view-only file, Graph accessDenied on one item), which must not stop
 * the run or flag the connection. lib/connectors/proxy.ts maps Nango's
 * reconnect codes and account-level scope 403s to 401.
 */
export function isAuthError(err: unknown): boolean {
  return err instanceof ProviderHttpError && err.status === 401;
}

export function isRateLimited(err: unknown): boolean {
  return err instanceof ProviderHttpError && err.status === 429;
}
