import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ConnectButtons } from "@/components/connections/connect-buttons";
import { Section } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/shell-skeleton";
import { Button } from "@/components/ui/button";
import { getActiveProfileId, requireMember } from "@/lib/auth/dal";
import { getMyConnectedIntegrations } from "@/lib/data/workspace";

export const metadata: Metadata = { title: "Get started · Marketing Compliance Workbench" };

export const instant = false;

export default function GetStartedPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <GetStartedContent />
    </Suspense>
  );
}

type Step = {
  key: string;
  title: string;
  done: boolean;
  body: string;
  href: string;
  cta: string;
};

/**
 * Zero to one, as a checklist that ticks itself off from real data: a
 * connection exists, a teammate exists, an ad exists, a decision exists.
 * Nothing here is required; every step links to the screen that does it.
 */
async function GetStartedContent() {
  const profileId = await getActiveProfileId();
  if (!profileId) return null;
  const membership = await requireMember(profileId, "/get-started");
  const { supabase } = membership;

  const [mine, members, invites, ads, decisions] = await Promise.all([
    getMyConnectedIntegrations(membership),
    supabase.from("profile_members").select("user_id", { count: "exact", head: true }).eq("profile_id", profileId),
    supabase
      .from("profile_invitations")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .is("accepted_at", null)
      .is("revoked_at", null),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    supabase.from("decisions").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
  ]);

  const steps: Step[] = [
    {
      key: "connect",
      title: "Connect the accounts ads arrive in",
      done: mine.length > 0,
      body:
        "Each person connects their own Gmail or Outlook and Drive or OneDrive, once. Reads only, the last 14 days, and only things that look like ads are kept. Mail that is not an ad is skipped and its text is not stored. What arrives from your inbox is visible only to you until you say it is an ad.",
      href: "/settings/accounts",
      cta: "Connected accounts",
    },
    {
      key: "team",
      title: "Invite the people who review",
      done: (members.count ?? 0) > 1 || (invites.count ?? 0) > 0,
      body:
        "Reviewers and marketers who submit. Every member sees the same ads, rules and products; each member's inbox stays their own. With two or more members, nobody can approve their own ad over open issues.",
      href: "/settings/members",
      cta: "Members",
    },
    {
      key: "first-ad",
      title: "Check your first ad",
      done: (ads.count ?? 0) > 0,
      body:
        "Drop a file or paste copy on the Ads page, or try one of the three samples. Within about a minute the ad is checked against the rules and your product facts: the problem words are quoted, the rule is named, a fix is suggested. Then look at Rules and Products once: switch off what does not apply, add the facts that do.",
      href: "/ads",
      cta: "Ads",
    },
    {
      key: "first-decision",
      title: "Make your first decision",
      done: (decisions.count ?? 0) > 0,
      body:
        "Open an ad. X dismisses an issue with a reason, R asks for changes with a note you can copy, A approves one exact version, with a written exception for anything still open. Highlight words to add an issue of your own. Everything is recorded; the workspace can export the record.",
      href: "/ads",
      cta: "Ads",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Section
      title="Get started"
      description={
        doneCount === steps.length
          ? "All four steps are done. This page stays here for new members."
          : `${doneCount} of ${steps.length} done. Nothing here is required; each step links to the screen that does it.`
      }
    >
      <ol className="grid gap-4">
        {steps.map((s, i) => (
          <li key={s.key} className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              {s.done ? (
                <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-label="Done" />
              ) : (
                <CircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="Not done yet" />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-medium">
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span> {s.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {s.key === "connect" && !s.done ? (
                    <ConnectButtons profileId={profileId} connectedIntegrations={mine} size="sm" />
                  ) : null}
                  <Button asChild variant={s.done ? "ghost" : "outline"} size="sm">
                    <Link href={s.href}>{s.done ? `Open ${s.cta}` : `Go to ${s.cta}`}</Link>
                  </Button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-muted-foreground">
        How it works, in one breath: ads come in, each version is checked against the rules and your product facts, a person approves one exact
        version, and when a rule or a product fact changes, the approved ads that relied on it come back for review. The AI reads and suggests; it
        never approves.
      </p>
    </Section>
  );
}
