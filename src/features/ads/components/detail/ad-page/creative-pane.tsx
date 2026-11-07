"use client";

import type { ComponentProps } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AdDetail } from "@/features/ads/server/queries/detail";

import { CreativeView, type CreativeViewMode } from "../creative-view";
import { WordDiff } from "../what-changed";
import type { LeftView, SelectIssue } from "./use-issue-selection";

/**
 * The ad page's creative column: the latest version with its issues marked
 * and, on a revised ad, a tab for the word diff against the previous version.
 */
export function CreativePane({
  detail,
  leftView,
  onLeftViewChange,
  view,
  onViewChange,
  selectedId,
  onSelect,
  fileRead,
  readOnly,
  onEdit,
  editDisabledReason,
}: {
  detail: AdDetail;
  leftView: LeftView;
  onLeftViewChange: (v: LeftView) => void;
  view: CreativeViewMode;
  onViewChange: (v: CreativeViewMode) => void;
  selectedId: string | null;
  onSelect: SelectIssue;
  fileRead: ComponentProps<typeof CreativeView>["fileRead"];
  readOnly: boolean;
  onEdit: () => void;
  editDisabledReason: string | null;
}) {
  return (
    <>
      {detail.previous && (
        <Tabs value={leftView} onValueChange={(v) => onLeftViewChange(v as LeftView)} className="mb-3">
          <TabsList variant="line">
            <TabsTrigger value="current">V{detail.latest.versionNo}</TabsTrigger>
            <TabsTrigger value="changes">What changed</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {leftView === "changes" && detail.previous ? (
        <WordDiff previous={detail.previous} current={detail.latest} />
      ) : (
        <CreativeView
          version={detail.latest}
          findings={detail.findings}
          fileUrl={detail.fileUrl}
          selectedId={selectedId}
          onSelect={(id) => onSelect(id)}
          channel={detail.channel}
          view={view}
          onViewChange={onViewChange}
          fileRead={fileRead}
          rulesInForce={detail.rulesInForce}
          canAddIssue={!readOnly}
          onIssueAdded={(id, where) => onSelect(id, where)}
          onEdit={() => onEdit()}
          editDisabledReason={editDisabledReason}
        />
      )}
    </>
  );
}
