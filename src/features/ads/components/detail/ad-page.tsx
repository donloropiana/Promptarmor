"use client";

import { useCallback, useMemo, useState } from "react";

import { AutoRefresh } from "@/features/ads/components/auto-refresh";
import { APPROVED_STATUSES, isLive } from "@/features/ads/domain";
import type { AdDetail } from "@/features/ads/server/queries/detail";

import { CheckStatus } from "./ad-page/check-status";
import { AdColumns } from "./ad-page/columns";
import { CreativePane } from "./ad-page/creative-pane";
import { AdHeader } from "./ad-page/header";
import { ChangesCard, IssuesSection } from "./ad-page/issue-sections";
import { ApprovalRecord, ChangedAfterApprovalNotice, ReReviewNotice, WaitingForRevision } from "./ad-page/lifecycle-cards";
import { useAdShortcuts } from "./ad-page/use-ad-shortcuts";
import { useIssueSelection } from "./ad-page/use-issue-selection";
import { AskBox } from "./ask-box";
import { DecisionBar, NO_DIALOGS, blockingReason, type DecisionDialogs } from "./decision-bar";
import { EditVersionSheet, editableText, type EditTab } from "./edit-version";
import { HiddenTextAlert } from "./hidden-text-alert";
import { History } from "./history";
import { ReviewSession } from "./review-session";
import { ShipIt } from "./ship-it";
import { AD_SHORTCUTS, ShortcutsDialog } from "./shortcuts-dialog";
import { summariseChanges } from "./what-changed";

/**
 * The ad page: holds the page's state (selection, open dialogs, the edit
 * sheet), works out what the reviewer may do with this version, and lays out
 * the header, the creative and review columns, and the decision bar.
 */
export function AdPage({ detail, userId }: { detail: AdDetail; userId: string }) {
  const { selectedId, select, leftView, setLeftView, creativeView, setCreativeView } = useIssueSelection(detail.findings, detail.latest.content.format);
  const [formFor, setFormFor] = useState<string | null>(null);
  const [dialogs, setDialogs] = useState<DecisionDialogs>(NO_DIALOGS);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [edit, setEdit] = useState<EditTab | null>(null);

  const approved = APPROVED_STATUSES.has(detail.status);
  const archived = Boolean(detail.archivedAt);
  const live = isLive({ status: detail.status, liveAt: detail.liveAt, expiresAt: detail.expiresAt, archivedAt: detail.archivedAt }, detail.now);
  // Approved ads are frozen (withdraw first); archived ones too (unarchive
  // first); rejected/withdrawn ones can still be re-decided.
  const readOnly = approved || archived;
  const openIssueIds = useMemo(() => detail.findings.filter((f) => f.open || f.disposition?.disposition === "accepted_exception").map((f) => f.id), [detail.findings]);
  const openCount = detail.findings.filter((f) => f.open).length;
  const changes = useMemo(() => (detail.previous ? summariseChanges(detail.findings, detail.previousFindings) : null), [detail.findings, detail.previousFindings, detail.previous]);
  const latestRun = detail.latestRun;

  const blocked = blockingReason(detail);
  // "Edit" (copy or file) follows the other actions: never on an approved ad, and not while a check is running.
  const editDisabledReason = archived
    ? "This ad is archived. Unarchive it before changing it."
    : approved
      ? "This ad is approved. Withdraw the approval before changing it."
      : detail.checking
        ? "Wait for the check to finish, then edit."
        : null;
  const openEdit = useCallback(
    (tab?: EditTab) => {
      if (editDisabledReason) return;
      setEdit(tab ?? (editableText(detail.latest).trim() ? "copy" : "file"));
    },
    [editDisabledReason, detail.latest],
  );
  // For a PDF or image with no text layer: did a model read it as an image?
  const fileRead: "transcribed" | "unread" | "unknown" = detail.checking || !latestRun ? "unknown" : latestRun.status === "complete" && latestRun.transcribed ? "transcribed" : "unread";
  const nothingToCheck = (detail.latest.content.format === "pdf" || detail.latest.content.format === "image") && !detail.latest.extractedText.trim() && fileRead === "unread";

  useAdShortcuts({
    readOnly,
    blocked,
    checking: detail.checking,
    findings: detail.findings,
    editDisabledReason,
    openEdit,
    selectedId,
    openIssueIds,
    select,
    onShowShortcuts: setShowShortcuts,
    onDialogs: setDialogs,
    onFormFor: setFormFor,
  });

  return (
    <div className="enter flex min-h-0 flex-1 flex-col">
      <AutoRefresh active={detail.checking} />
      <ReviewSession profileId={detail.profileId} versionId={detail.latest.id} />

      <AdHeader detail={detail} live={live} archived={archived} readOnly={readOnly} onShowShortcuts={() => setShowShortcuts(true)} />

      <AdColumns
        alert={<HiddenTextAlert alerts={detail.alerts} issueCount={openCount} />}
        hasAlerts={detail.alerts.length > 0}
        creative={
          <CreativePane
            detail={detail}
            leftView={leftView}
            onLeftViewChange={setLeftView}
            view={creativeView}
            onViewChange={setCreativeView}
            selectedId={selectedId}
            onSelect={select}
            fileRead={fileRead}
            readOnly={readOnly}
            onEdit={openEdit}
            editDisabledReason={editDisabledReason}
          />
        }
        review={
          <>
            {(archived || approved) && <ShipIt detail={detail} />}

            {approved && detail.approval && <ApprovalRecord detail={detail} />}

            <CheckStatus detail={detail} openCount={openCount} />

            {detail.status === "re_review_due" && <ReReviewNotice reason={detail.reReviewReason} />}

            {detail.changedAfterApproval && !approved && detail.approval && <ChangedAfterApprovalNotice approval={detail.approval} latestVersionNo={detail.latest.versionNo} />}

            {detail.status === "changes_requested" && <WaitingForRevision detail={detail} />}

            {changes && detail.previous && (
              <ChangesCard changes={changes} previousVersionNo={detail.previous.versionNo} latestVersionNo={detail.latest.versionNo} leftView={leftView} onLeftViewChange={setLeftView} />
            )}

            <IssuesSection
              detail={detail}
              openCount={openCount}
              nothingToCheck={nothingToCheck}
              selectedId={selectedId}
              onSelect={select}
              formFor={formFor}
              onFormFor={setFormFor}
              readOnly={readOnly}
            />

            <AskBox versionId={detail.latest.id} versionNo={detail.latest.versionNo} />
            <History detail={detail} />
          </>
        }
      />

      <DecisionBar detail={detail} userId={userId} dialogs={dialogs} onDialogs={setDialogs} />
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} shortcuts={AD_SHORTCUTS} />
      <EditVersionSheet open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} assetId={detail.id} version={detail.latest} initialTab={edit ?? "copy"} />
    </div>
  );
}
