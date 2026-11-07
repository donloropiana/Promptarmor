PromptArmor — Take-Home Project
PRODUCT SPECIFICATION AND IMPLEMENTATION PLAN
Deadline: Saturday, November 7, 2026, 10:30 AM CST  |  Technical interview: Sunday, November 8, 2026, 3:00 PM CST
Deliverables: deployed application URL and GitHub repository. This document is a plan only; no development or database changes have been made.
1. Brief and evaluation
ClearPath Financial is a fictional national consumer-finance company marketing personal loans, credit cards, and mortgage prequalification products, including through affiliates. Its compliance team reviews marketing materials in Excel and email, creating a bottleneck to growth.
Objective: reduce the human time required to review each marketing asset while maintaining review quality and accountability.
Interview criteria: product intuition, real user workflow understanding, attention to detail and edge cases, and delivery of a functional deployed product in 24 hours. Any stack or AI tools are allowed; code quality is not the main emphasis.
2. Product thesis
Build an AI-powered marketing compliance workbench that automatically discovers submitted materials in existing email and Drive accounts, turns them into versioned assets, assesses compliance, prioritizes exceptions, and coordinates corrections and approval.
Automatic intake: connected sources create and update assets without manual re-entry.
Grounded analysis: compare marketing claims against applicable regulations, ClearPath’s actual offers, and internal policies.
Exception-based operations: concentrate human effort on ambiguous, high-risk, or changed material.
Closed-loop remediation: send clear feedback, detect revisions, compare differences, and retain an audit trail.
Primary KPI: active reviewer minutes per asset. Supporting measures: throughput, turnaround, first-pass approval, revisions, critical-issue recall, false positives, and inference cost per successful review.
3. Users and end-to-end workflow
Users: compliance officers (review and approve), marketers and affiliates (create and revise), and compliance managers (monitor throughput).
Connect existing Gmail and Google Drive accounts and select relevant labels or folders.
Discover emails, attachments, spreadsheets, and creative files; extract metadata and deduplicate.
Create or update assets and versions, associating them with campaigns and source records.
Preflight claims using company offers, curated regulatory rules, and AI; request missing context when needed.
Group related variants, identify exceptions, and populate the reviewer queue.
Review original material beside evidence-linked findings, recommendations, and optional chat.
Request changes; receive revisions from connected sources or direct submission; highlight changed content.
Approve or reject an exact asset version; maintain the decision, rationale, and underlying evidence.
Report review effort, decision latency, model quality, and inference costs.
The reviewable entity is an asset, not a chat. Each asset belongs to a profile and optionally a campaign, and can have multiple source references, versions, analyses, findings, and decisions.
4. Intake and sync
Build a real connected-source path for Gmail and Google Drive, plus direct upload, pasted copy, and Excel/CSV import. Source selection should be explicit. Support initial import and incremental sync; do not imply that Outlook/OneDrive are live unless implemented.
An email may contain multiple assets, and the same creative can appear in multiple emails or Drive locations.
Persist provider IDs and content revisions for idempotent import; link several source items to one asset rather than duplicating review work.
Source content changes create a new asset version; they must not mutate an approved version.
Retain source URLs, senders, timestamps, supported attachments, and extraction status.
Exclude irrelevant emails, surface uncertain campaign matches, and show connection or extraction failures.
Read-only external access by default; sending email or editing source files requires a separate explicit action.
OAuth test-account restrictions must be reflected in the demo instructions; direct submission must always work independently.
5. Compliance engine
Use a curated, versioned source of truth: federal consumer-finance advertising requirements, fictional ClearPath product terms and eligibility, approved language, disclosures, internal policies, and applicable review precedents.
Initial coverage: personal-loan advertising; credit-card advertising; mortgage rate, payment, and prequalification representations; applicable UDAAP, Regulation B/ECOA, and FTC affiliate or endorsement guidance. State targeting is captured, but unsupported state-law analysis is disclosed as a limitation.
Extract text, supported images, and contextual metadata. Identify product, channel, target audience, geography, and claims.
Select applicable policy versions and validate numerical or prohibited-claim rules deterministically where practical.
Run model analysis on untrusted material with applicable rules and actual offer data, producing structured findings.
Each finding includes severity, type, quoted evidence or visual anchor, explanation, regulatory/policy reference, proposed correction, and uncertainty.
Validate references and structured output; separate confirmed failures, potential risks, missing information, and unsupported assessment.
Reuse prior analyses only when content, relevant policy inputs, and model configuration match; compare new versions and similar variants.
Preserve immutable analysis records. AI output never changes an asset to “approved” without an authorized reviewer action.
Important edge cases: claims that do not match actual ClearPath terms; missing required product context; tiny, obscure, or detached disclosures; misleading mortgage guarantees; malicious instructions embedded in advertisements; incorrect citations; unsupported file formats.
6. User interface and reviewer actions
Review queue: risk, campaign, product, source, submitter, status, unresolved findings, version, and submission age. Emphasize exceptions and differences rather than uniform review.
Review workbench: original creative and highlighted evidence on the left; findings, policies, proposed corrections, and contextual chat on the right.
Preflight: actionable corrections for marketers/affiliates before formal human review.
Resolution: accept or dismiss findings with rationale; request missing information; generate consolidated feedback; receive revisions and see diffs.
Approval: human decides on a specific immutable asset version. A changed version requires a new review decision.
History: source links, revision timeline, model findings, reviewer actions, timestamps, and decision rationale.
7. Proposed relational schema (Supabase Postgres)
All workspace-owned records carry profile_id for straightforward access checks and queries. Foreign keys and uniqueness constraints enforce relationships; immutable events preserve the audit history.
Table
Essential fields / relationships
profiles
id, name, created_by, created_at. A named workspace; no individual/company type.
profile_members
profile_id, user_id → auth.users, role (owner/member), joined_at. UNIQUE(profile_id, user_id).
connections
id, profile_id, provider, connected_by, display_name, status, encrypted credential reference, config JSON, last_synced_at.
connection_targets
id, connection_id, external_target_id, type (folder/label), enabled, cursor JSON. UNIQUE(connection_id, external_target_id).
source_items
id, profile_id, connection_id nullable, provider, external_id, parent_external_id, source_url, sender, subject/name, source_modified_at, content_hash, metadata JSON, storage_path, sync_state. Unique provider ID within connection.
campaigns
id, profile_id, name, product, status, created_at.
assets
id, profile_id, campaign_id nullable, title, product, channel, status, created_at.
asset_sources
asset_id, source_item_id, profile_id. Bridge allowing many source records per asset, and vice versa.
asset_versions
id, profile_id, asset_id, version_no, source_item_id nullable, content_hash, extracted_text, original_file_path nullable, metadata JSON, created_by nullable, created_at. UNIQUE(asset_id, version_no).
policies
id, profile_id nullable (global rules supported), name, category, source_url nullable, active.
policy_versions
id, policy_id, version_no, rule_text, effective_at, created_at. Immutable snapshots.
analyses
id, profile_id, asset_version_id, model, policy_snapshot_hash, status, summary, input_tokens, output_tokens, cost_usd, created_at.
findings
id, profile_id, analysis_id, policy_version_id nullable, severity, classification, evidence, location JSON, rationale, proposed_fix, disposition, disposition_by nullable.
reviews
id, profile_id, asset_version_id, reviewer_id, status, decided_at nullable, rationale nullable.
review_events
id, profile_id, asset_version_id, review_id nullable, actor_id nullable, event_type, details JSON, created_at. Append-only.
asset_messages
id, profile_id, asset_id, user_id nullable, role, content, created_at. Optional contextual chat.
usage_events
id, profile_id, actor_id nullable, request_id unique, model, tokens, cost_usd, budget_day, created_at. Server-side cost ledger.
Derived state: use the latest asset_version for current review and a materialized/query-derived queue view. Avoid redundant writable “current approved version” fields that can become inconsistent. A review/approval references asset_version_id explicitly.
Suggested constraints: all cross-workspace foreign-key operations must verify matching profile_id; event records should be append-only; immutable versions must never be overwritten. Use indexes for profile_id, asset_id/version_no, connection/external_id, review status, and budget_day.
8. File storage structure
Use one private Supabase Storage bucket, not one bucket per profile. Store binaries once when possible; the database owns relationships and metadata. Keep extracted text in Postgres for searchable review and use Storage for original files, bulky extracts, and rendered previews.
Bucket: private-assets
profiles/{profile_id}/sources/{source_item_id}/original/{file_name}
profiles/{profile_id}/assets/{asset_id}/versions/{version_id}/preview/{file_name}
profiles/{profile_id}/assets/{asset_id}/versions/{version_id}/derived/{file_name}
For a direct upload, create a source_item with provider="upload" and store its original in the same sources layout. An asset_version can point to that source item and reuse the original file; do not copy identical binaries into every version directory.
Storage objects are private. Authorize reads using the requesting user’s active profile membership; use short-lived signed URLs for file viewing.
Do not embed email OAuth refresh tokens, provider API keys, or BYOK secrets in Storage, public tables, or client-side state.
Use opaque IDs and sanitized filenames. Content hash is for deduplication, not a substitute for profile-level isolation.
Set supported MIME types and file-size limits, validate uploads server-side, and clean up orphaned derived files deliberately.
Never overwrite the original underlying an approved version; changed content creates a new path/record.
9. Authentication, authorization, and cost controls
Supabase Auth identities join profiles through profile_members. A user may belong to multiple profiles; a profile may have multiple users. Access to profile-owned rows and private files is checked by profile membership with RLS. Sensitive ingest/sync, approval actions, and model calls are performed server-side with scoped authorization and audit events.
Inference: $10/day application-funded AI budget. Enforce a per-day spend reservation/ledger on the server to handle concurrent requests; use provider-side limits as an emergency backstop rather than assuming a precise hard cap. Cache unchanged analyses; bound concurrency, payload sizes, and output tokens; record actual model costs. Optional BYOK can be used when the application allocation is depleted, but must not silently fall back to billable platform credentials. No Stripe.
10. Testing and interview demonstration
Prepare 15–20 known-answer cases across loans, credit cards, mortgage prequalification, affiliate messages, visual disclosures, source duplicates, revisions, misleading rates, incomplete metadata, and prompt injection. Measure critical-issue recall, false positives, citation validity, ingestion accuracy, revision matching, inference cost, and review time. Do not invent performance gains.
Connect a seeded Gmail mailbox and Drive folder and ingest actual materials, with manual upload as independent fallback.
Show automatic asset creation, source links, deduplication, and exception-focused queue.
Open a high-risk ad, examine exact evidence, regulation/policy references, and actual offer discrepancies.
Generate one consolidated revision request; sync or upload a revised asset; show changes and unresolved findings.
Have a human approve the corrected version; inspect immutable review history.
Show that injected instructions in submitted content cannot cause automated approval.
Show observed analysis quality, token cost, and workflow events.
11. 24-hour build plan
Hours
Outcome
0–2
Finalize workflows, known-answer fixtures, product policies, schema, and source authorization setup.
2–7
Build auth/profiles, source ingestion and direct import, campaign/asset persistence, and review queue.
7–11
Implement policy-based analysis, structured findings, evidence UI, caching, and cost ledger.
11–16
Complete reviewer decisions, consolidated revisions, version comparison, audit history, and chat if useful.
16–20
Test real sync, duplicates, missing context, malicious input, access control, and model errors.
20–24
Polish shadcn/ui interface, deploy, validate production, prepare README and live demo.
Definition of done: a reviewer can connect a source, discover and review assets, inspect grounded findings, request and receive revisions, approve the exact version, and retrieve its history; direct upload and live inference also work.
12. Presentation narrative
Start with the existing Excel-and-email bottleneck. Demonstrate that the system removes manual re-entry, repeated checks, and scattered feedback. Explain how preflight, source synchronization, exception triage, and version-aware review reduce human work without surrendering approval authority to AI. Close with observed tests, explicit limitations, per-review inference cost, and the deployed product.
