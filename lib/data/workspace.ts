import "server-only";

import { cache } from "react";

import { requireMember, type Membership } from "@/lib/auth/dal";
import { getSupabaseContext } from "@/lib/supabase/context";
import type { Json, ProfileRole } from "@/lib/supabase/types";
import { INTEGRATIONS, isIntegrationKey, type ProviderGroup } from "@/lib/nango/integrations";

/**
 * Read model for the app shell and Settings. Every read uses the
 * user-context client (RLS), so a workspace never sees another's rows.
 * Server Components calling these read cookies(): render inside <Suspense>.
 */

export type MemberRow = {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: ProfileRole;
  joinedAt: string;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: ProfileRole;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

export type ConnectionSummary = {
  id: string;
  provider: string;
  providerLabel: string;
  group: ProviderGroup | null;
  accountEmail: string | null;
  status: "connected" | "syncing" | "needs_reconnect" | "error" | "disconnected";
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedBy: string | null;
  createdAt: string;
};

export type MemberConnections = {
  userId: string | null;
  name: string;
  email: string | null;
  isMe: boolean;
  connections: ConnectionSummary[];
};

export type SyncRunRow = {
  id: string;
  connectionId: string;
  providerLabel: string;
  accountEmail: string | null;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  stats: Record<string, unknown>;
  error: string | null;
};

export type WorkspaceEvent = {
  id: number;
  kind: string;
  createdAt: string;
  /** Plain-English sentence, ready to show. */
  text: string;
  /** Where clicking it goes (an ad page, members, rules…), if anywhere. */
  href: string | null;
};

export type WorkspaceSettings = {
  id: string;
  name: string;
  createdAt: string;
  role: ProfileRole;
  aiDailyCapUsd: number | null;
  aiUsedTodayUsd: number | null;
  aiRemainingUsd: number | null;
  aiTrusted: boolean | null;
  sampleAdCount: number;
  memberCount: number;
};

export type PendingInvitation = {
  invitationId: string;
  profileId: string;
  profileName: string;
  role: ProfileRole;
  invitedByName: string | null;
  invitedByEmail: string | null;
  expiresAt: string;
};

function role(v: unknown): ProfileRole {
  return v === "owner" ? "owner" : "member";
}

function nameOf(u: { full_name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!u) return null;
  const n = u.full_name?.trim();
  return n || u.email || null;
}

/** Members of the workspace with their role, owners first then by join date. */
export const getMembers = cache(async (profileId: string): Promise<MemberRow[]> => {
  const { supabase } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("profile_members")
    .select("user_id, role, created_at, users!profile_members_user_id_fkey(id, email, full_name, avatar_url)")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[workspace] members failed:", error.code, error.message);
    return [];
  }
  type U = { id: string; email: string; full_name: string | null; avatar_url: string | null };
  type Row = { user_id: string; role: string; created_at: string; users: U | U[] | null };
  const out: MemberRow[] = [];
  for (const r of (data ?? []) as Row[]) {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    out.push({
      userId: r.user_id,
      email: u?.email ?? "",
      fullName: u?.full_name ?? null,
      avatarUrl: u?.avatar_url ?? null,
      role: role(r.role),
      joinedAt: r.created_at,
    });
  }
  out.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });
  return out;
});

/**
 * Pending (not accepted, not revoked) invitations. RLS lets only owners read
 * the table, so members get an empty list. Columns are named because
 * token_hash is not granted.
 */
export const getPendingInvitations = cache(async (profileId: string): Promise<InvitationRow[]> => {
  const { supabase, role: myRole } = await requireMember(profileId);
  if (myRole !== "owner") return [];
  const { data, error } = await supabase
    .from("profile_invitations")
    .select("id, email, role, invited_by, created_at, expires_at, accepted_at, revoked_at")
    .eq("profile_id", profileId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[workspace] invitations failed:", error.code, error.message);
    return [];
  }
  type Row = {
    id: string;
    email: string;
    role: string;
    invited_by: string | null;
    created_at: string;
    expires_at: string;
  };
  const rows = (data ?? []) as Row[];
  const inviterIds = [...new Set(rows.map((r) => r.invited_by).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string | null>();
  if (inviterIds.length > 0) {
    const { data: users } = await supabase.from("users").select("id, full_name, email").in("id", inviterIds);
    for (const u of (users ?? []) as { id: string; full_name: string | null; email: string }[]) {
      names.set(u.id, nameOf(u));
    }
  }
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: role(r.role),
    invitedByName: r.invited_by ? (names.get(r.invited_by) ?? null) : null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    expired: Date.parse(r.expires_at) < now,
  }));
});

function connStatus(v: unknown): ConnectionSummary["status"] {
  return v === "connected" || v === "syncing" || v === "needs_reconnect" || v === "error" || v === "disconnected"
    ? v
    : "error";
}

/**
 * Live (not disconnected) connections grouped by the member who connected
 * them. The current user's group comes first. A member whose row was
 * removed shows as "Former member".
 */
export const getConnectionsByMember = cache(async (profileId: string): Promise<MemberConnections[]> => {
  const { supabase, user } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("connections")
    .select("id, provider, account_email, status, last_synced_at, last_error, connected_by, created_at")
    .eq("profile_id", profileId)
    .neq("status", "disconnected")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[workspace] connections failed:", error.code, error.message);
    return [];
  }
  type Row = {
    id: string;
    provider: string;
    account_email: string | null;
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
    connected_by: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const members = await getMembers(profileId);
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const groups = new Map<string, MemberConnections>();
  for (const r of rows) {
    const key = r.connected_by ?? "former";
    let g = groups.get(key);
    if (!g) {
      const m = r.connected_by ? memberById.get(r.connected_by) : undefined;
      g = {
        userId: r.connected_by,
        name: m ? (nameOf({ full_name: m.fullName, email: m.email }) ?? "Member") : "Former member",
        email: m?.email ?? null,
        isMe: r.connected_by === user.id,
        connections: [],
      };
      groups.set(key, g);
    }
    const info = isIntegrationKey(r.provider) ? INTEGRATIONS[r.provider] : null;
    g.connections.push({
      id: r.id,
      provider: r.provider,
      providerLabel: info?.displayName ?? r.provider,
      group: info?.group ?? null,
      accountEmail: r.account_email,
      status: connStatus(r.status),
      lastSyncedAt: r.last_synced_at,
      lastError: r.last_error,
      connectedBy: r.connected_by,
      createdAt: r.created_at,
    });
  }
  const out = [...groups.values()];
  out.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    if (a.userId === null) return 1;
    if (b.userId === null) return -1;
    return a.name.localeCompare(b.name);
  });
  return out;
});

/** Last `limit` sync runs for the workspace, newest first (the sync log). */
export const getSyncRuns = cache(async (profileId: string, limit = 50): Promise<SyncRunRow[]> => {
  const { supabase } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("sync_runs")
    .select("id, connection_id, kind, started_at, finished_at, stats, error, connections(provider, account_email)")
    .eq("profile_id", profileId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[workspace] sync runs failed:", error.code, error.message);
    return [];
  }
  type C = { provider: string; account_email: string | null };
  type Row = {
    id: string;
    connection_id: string;
    kind: string;
    started_at: string;
    finished_at: string | null;
    stats: Json;
    error: string | null;
    connections: C | C[] | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const c = Array.isArray(r.connections) ? r.connections[0] : r.connections;
    const info = c && isIntegrationKey(c.provider) ? INTEGRATIONS[c.provider] : null;
    return {
      id: r.id,
      connectionId: r.connection_id,
      providerLabel: info?.displayName ?? c?.provider ?? "Account",
      accountEmail: c?.account_email ?? null,
      kind: r.kind,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      stats: r.stats && typeof r.stats === "object" && !Array.isArray(r.stats) ? (r.stats as Record<string, unknown>) : {},
      error: r.error,
    };
  });
});

const BELL_KINDS = [
  "decision.recorded",
  "change_request.created",
  "version.created",
  "analysis.completed",
  "analysis.manual_review",
  "member.joined",
  "member.removed",
  "member.left",
  "member.role_changed",
  "offer.changed",
  "offer.added",
  "rule.edited",
  "rule.added",
  "rule.enabled",
  "rule.disabled",
] as const;

const DECISION_WORDS: Record<string, string> = {
  approved: "approved",
  approved_with_exceptions: "approved with exceptions",
  changes_requested: "sent back with changes requested",
  rejected: "rejected",
  withdrawn: "withdrawn",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The last `limit` workspace events of the kinds the bell shows, as plain
 * English. Actor names and ad titles are resolved under RLS; an actor who is
 * no longer a member shows as "Someone".
 */
export const getRecentEvents = cache(async (profileId: string, limit = 10): Promise<WorkspaceEvent[]> => {
  const { supabase } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("events")
    .select("id, kind, data, actor_id, asset_id, created_at")
    .eq("profile_id", profileId)
    .in("kind", [...BELL_KINDS])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[workspace] events failed:", error.code, error.message);
    return [];
  }
  type Row = { id: number; kind: string; data: Json; actor_id: string | null; asset_id: string | null; created_at: string };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const userIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const r of rows) {
    if (r.actor_id) userIds.add(r.actor_id);
    if (r.asset_id) assetIds.add(r.asset_id);
    const d = r.data as Record<string, unknown> | null;
    const subject = str(d?.user_id);
    if (r.kind.startsWith("member.") && subject) userIds.add(subject);
    const by = str(d?.by);
    if (by) userIds.add(by);
  }
  const names = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: users } = await supabase.from("users").select("id, full_name, email").in("id", [...userIds]);
    for (const u of (users ?? []) as { id: string; full_name: string | null; email: string }[]) {
      const n = nameOf(u);
      if (n) names.set(u.id, n);
    }
  }
  const titles = new Map<string, string>();
  if (assetIds.size > 0) {
    const { data: assets } = await supabase.from("assets").select("id, title").in("id", [...assetIds]);
    for (const a of (assets ?? []) as { id: string; title: string }[]) titles.set(a.id, a.title);
  }

  const who = (id: string | null) => (id && names.get(id)) || "Someone";
  const ad = (id: string | null) => {
    const t = id ? titles.get(id) : null;
    return t ? `“${t}”` : "an ad";
  };

  return rows.map((r) => {
    const d = (r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : {}) as Record<string, unknown>;
    let text: string;
    let href: string | null = r.asset_id ? `/ads/${r.asset_id}` : null;
    switch (r.kind) {
      case "decision.recorded": {
        const v = num(d.version_no);
        const word = DECISION_WORDS[str(d.decision) ?? ""] ?? "decided on";
        text = `${who(r.actor_id)} ${word} ${ad(r.asset_id)}${v ? ` (V${v})` : ""}.`;
        break;
      }
      case "change_request.created": {
        const n = num(d.item_count);
        text = `${who(r.actor_id)} requested changes on ${ad(r.asset_id)}${n ? ` (${n} ${n === 1 ? "item" : "items"})` : ""}.`;
        break;
      }
      case "version.created": {
        const v = num(d.version_no);
        const origin = str(d.origin);
        const how =
          origin === "email" || origin === "sync"
            ? " arrived from a connected account"
            : origin === "suggestion_applied"
              ? " was created from a suggested fix"
              : origin === "reviewer_edit"
                ? " was created by an edit"
                : " was added";
        text = v && v > 1 ? `V${v} of ${ad(r.asset_id)}${how}.` : `${ad(r.asset_id)} was added and is being checked.`;
        break;
      }
      case "analysis.completed": {
        const n = num(d.finding_count) ?? num(d.findings) ?? num(d.issue_count);
        const status = str(d.status);
        if (status === "failed" || status === "declined_budget") {
          text = `The check on ${ad(r.asset_id)} could not finish; it needs a manual review.`;
        } else {
          text =
            n === null
              ? `The check on ${ad(r.asset_id)} finished.`
              : `The check on ${ad(r.asset_id)} found ${n} ${n === 1 ? "issue" : "issues"}.`;
        }
        break;
      }
      case "analysis.manual_review": {
        const reason = str(d.reason);
        text =
          reason === "hidden_text"
            ? `${ad(r.asset_id)} contains hidden text aimed at the AI. It needs a person's review.`
            : reason === "declined_budget"
              ? `${ad(r.asset_id)} was not AI-checked (the daily AI cap is reached). It needs a manual review.`
              : `The AI check on ${ad(r.asset_id)} could not finish. It needs a manual review.`;
        break;
      }
      case "member.joined": {
        const joined = str(d.user_id);
        text = `${joined ? who(joined) : "A new member"} joined the workspace.`;
        href = "/settings/members";
        break;
      }
      case "member.removed": {
        const removed = str(d.user_id);
        const by = str(d.by) ?? r.actor_id;
        text = `${who(by)} removed ${removed ? who(removed) : "a member"} from the workspace.`;
        href = "/settings/members";
        break;
      }
      case "member.left": {
        text = `${who(str(d.user_id) ?? r.actor_id)} left the workspace.`;
        href = "/settings/members";
        break;
      }
      case "member.role_changed": {
        const subject = str(d.user_id);
        const to = str(d.to);
        text = `${who(subject)} is now ${to === "owner" ? "an owner" : "a member"}.`;
        href = "/settings/members";
        break;
      }
      case "offer.changed": {
        const code = str(d.offer_code);
        const n = num(d.affected_count) ?? 0;
        text = `${who(r.actor_id)} changed the terms of ${code ? `product ${code}` : "a product"}; ${
          n === 0 ? "no approved ads were affected" : `${n} approved ${n === 1 ? "ad went" : "ads went"} back to Needs review`
        }.`;
        href = "/rules?tab=products";
        break;
      }
      case "offer.added": {
        const code = str(d.offer_code);
        const name = str(d.offer_name);
        text = `${who(r.actor_id)} added product ${code ?? ""}${name ? ` (${name})` : ""}. New checks use its terms.`;
        href = "/rules?tab=products";
        break;
      }
      case "rule.edited": {
        const code = str(d.code);
        const v = num(d.version_no);
        text = `${who(r.actor_id)} edited rule ${code ?? ""}${v ? ` (now V${v})` : ""}. New checks use the new version.`;
        href = "/rules";
        break;
      }
      case "rule.added": {
        text = `${who(r.actor_id)} added rule ${str(d.code) ?? ""}. It is on for new checks.`;
        href = "/rules";
        break;
      }
      case "rule.enabled":
      case "rule.disabled": {
        text = `${who(r.actor_id)} turned rule ${str(d.code) ?? ""} ${r.kind === "rule.enabled" ? "on" : "off"}.`;
        href = "/rules";
        break;
      }
      default:
        text = `${who(r.actor_id)} did something.`;
    }
    return { id: r.id, kind: r.kind, createdAt: r.created_at, text, href };
  });
});

/** Workspace settings for the Workspace page, including the AI cap status. */
export const getWorkspaceSettings = cache(async (profileId: string): Promise<WorkspaceSettings | null> => {
  const { supabase, role: myRole } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, created_at, settings")
    .eq("id", profileId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[workspace] profile failed:", error.code, error.message);
    return null;
  }
  const row = data as { id: string; name: string; created_at: string; settings: Json };
  const settings = (row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {}) as Record<string, unknown>;

  const [budget, samples, members] = await Promise.all([
    supabase.rpc("ai_budget_status", { p_profile_id: profileId }),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("profile_id", profileId).eq("audience", "sample"),
    supabase.from("profile_members").select("user_id", { count: "exact", head: true }).eq("profile_id", profileId),
  ]);
  const b = Array.isArray(budget.data) ? budget.data[0] : null;
  if (budget.error) console.error("[workspace] ai_budget_status failed:", budget.error.code, budget.error.message);

  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    role: myRole,
    aiDailyCapUsd: num(b?.profile_cap_usd) ?? num(settings.ai_daily_cap_usd),
    aiUsedTodayUsd: num(b?.profile_used_usd),
    aiRemainingUsd: num(b?.remaining_usd),
    aiTrusted: typeof b?.trusted === "boolean" ? b.trusted : typeof settings.ai_trusted === "boolean" ? settings.ai_trusted : null,
    sampleAdCount: samples.count ?? 0,
    memberCount: members.count ?? 0,
  };
});

export type AuditExport = {
  workspace: { id: string; name: string };
  exportedAt: string;
  exportedBy: string | null;
  decisions: unknown[];
  events: unknown[];
  /** Every ad's status and life after approval (live, end date, archive). */
  ads: unknown[];
};

/** Decisions and events for the workspace, for the Export audit record dialog. */
export async function getAuditExport(profileId: string): Promise<AuditExport | null> {
  const { supabase, user } = await requireMember(profileId);
  const { data: profile } = await supabase.from("profiles").select("id, name").eq("id", profileId).maybeSingle();
  if (!profile) return null;
  const adColumns = "id, title, product, channel, status, submitted_at, latest_version_id, approved_version_id, approved_decision_id, re_review_reason, created_at, updated_at";
  const lifecycleColumns = "live_at, live_channel, live_url, expires_at, archived_at, archive_reason";
  const [decisions, events, ads] = await Promise.all([
    supabase
      .from("decisions")
      .select(
        "id, asset_id, asset_version_id, content_sha256, decision, approver_id, approver_email, exceptions, dismissed, rationale, self_approved, attested, manual_only, auth_method, analysis_run_id, created_at",
      )
      .eq("profile_id", profileId)
      .order("created_at", { ascending: true })
      .limit(2000),
    supabase
      .from("events")
      .select("id, kind, asset_id, actor_id, data, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase.from("assets").select(`${adColumns}, ${lifecycleColumns}`).eq("profile_id", profileId).order("created_at", { ascending: true }).limit(5000),
  ]);
  if (decisions.error) console.error("[workspace] audit decisions failed:", decisions.error.code);
  if (events.error) console.error("[workspace] audit events failed:", events.error.code);
  // 42703: the lifecycle migration has not run yet; export the ads without those fields.
  let adRows: unknown[] = ads.data ?? [];
  if (ads.error) {
    if (ads.error.code !== "42703") console.error("[workspace] audit ads failed:", ads.error.code);
    const fallback = await supabase.from("assets").select(adColumns).eq("profile_id", profileId).order("created_at", { ascending: true }).limit(5000);
    adRows = fallback.data ?? [];
  }
  const p = profile as { id: string; name: string };
  return {
    workspace: { id: p.id, name: p.name },
    exportedAt: new Date().toISOString(),
    exportedBy: user.email,
    decisions: decisions.data ?? [],
    events: events.data ?? [],
    ads: adRows,
  };
}

/** Invitations waiting for the signed-in user's verified email. */
export const getMyPendingInvitations = cache(async (): Promise<PendingInvitation[]> => {
  const ctx = await getSupabaseContext();
  if (!ctx?.userClaims?.id) return [];
  const { data, error } = await ctx.supabase.rpc("my_pending_invitations");
  if (error) {
    console.error("[workspace] my_pending_invitations failed:", error.code, error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    invitationId: r.invitation_id,
    profileId: r.profile_id,
    profileName: r.profile_name,
    role: role(r.role),
    invitedByName: r.invited_by_name || null,
    invitedByEmail: r.invited_by_email || null,
    expiresAt: r.expires_at,
  }));
});

/** The provider keys the current user has a live connection for (for ConnectButtons). */
export async function getMyConnectedIntegrations(membership: Membership): Promise<string[]> {
  const { supabase, profileId, user } = membership;
  const { data } = await supabase
    .from("connections")
    .select("provider")
    .eq("profile_id", profileId)
    .eq("connected_by", user.id)
    .in("status", ["connected", "syncing"]);
  return [...new Set(((data ?? []) as { provider: string }[]).map((r) => r.provider))];
}
