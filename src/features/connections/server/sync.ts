import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { looksLikeInstruction } from "@/features/analysis/hidden-text";
import { logConnectionEvent } from "./connections";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";

import { classifyItem, type ClassifyResult } from "@/features/connections/classify";
import { clip, MIN_TEXT_FOR_HASH_DEDUPE, normalizedTextHash, sha256Hex } from "@/features/connections/content";
import { isImageMime, MAX_STORE_BYTES, sanitizeFilename, STORABLE_MIME } from "@/lib/files";
import { getAdapter } from "@/features/connections/providers/registry";
import {
  isAuthError,
  isRateLimited,
  ProviderHttpError,
  type AdapterCursor,
  type ConnectionContext,
  type ConnectorProvider,
  type FetchedPart,
  type ListBudget,
  type RemoteItem,
  type SourceAdapter,
  type SyncKind,
  type SyncStats,
} from "@/features/connections/types";

/**
 * Connector sync pipeline (server only, secret-key client).
 *
 * runConnectionSync pages through adapter.listChanges within a time budget
 * (Vercel Hobby functions), persisting the cursor after every fully handled
 * page. For every item it hashes the bytes (Web Crypto sha256) and the
 * normalized text, classifies it, inserts source_items idempotently
 * (ON CONFLICT (profile_id, source_key, source_revision, content_sha256) DO
 * NOTHING), uploads the original bytes to private-assets at
 * profiles/{profile_id}/sources/{source_item_id}/original/{filename}, and
 * finally updates the connection and the sync_runs row.
 *
 * A single bad item never aborts the run; it is counted in stats.errors.
 * Callers must authorize the user first (route) or be trusted server code
 * (webhook / cron); this module trusts the connection id it is given.
 */

type Admin = SupabaseClient<Database>;

const BUCKET = "private-assets";
const SOURCE_COLUMNS = "id, content_sha256, classification, asset_id, triage_status, connection_id, visibility, metadata";
const MAX_EXTRACTED_TEXT = 200_000;
/** Stop starting new work this long before the deadline. */
const SAFETY_MS = 2_500;
/** Hard stop against empty-page loops (each page is at least one provider call). */
const MAX_PAGES_PER_RUN = 60;

export interface RunSyncOptions {
  /** sync_runs.kind. Default: 'initial' when the connection has no cursor, else 'incremental'. */
  kind?: SyncKind;
  /** Wall-clock budget for this invocation. Default 45s (route maxDuration is 60s). */
  timeBudgetMs?: number;
  /** Items per provider page. Default 20. */
  pageSize?: number;
  /** Cap for an initial backfill or gap rescan. Default 50. */
  maxBackfillItems?: number;
  /** Initial backfill window. Default 14 days (what the Connected accounts card promises). */
  backfillDays?: number;
  /** Discard the stored cursor and start a fresh backfill. */
  resetCursor?: boolean;
  /** User who triggered the run (manual sync), for the audit event. */
  triggeredBy?: string | null;
  /** Inject a client (tests / scripts). Defaults to the secret-key admin client. */
  admin?: Admin;
}

export type ConnectionStatus = "connected" | "syncing" | "needs_reconnect" | "error" | "disconnected";

export interface RunSyncResult {
  ok: boolean;
  connectionId: string;
  syncRunId: string | null;
  kind: SyncKind;
  status: ConnectionStatus | null;
  stats: SyncStats;
  /**
   * More pages are waiting; call again. The connection is left 'connected'
   * (stats.has_more = true, last_synced_at unchanged) so the UI does not show
   * a permanent spinner when nobody calls again.
   */
  hasMore: boolean;
  error?: string;
  skipped?: "not_configured" | "not_found" | "disconnected" | "unsupported_provider" | "already_running";
}

interface ConnectionRow {
  id: string;
  profile_id: string;
  provider: ConnectorProvider;
  provider_config_key: string;
  nango_connection_id: string;
  connected_by: string | null;
  status: ConnectionStatus;
  cursor: AdapterCursor | null;
  last_synced_at: string | null;
}

interface ExistingSource {
  id: string;
  content_sha256: string | null;
  classification: string;
  asset_id: string | null;
  triage_status: string;
  connection_id: string | null;
  visibility: string;
  metadata: Record<string, unknown> | null;
}

function emptyStats(): SyncStats {
  return {
    new: 0,
    modified: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    unchanged: 0,
    filtered: 0,
    pages: 0,
    marketing: 0,
    not_marketing: 0,
    uncertain: 0,
    inline_images: 0,
    gap: false,
    has_more: false,
    error_samples: [],
  };
}

function errText(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 500);
}

function noteError(stats: SyncStats, where: string, err: unknown): void {
  stats.errors++;
  if (stats.error_samples.length < 5) stats.error_samples.push(`${where}: ${errText(err)}`.slice(0, 300));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runConnectionSync(connectionId: string, opts: RunSyncOptions = {}): Promise<RunSyncResult> {
  const startedAt = Date.now();
  const budgetMs = Math.max(5_000, opts.timeBudgetMs ?? 45_000);
  const deadline = startedAt + budgetMs;
  const stats = emptyStats();
  const base = { connectionId, syncRunId: null, stats, hasMore: false } as const;

  const admin = (opts.admin ?? createSupabaseAdminClient()) as Admin | null;
  if (!admin) {
    console.warn("[sync] Supabase admin client not configured; skipping sync.");
    return { ...base, ok: false, kind: opts.kind ?? "manual", status: null, skipped: "not_configured" };
  }

  // ---- load the connection ----
  const { data: connData, error: connErr } = await admin
    .from("connections")
    .select("id, profile_id, provider, provider_config_key, nango_connection_id, connected_by, status, cursor, last_synced_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (connErr) {
    return { ...base, ok: false, kind: opts.kind ?? "manual", status: null, error: `connection lookup failed: ${connErr.message}` };
  }
  const row = connData as ConnectionRow | null;
  if (!row) return { ...base, ok: false, kind: opts.kind ?? "manual", status: null, skipped: "not_found" };
  if (row.status === "disconnected") {
    return { ...base, ok: false, kind: opts.kind ?? "manual", status: row.status, skipped: "disconnected" };
  }

  const adapter = getAdapter(row.provider);
  if (!adapter) {
    return { ...base, ok: false, kind: opts.kind ?? "manual", status: row.status, skipped: "unsupported_provider" };
  }

  // ---- one run at a time per connection (best effort) ----
  const lockWindowMs = Math.max(90_000, budgetMs + 30_000);
  // A run killed by a platform timeout never reaches its finish block: close
  // it so the history does not show it running forever.
  await admin
    .from("sync_runs")
    .update({ finished_at: new Date().toISOString(), error: "Timed out before finishing" })
    .eq("connection_id", row.id)
    .eq("profile_id", row.profile_id)
    .is("finished_at", null)
    .lt("started_at", new Date(Date.now() - lockWindowMs).toISOString());
  const { data: running } = await admin
    .from("sync_runs")
    .select("id")
    .eq("connection_id", row.id)
    .eq("profile_id", row.profile_id)
    .is("finished_at", null)
    .gte("started_at", new Date(Date.now() - lockWindowMs).toISOString())
    .limit(1);
  if (running && running.length > 0) {
    return { ...base, ok: false, kind: opts.kind ?? "manual", status: row.status, skipped: "already_running" };
  }

  let cursor: AdapterCursor = opts.resetCursor ? {} : (row.cursor ?? {});
  const neverSynced = Object.keys(cursor).length === 0;
  let kind: SyncKind = opts.kind ?? (neverSynced ? "initial" : "incremental");
  if (kind === "incremental" && neverSynced) kind = "initial";

  const { data: runRow, error: runErr } = await admin
    .from("sync_runs")
    .insert({ profile_id: row.profile_id, connection_id: row.id, kind, stats: { requested_kind: kind } })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return { ...base, ok: false, kind, status: row.status, error: `could not start sync run: ${runErr?.message ?? "no row"}` };
  }
  const syncRunId = (runRow as { id: string }).id;

  const { data: started } = await admin
    .from("connections")
    .update({ status: "syncing" })
    .eq("id", row.id)
    .eq("profile_id", row.profile_id)
    .neq("status", "disconnected") // a disconnect since the load above wins
    .select("id");
  if (!started || started.length === 0) {
    await admin
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), error: "Connection was disconnected" })
      .eq("id", syncRunId);
    return { ...base, ok: false, kind, syncRunId, status: "disconnected", skipped: "disconnected" };
  }

  // Connections of the same member: duplicates are only matched against items
  // that member can already see (or profile-visible items), never against
  // another member's private mail.
  const ownerConnectionIds = await loadOwnerConnectionIds(admin, row);

  const conn: ConnectionContext = {
    id: row.id,
    profileId: row.profile_id,
    provider: row.provider,
    nangoConnectionId: row.nango_connection_id,
    providerConfigKey: row.provider_config_key,
    lastSyncedAt: row.last_synced_at,
  };
  const budget: ListBudget = {
    maxItems: Math.max(1, Math.min(opts.pageSize ?? 20, 100)),
    deadline,
    maxBackfillItems: Math.max(1, opts.maxBackfillItems ?? 50),
    backfillDays: Math.max(1, opts.backfillDays ?? 14),
  };
  const ctx: PipelineCtx = { admin, conn, row, adapter, stats, ownerConnectionIds, deadline };

  let hasMore = false;
  let fatal: unknown = null;

  try {
    for (;;) {
      if (Date.now() > deadline - SAFETY_MS) {
        hasMore = true;
        break;
      }
      if (stats.pages >= MAX_PAGES_PER_RUN) {
        hasMore = true;
        break;
      }
      const page = await adapter.listChanges(conn, cursor, budget);
      stats.pages++;
      stats.filtered += page.filtered ?? 0;
      if (page.gap && stats.gap) {
        // The fresh cursor expired again immediately: stop instead of looping.
        throw new Error("Provider cursor expired twice in one run");
      }
      if (page.gap) {
        stats.gap = true;
        kind = "gap_rescan";
        await admin.from("sync_runs").update({ kind }).eq("id", syncRunId);
      }

      let completed = true;
      for (const item of page.items) {
        if (Date.now() > deadline - SAFETY_MS) {
          completed = false;
          break;
        }
        await processRemoteItem(ctx, item);
      }
      if (!completed) {
        // Do not advance past items we did not reach; they are re-listed next
        // run and the already-handled ones are skipped cheaply.
        hasMore = true;
        break;
      }

      cursor = page.nextCursor;
      const { error: curErr } = await admin
        .from("connections")
        .update({ cursor: cursor as Json })
        .eq("id", row.id)
        .eq("profile_id", row.profile_id);
      if (curErr) noteError(stats, "persist cursor", curErr.message);
      await admin
        .from("sync_runs")
        .update({ stats: { ...stats, requested_kind: opts.kind ?? null } })
        .eq("id", syncRunId);

      if (!page.hasMore) {
        hasMore = false;
        break;
      }
    }
  } catch (err) {
    fatal = err;
  }

  // ---- finish ----
  stats.has_more = hasMore;
  let status: ConnectionStatus;
  let lastError: string | null = null;
  const connUpdate: Database["public"]["Tables"]["connections"]["Update"] = {};

  if (fatal) {
    if (isAuthError(fatal)) {
      status = "needs_reconnect";
      lastError = "Access was revoked or expired. Reconnect this account to resume syncing.";
    } else if (isRateLimited(fatal)) {
      status = "connected";
      lastError = "The provider rate-limited this sync; it resumes from the saved cursor next time.";
      hasMore = true;
      stats.has_more = true;
    } else {
      status = "error";
      lastError = `Sync failed: ${errText(fatal)}`.slice(0, 500);
    }
    noteError(stats, "sync", fatal);
  } else if (hasMore) {
    // Out of time with more to fetch: idle, not "syncing" (stats.has_more
    // tells the UI a backfill is still catching up; callers loop on hasMore).
    status = "connected";
  } else {
    status = "connected";
    connUpdate.last_synced_at = new Date().toISOString();
  }
  connUpdate.status = status;
  connUpdate.last_error = lastError;

  const { error: finConnErr } = await admin
    .from("connections")
    .update(connUpdate)
    .eq("id", row.id)
    .eq("profile_id", row.profile_id)
    .neq("status", "disconnected"); // a disconnect during the run wins
  if (finConnErr) console.error("[sync] connection update failed:", finConnErr.message);

  const runError = fatal ? errText(fatal) : null;
  const { error: finRunErr } = await admin
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      stats: { ...stats, requested_kind: opts.kind ?? null, duration_ms: Date.now() - startedAt },
      error: runError,
    })
    .eq("id", syncRunId);
  if (finRunErr) console.error("[sync] sync_runs update failed:", finRunErr.message);

  await logConnectionEvent(
    row.profile_id,
    "connection.synced",
    {
      connection_id: row.id,
      sync_run_id: syncRunId,
      provider: row.provider,
      kind,
      new: stats.new,
      modified: stats.modified,
      duplicates: stats.duplicates,
      skipped: stats.skipped,
      errors: stats.errors,
      gap: stats.gap,
      has_more: hasMore,
      status,
    },
    opts.triggeredBy ?? null,
  );

  return {
    ok: !fatal,
    connectionId,
    syncRunId,
    kind,
    status,
    stats,
    hasMore,
    ...(runError ? { error: runError } : {}),
  };
}

// ---------------------------------------------------------------------------
// Per item
// ---------------------------------------------------------------------------

interface PipelineCtx {
  admin: Admin;
  conn: ConnectionContext;
  row: ConnectionRow;
  adapter: SourceAdapter;
  stats: SyncStats;
  ownerConnectionIds: string[];
  deadline: number;
}

async function loadOwnerConnectionIds(admin: Admin, row: ConnectionRow): Promise<string[]> {
  if (!row.connected_by) return [row.id];
  const { data } = await admin
    .from("connections")
    .select("id")
    .eq("profile_id", row.profile_id)
    .eq("connected_by", row.connected_by);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  return ids.includes(row.id) ? ids : [...ids, row.id];
}

/**
 * Handles one listed item (and its attachments). Never throws.
 *
 * The primary row is inserted with metadata.complete = false and flipped to
 * true only after every attachment and the stored original went through
 * without an error. A re-listed item (run cut short by the deadline or a
 * platform timeout, cursor not advanced) is therefore skipped cheaply only
 * when it is complete; otherwise it is fetched again and processPart's exact
 * dedupe makes the already-imported parts no-ops while the missing ones
 * (attachments, failed uploads) are retried.
 */
async function processRemoteItem(ctx: PipelineCtx, item: RemoteItem): Promise<void> {
  try {
    const existing = await findByKeyRevision(ctx, item.sourceKey, item.revision);
    if (existing && existing.metadata?.complete !== false) {
      ctx.stats.unchanged++;
      return;
    }

    const errorsBefore = ctx.stats.errors;
    const fetched = await ctx.adapter.fetchItem(ctx.conn, item);
    const main = await processPart(ctx, fetched.main, null, { primary: true });
    for (const att of fetched.attachments) {
      await processPart(ctx, att, main?.id ?? null);
    }
    if (main && main.metadata.complete === false && ctx.stats.errors === errorsBefore) {
      main.metadata.complete = true;
      const { error } = await ctx.admin
        .from("source_items")
        .update({ metadata: main.metadata as Json })
        .eq("id", main.id)
        .eq("profile_id", ctx.conn.profileId);
      if (error) noteError(ctx.stats, `complete ${item.sourceKey.slice(0, 80)}`, error.message);
    }
  } catch (err) {
    // Auth / rate-limit failures are run-level: stop the run.
    if (err instanceof ProviderHttpError && (isAuthError(err) || isRateLimited(err))) throw err;
    noteError(ctx.stats, `item ${item.sourceKey.slice(0, 80)}`, err);
  }
}

async function findByKeyRevision(ctx: PipelineCtx, sourceKey: string, revision: string | null): Promise<ExistingSource | null> {
  let q = ctx.admin
    .from("source_items")
    .select(SOURCE_COLUMNS)
    .eq("profile_id", ctx.conn.profileId)
    .eq("source_key", sourceKey);
  q = revision == null ? q.is("source_revision", null) : q.eq("source_revision", revision);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(`source lookup failed: ${error.message}`);
  return ((data ?? [])[0] as ExistingSource | undefined) ?? null;
}

function extractionState(part: FetchedPart, text: string | null): string {
  if (part.inlineImage) return "skipped_inline";
  if (!part.bytes) return "none";
  if (text) return "native";
  if (part.mimeType === "application/pdf") return "pending_pdf";
  if (isImageMime(part.mimeType)) return "pending_image";
  return "unsupported";
}

/** The source already reached the profile through a human triage action or an asset link (mirrors source_items.visibility). */
function isPromoted(s: ExistingSource): boolean {
  return s.asset_id != null || ["accepted", "merged", "split", "versioned"].includes(s.triage_status);
}

/** Stored bytes are missing although they should be there (upload failed or the run died mid-way). */
function needsStorageRetry(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.storage === "pending" || metadata?.storage === "failed";
}

interface PartResult {
  id: string;
  /** The row's metadata as last written (mutated in place by storeOriginal). */
  metadata: Record<string, unknown>;
}

/**
 * Hash, dedupe, classify, insert and store one part. Returns the source item
 * (new or pre-existing) so attachments can point at their email, or null on
 * an item-level error (counted in stats.errors).
 */
async function processPart(
  ctx: PipelineCtx,
  part: FetchedPart,
  parentSourceItemId: string | null,
  opts: { primary?: boolean } = {},
): Promise<PartResult | null> {
  const { admin, conn, stats } = ctx;
  try {
    const text = part.text && part.text.trim() ? part.text : null;

    // ---- hashes ----
    let contentSha: string | null = null;
    if (part.bytes) {
      contentSha =
        part.hashBasis === "exported_text" && text ? await sha256Hex(text) : await sha256Hex(part.bytes);
    }
    const { hash: textHash, length: normLen } = await normalizedTextHash(text);

    // ---- already imported (exact dedupe key)? ----
    {
      let q = admin
        .from("source_items")
        .select("id, metadata, classification")
        .eq("profile_id", conn.profileId)
        .eq("source_key", part.sourceKey);
      q = part.revision == null ? q.is("source_revision", null) : q.eq("source_revision", part.revision);
      q = contentSha == null ? q.is("content_sha256", null) : q.eq("content_sha256", contentSha);
      const { data } = await q.limit(1);
      const hit = (data ?? [])[0] as { id: string; metadata: Record<string, unknown> | null } | undefined;
      if (hit) {
        stats.unchanged++;
        const hitMeta: Record<string, unknown> = { ...(hit.metadata ?? {}) };
        // Re-listed after an interrupted run: finish the upload it missed.
        if (needsStorageRetry(hitMeta) && part.bytes && part.bytes.byteLength > 0) {
          await storeOriginal(ctx, hit.id, part, hitMeta);
        }
        return { id: hit.id, metadata: hitMeta };
      }
    }

    // ---- classify / version / duplicate ----
    const pre: ClassifyResult = classifyItem({
      kind: part.kind,
      title: part.title,
      filename: part.filename,
      mimeType: part.mimeType,
      sizeBytes: part.sizeBytes,
      text,
      sender: part.sender,
      senderEmail: part.senderEmail,
      inlineImage: part.inlineImage,
      parentTitle: typeof part.metadata.email_subject === "string" ? part.metadata.email_subject : null,
    });

    let classification: string = pre.classification;
    let reason = pre.reason;
    let duplicateOf: string | null = null;
    let candidateAssetId: string | null = null;
    let matchScore: number | null = null;
    let matchReason: string | null = null;
    let outcome: "new" | "modified" | "duplicate" = "new";

    if (!part.inlineImage) {
      // Same source object seen before with other content => modified source.
      const { data: priorRows, error: priorErr } = await admin
        .from("source_items")
        .select(SOURCE_COLUMNS)
        .eq("profile_id", conn.profileId)
        .eq("source_key", part.sourceKey)
        .order("created_at", { ascending: false })
        .limit(1);
      if (priorErr) throw new Error(`prior lookup failed: ${priorErr.message}`);
      const prior = (priorRows ?? [])[0] as ExistingSource | undefined;

      if (prior) {
        if (contentSha && prior.content_sha256 === contentSha) {
          // New provider revision, same content (rename, metadata edit): nothing new.
          stats.unchanged++;
          return { id: prior.id, metadata: { ...(prior.metadata ?? {}) } };
        }
        outcome = "modified";
        if (isPromoted(prior)) {
          // Only sources that already reached the profile become versions;
          // a changed private item stays private and is re-classified.
          classification = "new_version";
          reason = "Same source changed since it was imported";
          candidateAssetId = prior.asset_id;
          matchScore = 1;
          matchReason = "Same source (provider id); content hash changed";
        }
      } else if (contentSha || (textHash && normLen >= MIN_TEXT_FOR_HASH_DEDUPE)) {
        const dup = await findDuplicate(ctx, part.sourceKey, contentSha, normLen >= MIN_TEXT_FOR_HASH_DEDUPE ? textHash : null);
        if (dup) {
          outcome = "duplicate";
          classification = "duplicate";
          duplicateOf = dup.id;
          reason = dup.by === "sha" ? "Same bytes as an item already imported" : "Same text as an item already imported";
        }
      }
    }

    // ---- insert (idempotent) ----
    const id = crypto.randomUUID();
    const extraction = extractionState(part, text);
    const metadata: Record<string, unknown> = {
      ...part.metadata,
      extraction,
      hash_basis: part.bytes ? (part.hashBasis ?? "bytes") : null,
      ...(part.skipReason ? { skip_reason: part.skipReason } : {}),
      ...(pre.classification !== classification ? { pre_classification: pre.classification, pre_reason: pre.reason } : {}),
      // Primary rows: flipped to true by processRemoteItem once attachments and storage succeeded.
      ...(opts.primary ? { complete: false } : {}),
    };
    const keepText = classification !== "not_marketing" && classification !== "inline_image";
    // Bytes are kept only for items that may reach triage; not_marketing,
    // duplicates and inline images keep title, sender and hashes only.
    const shouldStore =
      part.bytes != null &&
      part.bytes.byteLength > 0 &&
      (classification === "marketing" || classification === "uncertain" || classification === "new_version");
    metadata.storage = shouldStore ? "pending" : part.bytes ? "not_stored" : "none";

    const insertRow = {
      id,
      profile_id: conn.profileId,
      connection_id: conn.id,
      provider: conn.provider,
      kind: part.kind,
      external_id: clip(part.externalId, 1000),
      parent_external_id: clip(part.parentExternalId ?? null, 1000),
      parent_source_item_id: parentSourceItemId,
      source_key: clip(part.sourceKey, 1000),
      source_revision: clip(part.revision, 500),
      source_url: clip(part.sourceUrl ?? null, 2000),
      title: clip(part.title, 1000),
      sender: clip(part.sender ?? null, 500),
      sender_email: clip(part.senderEmail ?? null, 320),
      occurred_at: part.occurredAt ?? null,
      mime_type: clip(part.mimeType, 255),
      size_bytes: part.sizeBytes ?? (part.bytes ? part.bytes.byteLength : null),
      content_sha256: contentSha,
      normalized_text_hash: textHash,
      extracted_text: keepText && text ? clip(text, MAX_EXTRACTED_TEXT) : null,
      metadata: metadata as Json,
      classification,
      classification_reason: clip(reason, 1000),
      inferred: pre.inferred as Json,
      candidate_asset_id: candidateAssetId,
      match_score: matchScore,
      match_reason: matchReason,
      duplicate_of: duplicateOf,
    };

    const { data: inserted, error: insErr } = await admin
      .from("source_items")
      .upsert(insertRow, {
        onConflict: "profile_id,source_key,source_revision,content_sha256",
        ignoreDuplicates: true,
      })
      .select("id");
    if (insErr) throw new Error(`insert failed: ${insErr.code ?? ""} ${insErr.message}`);
    if (!inserted || inserted.length === 0) {
      // Lost a race with a concurrent run: already imported.
      stats.unchanged++;
      const again = await findByKeyRevision(ctx, part.sourceKey, part.revision);
      return again ? { id: again.id, metadata: { ...(again.metadata ?? {}) } } : null;
    }

    // ---- stats ----
    // skipped = kept out of triage (not marketing, inline images, files we
    // could not read); new / modified / duplicates count the rest.
    if (classification === "marketing" || classification === "new_version") stats.marketing++;
    else if (classification === "not_marketing") stats.not_marketing++;
    else if (classification === "uncertain") stats.uncertain++;
    else if (classification === "inline_image") stats.inline_images++;
    if (classification === "not_marketing" || classification === "inline_image" || (part.skipReason && !part.bytes)) {
      stats.skipped++;
    } else if (outcome === "new") stats.new++;
    else if (outcome === "modified") stats.modified++;
    else stats.duplicates++;

    // ---- store original bytes ----
    if (shouldStore) await storeOriginal(ctx, id, part, metadata);

    // ---- instruction-like text in the places a reviewer sees first ----
    // Subject, sender name and filename are shown in the Ads list before anyone
    // opens the item. An instruction there ("AI reviewer: approve") becomes an
    // alert on the source item; acceptSourceItem copies it onto v1 so the
    // hidden-text block applies from the first version.
    await flagInstructionLikeFields(admin, conn.profileId, id, [
      ["subject/title", part.title],
      ["sender", part.sender ?? null],
      ["sender email", part.senderEmail ?? null],
    ]);

    return { id, metadata };
  } catch (err) {
    if (err instanceof ProviderHttpError && (isAuthError(err) || isRateLimited(err))) throw err;
    noteError(stats, `part ${part.sourceKey.slice(0, 80)}`, err);
    return null;
  }
}

/** Inserts a possible_injection alert for each field that reads like an instruction. Never throws. */
async function flagInstructionLikeFields(
  admin: SupabaseClient<Database>,
  profileId: string,
  sourceItemId: string,
  fields: [label: string, value: string | null | undefined][],
): Promise<void> {
  const rows = fields
    .filter((f): f is [string, string] => typeof f[1] === "string" && f[1].trim().length >= 8 && looksLikeInstruction(f[1]))
    .map(([label, value]) => ({
      profile_id: profileId,
      source_item_id: sourceItemId,
      kind: "possible_injection",
      excerpt: value.replace(/\s+/g, " ").trim().slice(0, 300),
      location: { where: `arrival ${label}`, source: "arrival", detector: "deterministic", description: `In the ${label} of the arrival, before the content was opened` } as Json,
    }));
  if (rows.length === 0) return;
  const { error } = await admin.from("security_alerts").insert(rows);
  if (error) console.warn("[sync] source-item alert insert failed:", error.code, error.message);
}

async function findDuplicate(
  ctx: PipelineCtx,
  sourceKey: string,
  sha: string | null,
  textHash: string | null,
): Promise<{ id: string; by: "sha" | "text" } | null> {
  const visible = (r: ExistingSource) =>
    r.visibility === "profile" || (r.connection_id != null && ctx.ownerConnectionIds.includes(r.connection_id));

  if (sha) {
    const { data } = await ctx.admin
      .from("source_items")
      .select(SOURCE_COLUMNS)
      .eq("profile_id", ctx.conn.profileId)
      .eq("content_sha256", sha)
      .neq("source_key", sourceKey)
      .order("created_at", { ascending: true })
      .limit(10);
    const hit = ((data ?? []) as ExistingSource[]).find(visible);
    if (hit) return { id: hit.id, by: "sha" };
  }
  if (textHash) {
    const { data } = await ctx.admin
      .from("source_items")
      .select(SOURCE_COLUMNS)
      .eq("profile_id", ctx.conn.profileId)
      .eq("normalized_text_hash", textHash)
      .neq("source_key", sourceKey)
      .order("created_at", { ascending: true })
      .limit(10);
    const hit = ((data ?? []) as ExistingSource[]).find(visible);
    if (hit) return { id: hit.id, by: "text" };
  }
  return null;
}

async function storeOriginal(
  ctx: PipelineCtx,
  sourceItemId: string,
  part: FetchedPart,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { admin, conn } = ctx;
  const bytes = part.bytes!;
  let storage: Record<string, unknown>;
  let storagePath: string | null = null;

  if (!STORABLE_MIME.has(part.mimeType)) {
    storage = { storage: "unsupported_type" };
  } else if (bytes.byteLength > MAX_STORE_BYTES) {
    storage = { storage: "too_large" };
  } else {
    const name = sanitizeFilename(part.filename, part.mimeType);
    const path = `profiles/${conn.profileId}/sources/${sourceItemId}/original/${name}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: part.mimeType,
      upsert: false,
      cacheControl: "0",
    });
    if (error && !/exists|duplicate/i.test(error.message)) {
      storage = { storage: "failed", storage_error: error.message.slice(0, 300) };
      noteError(ctx.stats, `storage ${part.sourceKey.slice(0, 80)}`, error.message);
    } else {
      storage = { storage: "stored" };
      storagePath = path;
    }
  }

  // Mutated in place so the caller's copy (PartResult.metadata) stays current.
  Object.assign(metadata, storage);
  if (storage.storage !== "failed") delete metadata.storage_error;
  const { error: upErr } = await admin
    .from("source_items")
    .update({ storage_path: storagePath, metadata: metadata as Json })
    .eq("id", sourceItemId)
    .eq("profile_id", conn.profileId);
  if (upErr) noteError(ctx.stats, `storage_path ${part.sourceKey.slice(0, 80)}`, upErr.message);
}
