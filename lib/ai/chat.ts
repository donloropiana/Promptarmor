import "server-only";

import { generateText } from "ai";

import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import type { VersionContent } from "@/lib/types/ads";

import { MODELS, costUsd, friendlyAiError, isAiGatewayConfigured, releaseBudget, reserveBudget, settleBudget } from "./budget";
import { ASK_SYSTEM_PROMPT, buildAskUserPrompt } from "./prompts";

/**
 * "Ask about this ad": the product's only chat. Read-only Q&A over one
 * version, its issues and the rules they cite. No tools, no history, plain
 * text. It cannot approve, reject or change anything, and says so.
 */

const CHAT_EST_USD = 0.01;
const CHAT_TIMEOUT_MS = 45_000;
const MAX_QUESTION_CHARS = 1_000;

export type AskResult = { ok: true; answer: string } | { ok: false; error: string };

const ACTION_RE = /\b(approve|reject|dismiss|pass|clear|sign off|mark (it |this )?(as )?(compliant|approved|ok|safe)|change (the |a )?rule|edit (the |a )?rule|disable (the |a )?rule|delete|re-?run|request changes)\b/i;

function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function askAboutAd(input: { profileId: string; userId: string; assetVersionId: string; question: string }): Promise<AskResult> {
  const question = (input.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) return { ok: false, error: "Ask a question first." };

  let admin;
  try {
    admin = requireSupabaseAdminClient();
  } catch {
    return { ok: false, error: "The server is not configured for AI yet." };
  }

  // Membership and tenancy: the caller must belong to the version's workspace.
  const { data: member } = await admin
    .from("profile_members")
    .select("user_id")
    .eq("profile_id", input.profileId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!member) return { ok: false, error: "You are not a member of this workspace." };

  const { data: version } = await admin
    .from("asset_versions")
    .select("id, asset_id, profile_id, extracted_text, content, version_no")
    .eq("id", input.assetVersionId)
    .eq("profile_id", input.profileId)
    .maybeSingle();
  if (!version) return { ok: false, error: "This ad version could not be found." };

  // Latest finished run on this version (complete preferred) + reviewer findings, with rule titles and dispositions.
  const { data: runs } = await admin
    .from("analysis_runs")
    .select("id, input_metadata, status")
    .eq("asset_version_id", version.id)
    .in("status", ["complete", "failed", "declined_budget"])
    .order("created_at", { ascending: false })
    .limit(5);
  const run = (runs ?? []).find((r) => r.status === "complete") ?? runs?.[0] ?? null;

  const findingsQuery = admin
    .from("findings")
    .select("id, severity, quote, explanation, rule_version_id, origin, analysis_run_id")
    .eq("asset_version_id", version.id);
  const { data: findings } = run ? await findingsQuery.or(`origin.eq.reviewer,analysis_run_id.eq.${run.id}`) : await findingsQuery.eq("origin", "reviewer");

  const ruleVersionIds = Array.from(new Set((findings ?? []).map((f) => f.rule_version_id).filter((id): id is string => Boolean(id))));
  const { data: ruleVersions } = ruleVersionIds.length
    ? await admin.from("rule_versions").select("id, rule_id, title, body").in("id", ruleVersionIds)
    : { data: [] as { id: string; rule_id: string; title: string; body: string }[] };
  const ruleIds = Array.from(new Set((ruleVersions ?? []).map((r) => r.rule_id)));
  const { data: rules } = ruleIds.length ? await admin.from("rules").select("id, code").in("id", ruleIds) : { data: [] as { id: string; code: string }[] };
  const codeByRule = new Map((rules ?? []).map((r) => [r.id, r.code]));
  const ruleByVersion = new Map((ruleVersions ?? []).map((r) => [r.id, { code: codeByRule.get(r.rule_id) ?? "rule", title: r.title, body: r.body }]));

  const findingIds = (findings ?? []).map((f) => f.id);
  const { data: dispositions } = findingIds.length
    ? await admin.from("finding_latest_dispositions").select("finding_id, disposition").in("finding_id", findingIds)
    : { data: [] as { finding_id: string | null; disposition: string | null }[] };
  const dispositionByFinding = new Map((dispositions ?? []).map((d) => [d.finding_id ?? "", d.disposition ?? ""]));

  const { data: alerts } = await admin.from("security_alerts").select("kind, excerpt").eq("asset_version_id", version.id);

  const content = (version.content ?? {}) as VersionContent;
  const meta = (run?.input_metadata ?? {}) as { transcript?: string };
  const adText = (version.extracted_text && version.extracted_text.trim()) || meta.transcript || content.text || "";

  const issueList = (findings ?? []).map((f) => {
    const rule = f.rule_version_id ? ruleByVersion.get(f.rule_version_id) : undefined;
    const disposition = dispositionByFinding.get(f.id);
    const status = disposition === "dismissed" ? "marked not a problem" : disposition === "accepted_exception" ? "accepted as an exception" : "open";
    return { severity: f.severity, title: rule?.title ?? (f.origin === "reviewer" ? "Added by reviewer" : "Issue"), quote: f.quote, explanation: f.explanation, status };
  });
  const openIssues = issueList.filter((i) => i.status === "open");

  // Requests for actions are answered without spending budget.
  if (ACTION_RE.test(question) && /\b(this|the|it|ad|rule|issue)\b/i.test(question)) {
    const list = openIssues.length
      ? openIssues.map((i, n) => `${n + 1}. ${i.title} (${i.severity})${i.quote ? `: "${i.quote}"` : ""}`).join("\n")
      : "There are no open issues on this version.";
    return {
      ok: true,
      answer: `I can't do that. I only read this ad and answer questions about it; a person approves, rejects or changes rules.\n\nOpen issues on V${version.version_no}:\n${list}`,
    };
  }

  if (!isAiGatewayConfigured()) {
    return { ok: false, error: "Ask about this ad is not available: the AI gateway is not configured on this server." };
  }

  const reservation = await reserveBudget(admin, { profileId: input.profileId, estUsd: CHAT_EST_USD, purpose: "chat", userId: input.userId }).catch(
    (err: Error) => {
      console.error("[ai/chat] reserve failed:", err.message);
      return null;
    },
  );
  if (!reservation) return { ok: false, error: "Today's AI budget for this workspace is used up. Try again tomorrow." };

  try {
    const result = await generateText({
      model: MODELS.cheap,
      system: ASK_SYSTEM_PROMPT,
      prompt: buildAskUserPrompt({
        adText,
        findings: issueList,
        rules: Array.from(ruleByVersion.values()),
        alerts: (alerts ?? []).map((a) => ({ kind: a.kind, excerpt: a.excerpt })),
        question,
      }),
      maxOutputTokens: 400,
      maxRetries: 1,
      timeout: { totalMs: CHAT_TIMEOUT_MS },
    });
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    await settleBudget(admin, {
      requestId: reservation.requestId,
      costUsd: costUsd(MODELS.cheap, inputTokens, outputTokens),
      inputTokens,
      outputTokens,
      model: MODELS.cheap,
    });
    const answer = stripMarkdown(result.text);
    return answer ? { ok: true, answer } : { ok: false, error: "No answer came back. Try asking in a different way." };
  } catch (err) {
    await releaseBudget(admin, reservation.requestId);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai/chat] generate failed:", message);
    const known = friendlyAiError(message);
    if (known) return { ok: false, error: `Ask about this ad is not available right now: ${known}` };
    return { ok: false, error: "The answer could not be generated right now. Try again in a moment." };
  }
}
