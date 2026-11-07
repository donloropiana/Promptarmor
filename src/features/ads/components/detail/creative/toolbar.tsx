"use client";

import { ExternalLink, FileText, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { channelLabel } from "@/features/ads/domain";
import type { AdVersion } from "@/features/ads/server/queries";

import type { CreativeViewMode } from "../creative-view";

/**
 * The row above the creative: what it is (channel or filename), Edit,
 * "+ Add issue", the Preview / Text switch for files and HTML, and Open PDF.
 */

export function CreativeToolbar({
  version,
  channel,
  fileUrl,
  view,
  onViewChange,
  onAddIssue,
  onEdit,
  editDisabledReason,
}: {
  version: AdVersion;
  channel: string | null;
  fileUrl: string | null;
  view: CreativeViewMode;
  onViewChange: (v: CreativeViewMode) => void;
  /** Opens the Add issue dialog; null when the ad text cannot take a new issue right now. */
  onAddIssue: (() => void) | null;
  onEdit?: () => void;
  editDisabledReason: string | null;
}) {
  const format = version.content.format;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground">
        {format === "text" && (channel ? `${channelLabel(channel)} · text` : "Text")}
        {format === "html" && "HTML creative"}
        {format === "pdf" && (version.content.filename || "PDF")}
        {format === "image" && (version.content.filename || "Image")}
      </div>
      <div className="flex items-center gap-2">
        {onEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-edit-version
            disabled={editDisabledReason !== null}
            onClick={onEdit}
            title={editDisabledReason ?? "Edit the copy or replace the file; the change becomes the next version (E)"}
          >
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
        )}
        {onAddIssue && (
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onAddIssue} title="Select words in the ad text, then add an issue for them">
            <Plus data-icon="inline-start" />
            Add issue
          </Button>
        )}
        {format !== "text" && (
          <Tabs value={view} onValueChange={(v) => onViewChange(v as CreativeViewMode)}>
            <TabsList className="h-7">
              <TabsTrigger value="preview" className="h-6 text-xs">
                Preview
              </TabsTrigger>
              <TabsTrigger value="text" className="h-6 text-xs">
                Text
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {format === "pdf" && fileUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <FileText data-icon="inline-start" />
              Open PDF
              <ExternalLink data-icon="inline-end" className="size-3" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
