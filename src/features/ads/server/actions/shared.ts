import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { after } from "next/server";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { startAnalysisForVersion } from "@/features/analysis/server/engine/queue";
import { PRODUCTS } from "@/features/products/catalog";

/**
 * What the Ads Server Actions share (the actions themselves live next to this
 * file, one module per thing a person does on the Ads list and the Ad page).
 *
 * Every action re-authenticates, confirms membership under RLS (by reading
 * the asset / finding / source item with the user-context client) and only
 * then calls intake, the engine or an RPC. Decisions go through
 * record_decision(): the database, not this code, decides what is approvable.
 *
 * Owns the common failures, the plain-English reading of database errors,
 * the id and product schemas, and starting the check after a new version.
 */

export const NOT_FOUND: ActionResult<never> = { ok: false, error: "That ad is not in this workspace.", code: "PT404" };

export const uuid = z.guid({ error: "Invalid id." });
export const productSchema = z.enum(PRODUCTS);

export function fail(err: unknown, fallback: string): ActionResult<never> {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[ads]", fallback, message);
  return { ok: false, error: fallback, code: "failed" };
}

/** Plain-English messages for the error codes record_decision and friends raise. */
export function rpcFailure(error: PostgrestError, context: "decision" | "generic" = "generic"): ActionResult<never> {
  const msg = (error.message ?? "").toLowerCase();
  const hint = (error.hint ?? "").toLowerCase();
  switch (error.code) {
    case "PT404":
      return NOT_FOUND;
    case "PT409": {
      if (msg.includes("alert") || hint.includes("alert")) return { ok: false, error: "Acknowledge the hidden-text alert first.", code: error.code };
      if (msg.includes("still running")) return { ok: false, error: "The check is still running. Wait for it to finish, then try again.", code: error.code };
      if (msg.includes("not been analysed")) return { ok: false, error: "This version has not been checked yet. Wait for the check, then try again.", code: error.code };
      if (msg.includes("pre-check did not complete")) return { ok: false, error: "The AI check did not complete for this version. Reload the page; it will need a manual approval with a rationale.", code: error.code };
      if (msg.includes("latest")) return { ok: false, error: "A newer version arrived. Reload to review it.", code: error.code };
      if (msg.includes("fix required") || msg.includes("fix_required")) return { ok: false, error: "An issue is still marked Fix required. Resolve it or mark it Not a problem before approving.", code: error.code };
      if (msg.includes("no disposition")) return { ok: false, error: "Every open Critical or Major issue needs a written reason before approving.", code: error.code };
      if (msg.includes("unchanged") || hint.includes("unchanged")) return { ok: false, error: "That wording is already the current version.", code: error.code };
      if (msg.includes("draft")) return { ok: false, error: "This ad has not been submitted for review yet.", code: error.code };
      return { ok: false, error: context === "decision" ? "The ad changed while you were deciding. Reload and try again." : error.message, code: error.code };
    }
    case "PT422": {
      if (msg.includes("attest")) return { ok: false, error: "Tick the attestation box to approve.", code: error.code };
      if (msg.includes("rationale")) return { ok: false, error: "Add a rationale (at least 40 characters when there was no AI check, otherwise 20).", code: error.code };
      if (msg.includes("exception")) return { ok: false, error: "Each open Critical or Major issue needs a written reason of at least 40 characters.", code: error.code };
      if (msg.includes("change request") || msg.includes("items")) return { ok: false, error: "A change request needs at least one item with a required fix.", code: error.code };
      if (msg.includes("note")) return { ok: false, error: "The note must be at least 40 characters for Critical and Major issues.", code: error.code };
      return { ok: false, error: error.message || "Something in the form is not valid.", code: error.code };
    }
    case "42501": {
      if (msg.includes("self") || msg.includes("member")) return { ok: false, error: "You wrote this version, so you cannot approve it with exceptions while the workspace has other members. Ask another member to approve.", code: error.code };
      return { ok: false, error: "You are not allowed to do that.", code: error.code };
    }
    case "PGRST202":
      return { ok: false, error: "The database is not ready yet. Try again shortly.", code: error.code };
    default:
      console.error("[ads] rpc failed:", error.code, error.message);
      return { ok: false, error: "Something went wrong. Please try again.", code: error.code };
  }
}

export function isFailure<T>(v: T | ActionResult<never>): v is ActionResult<never> {
  return typeof v === "object" && v !== null && "ok" in v && (v as { ok: unknown }).ok === false;
}

/** Archived ads are frozen on the server too, not only in the UI. */
export const ARCHIVED: ActionResult<never> = { ok: false, error: "This ad is archived. Unarchive it first.", code: "PT409" };

export function kickAnalysis(versionId: string) {
  after(async () => {
    try {
      await startAnalysisForVersion(versionId);
    } catch (err) {
      console.error("[ads] analysis start failed:", (err as Error).message);
    }
  });
}
