PromptArmor Take-Home — Product & UX Reference Pack
Purpose: Companion to the product plan for implementation in Claude. This consolidates the strongest workflow ideas, UI references, user stories, technical guardrails, and external sources discussed during planning. This is not an implementation request. No application or database changes have been made.
Assignment: ClearPath Financial is a fictional national consumer-finance company offering personal loans, credit cards, and mortgage prequalification. Excel- and email-based marketing compliance review constrains growth. Increase compliance review throughput by reducing human time per asset. Deliver a deployed URL and GitHub repository.
Success definition: A connected source automatically yields reviewable marketing assets; the system analyzes and organizes them; reviewers can make grounded decisions, request and verify revisions, and approve a specific version with an audit trail.
1. Core product idea
An exception-driven compliance workbench, not a generic compliance chatbot.
	•	Automatic discovery: Read selected Gmail labels/threads and Drive folders; find marketing materials, attachments, spreadsheets, and revisions; create or update assets without manual re-entry. Also support CSV/XLSX import and direct upload/paste.
	•	Intelligent preflight: Apply relevant regulation, ClearPath's actual fictional offers, and internal marketing rules. Identify specific claims, risks, evidence, missing facts, and suggested corrections.
	•	Review operations: Deduplicate and group variations, prioritize exceptions, compare versions, consolidate feedback, record human approval and audit history.
	•	One profile model: profiles are named workspaces; profile_members links users. No individual-versus-company type.
Primary measure: Active reviewer minutes per asset. Also record approval turnaround, first-pass approval, repeat work, missed critical findings, and cost per successful analysis. Do not invent improvement percentages.
2. The five-stage product experience (retain this framing)
Submit and preflight
Marketing uploads a campaign. AI checks its contents against applicable regulations and actual ClearPath offers, and helps resolve obvious issues before formal submission.
Connected-source variant: Marketing may simply send an email or place a file in an approved Drive folder. The system discovers it, creates/updates an asset, and starts preflight automatically. Manual upload is an alternative, not the default requirement.
Group and prioritize
The system groups similar assets, identifies exceptions, and surfaces decisions needing human attention.
Review in context
The reviewer examines each issue against the actual creative, company policy, and cited regulatory requirement, with optional AI discussion.
Resolve and recheck
Marketing receives specific feedback, revises the asset, and resubmits. The reviewer sees resolved findings and new differences rather than rereading everything.
Approve and measure
A human approves the exact version reviewed. The system preserves the evidence and captures actual review effort and turnaround.
End-to-end flow:
Gmail / Drive / CSV / upload / pasted copy                   |            Discover + extract                   |         Match campaign + asset           (dedupe, version)                   |          Submit and preflight                   |          Group and prioritize                   |            Review in context                   |           Resolve and recheck <---- revised source content                   |            Approve and measure
3. UI references / wireframes
These are conceptual UI specifications, not screenshots of a finished product. Use shadcn/ui + Tailwind, with compact tables, clear states, and very little visual noise.
A. Application shell / overview
[Profile: ClearPath v]                       [Search] [User] ------------------------------------------------------------ Overview | Reviews | Campaigns | Sources | Settings  Needs review     Needs changes     Ready for decision      18                7                    12  ITEMS NEEDING ATTENTION High   Personal Loan — Facebook    3 findings    Affiliate A Med    Credit Card — Summer Offer  2 findings    Marketing Low    Mortgage — Email Promo      No issues     Affiliate B  Sources: Gmail synced | Drive synced | Last sync 3 minutes ago
Key behavior: Clicking a row opens the workbench; the dashboard is about what needs action, not generic analytics. Include meaningful empty, loading, error, and sync states.
B. Exception-first review queue
Columns: asset/campaign, source, product/channel, risk, unresolved findings, current version, status, assignee, updated time. Filter by risk, campaign, product, source, status; group similar variants. Low-risk items get concise checklists, routine problems get proposed changes, ambiguous/high-risk items get detailed evidence. Low risk is not auto-approval.
C. Split-view review workbench
ASSET: Personal Loan — Paid Social         [v2 of 2] [History] ------------------------------------------------------------------- ORIGINAL CREATIVE / VERSION DIFF | FINDINGS & DECISION PANEL                                 | "Borrow $25,000 for $299/mo"     | HIGH · Potential missing disclosures [highlight claim]               | Evidence: quoted claim                                 | Rule: Reg Z §1026.24(d) [Preview of entire ad]          | Missing: APR / repayment details                                 | Fix: verify offer, add disclosures                                 | [Accept] [Dismiss + reason]                                 | [Source email] [Prior version]  | [Ask AI] [Request changes]                                 | [Approve exact version] -------------------------------------------------------------------
This is an illustrative finding, not a predetermined legal conclusion. Show the exact source text or visual region, applicable rule, missing facts, and correction. Contextual chat belongs to the asset; it should not replace the finding list.
D. Revision + audit experience
Show old/new content side by side or as a diff; label findings resolved / unresolved / newly introduced. Recheck changed claims and context. Request revisions as a consolidated message. Approval is pinned to asset_version_id, actor, time, and rationale. The latest content is never silently treated as approved because an earlier version was.
E. Sources / onboarding
	•	Sign in and choose or create a named profile.
	•	Connect Gmail and/or Drive; explicitly select allowed labels and folders.
	•	Run initial discovery and show a preview of detected materials (including uncertain matches).
	•	Confirm/adjust classifications and monitor sync status.
	•	Allow direct upload/import independent of OAuth so the evaluator always has a working path.
Source trust UI: Show provider, sender/owner, source link, received/modified timestamp, sync health, and extraction confidence. Users should understand why a file appeared.
4. User stories / acceptance tests
ID
User story
Acceptance test
01
As a member, I can work in a named profile.
Members see only authorized profile content; profile has name, not type.
02
As a reviewer, I can connect email/Drive to ingest materials automatically.
Monitored labels/folders chosen; initial and incremental sync visible.
03
As a reviewer, I don't want irrelevant emails in my queue.
Classification can mark items irrelevant/uncertain; uncertain items are reviewable.
04
As a reviewer, I don't want duplicate or stale submissions.
Repeated source content dedupes; real modifications create new versions.
05
As a marketer, I can preflight before formal review.
Flags are actionable and grounded in ClearPath offers/policies and cited rules.
06
As a reviewer, I can work exceptions first.
Queue filters and groups related variants; risk is explained.
07
As a reviewer, I can inspect and challenge each finding.
Evidence, rule, uncertainty, suggested correction, accept/dismiss-with-reason.
08
As a reviewer, I can discuss the asset with AI.
Chat uses current asset/policies, never independently approves it.
09
As a reviewer, I can request all changes together.
Consolidated feedback linked to findings and asset version.
10
As a reviewer, I can quickly confirm a resubmission.
Diff + resolved, remaining, and new issues are visible.
11
As a reviewer, I can reuse analyses for near-identical creative.
Prior findings are traceable; changed claims/context are rechecked.
12
As a reviewer, I can approve a specific asset version.
Actor, decision, time and version recorded; new version not approved.
13
As a manager, I can reconstruct review history.
Immutable timeline of source, content versions, findings and actions.
14
As an operator, I can bound AI spending.
$10/day gateway soft cap; token, concurrency, caching and usage logs.
15
As an evaluator, I can test an asset from scratch.
Live, non-seeded analysis succeeds through direct submission.
16
As a security reviewer, I can submit hostile creative without controlling the AI.
Embedded instructions do not change approval authority or policies.
5. Review object model / storage reference
This is a conceptual schema map, not migration SQL. The separate product-plan document contains the relational schema proposal.
auth.users --< profile_members >-- profiles                                     |             +-----------------------+-----------------------+             |                       |                       |         connections              campaigns                policies             |                       |                       |        source_items  --- links ---> assets  --< asset_versions                                        |               |                                     reviews ------ findings                                        |                                   review_events
Key distinctions: A source_item is provider content (Gmail message, Drive file, import row). An asset is a canonical reviewable marketing item. asset_versions hold immutable reviewed states. Multiple source items can point to one asset; a source change can create a new version. A review/finding points to a specific version and policy context.
Storage: One private Supabase Storage bucket; database rows carry ownership and references. Suggested paths:
private-assets/   profiles/{profile_id}/sources/{source_item_id}/original/{filename}   profiles/{profile_id}/assets/{asset_id}/versions/{version_id}/preview/{filename}   profiles/{profile_id}/assets/{asset_id}/versions/{version_id}/derived/{filename}
Use private object access with membership checks and short-lived signed URLs. Do not put tokens/API keys in Storage or expose server credentials in the browser. Avoid duplicating file bytes across references when possible.
6. Compliance analysis / quality requirements
Source of truth: Curated, versioned regulatory references + ClearPath's fictional real-offer catalog (rates, eligibility, terms, approved claims, required disclosures) + internal policies. The LLM compares actual submitted claims against that corpus; it does not invent available product terms or independently discover all laws for each ad.
Findings should include: severity, classification (potential violation / confirmed policy mismatch / missing information / unsupported), evidence (quoted text or visual region), rule_id and source URL, explanation, suggested correction, confidence or uncertainty, reviewer disposition.
Corner cases to explicitly test:
	•	Textually present but visually unreadable or obscured disclosure.
	•	Advertised APR/payment not available from ClearPath.
	•	Same attachment in two emails; one email containing multiple creatives.
	•	Drive document changed after approval; old approval must not transfer.
	•	Revised copy solves one issue but introduces a new problematic claim.
	•	Missing product, channel, geographic targeting, or audience information.
	•	Unsupported PDF/image or extraction failure; never claim completed review.
	•	Gmail history cursor expires; safely rerun full sync.
	•	OAuth revoked; show reconnection path, no silent data loss.
	•	A submitted advertisement contains instructions to ignore rules or auto-approve; treat as untrusted content.
Accuracy evaluation: Known-answer fixture set for each financial product and channel; measure critical issue recall, false positives, citation validity, correction quality, extraction success, review latency and cost. Remember that citations alone do not establish legal correctness. Keep human approval.
7. Costs, stack, and decisions already made
	•	Stack: Next.js/React/TypeScript, Tailwind + shadcn/ui, Supabase Auth/Postgres/Storage, Vercel, cost-effective model via AI Gateway or an appropriate direct provider route.
	•	Spending goal: $10/day for application-funded AI inference, UTC reset at the gateway. Gateway caps are soft (crossing request can exceed budget). Also bound input/output, concurrency, retries, and repetitive analysis; persist per-request costs.
	•	BYOK: Optional means for heavy testing, not required for first use. Vercel AI Gateway BYOK may silently fall back to its own billable credentials if a provider key fails; if strict cost isolation matters, verify a no-fallback route, such as direct provider calling, rather than assume Gateway BYOK guarantees it.
	•	No Stripe or fictional payment system: Payments demonstrate a separate skill, not compliance throughput; sandbox money does not pay inference bills.
	•	No false product promises: Do not imply national state-law coverage, universal file extraction, or fully working Outlook/OneDrive integrations if not implemented.
	•	No AI auto-approval: A person signs off on the exact reviewed asset version.
	•	No artificial v1/v2 split: One cohesive product; focus effort where it directly reduces manual review work.
8. Interview demonstration sequence
	•	Select the ClearPath profile; show connected email/Drive sources and sync state.
	•	Ingest a source containing multiple campaign submissions, variants and attachments; show canonical asset creation and deduplication.
	•	Show preflight against regulations and actual ClearPath offer terms.
	•	Open the exception-first queue and group related creative.
	•	Inspect one high-risk asset with highlighted evidence, source rules, recommendations, and a contextual AI follow-up.
	•	Generate one consolidated revision request.
	•	Resync a changed attachment or upload a revised version; show a diff, resolved issues, and new findings.
	•	Approve that version, then show complete audit history.
	•	Submit a malicious instruction embedded in a sample ad; prove that it cannot authorize an approval.
	•	Show real measured request costs and review activity (no fabricated productivity metrics).
9. Claude handoff instructions
Use the separate product plan as the source of requirements and this document as a product/UX/reference companion. Do not conflate mockups, hypothetical queue counts, or illustrative findings with completed features or measured outcomes. Preserve automatic discovery as a core capability, the exact-version human approval rule, the five-stage journey, the named-profile membership model, and the $10/day operating-cost target. Work through implementation decisions in Claude; do not assume anything has already been built.
10. External references (verified November 6, 2026)
PromptArmor and adjacent product evidence
	•	PromptArmor — Product Engineer — user workflow insight, intuitive UX, relational modeling, end-to-end ownership.
	•	Adclear / Salad case study — documented pain from email-based approvals, scattered revisions and audit history; real-world preflight and centralized review pattern. Use as product evidence, not proof of our own outcomes.
Financial marketing compliance primary sources
	•	CFPB Regulation Z §1026.24 — Closed-end credit advertising — personal-loan and applicable mortgage advertising, actual terms, triggering disclosures, prominence.
	•	CFPB Regulation Z §1026.16 — Open-end credit advertising — applicable credit-card advertising requirements and triggering terms.
	•	CFPB Regulation B §1002.4 — applicable nondiscrimination/discouragement advertising rules. Review the current text and effective dates; scope has changed in 2026.
	•	FTC Endorsement Guides FAQ — affiliate and endorsement disclosures where the relevant facts trigger them.
Source ingestion and permissions
	•	Gmail incremental synchronization — history.list, cursor persistence, full resync on expired history ID.
	•	Google Drive change tracking — change cursors and notifications.
	•	Gmail OAuth scope classification — gmail.readonly is restricted.
	•	Drive OAuth scope classification — broad drive.readonly is restricted; consider least-privilege scope selection and test users.
Safety, cost, UI implementation references
	•	OWASP LLM Top 10 (2025) — indirect prompt injection in untrusted documents; model output should not directly trigger privileged actions.
	•	Vercel AI Gateway budgets — daily reset, budget scopes and soft-cap behavior.
	•	Vercel AI Gateway BYOK — request-scoped BYOK and billable fallback behavior.
	•	shadcn/ui data table — useful implementation reference for sorting, filtering and row selection; not a design mandate.
	•	Supabase row-level security — enforce profile-membership authorization in data access.
