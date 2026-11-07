import "server-only";

import { gmailAdapter } from "./gmail";
import { googleDriveAdapter } from "./google-drive";
import { oneDriveAdapter, oneDrivePersonalAdapter } from "./onedrive";
import { outlookAdapter } from "./outlook";
import type { ConnectorProvider, SourceAdapter } from "@/features/connections/types";

/**
 * provider (= Nango integration unique key = connections.provider) -> adapter.
 * 'google-sheet' has no adapter: Drive already exports spreadsheets (CSV).
 */
const ADAPTERS: Partial<Record<ConnectorProvider, SourceAdapter>> = {
  "google-mail": gmailAdapter,
  "google-drive": googleDriveAdapter,
  outlook: outlookAdapter,
  "one-drive": oneDriveAdapter,
  "one-drive-personal": oneDrivePersonalAdapter,
};

export function getAdapter(provider: string): SourceAdapter | null {
  return (ADAPTERS as Record<string, SourceAdapter | undefined>)[provider] ?? null;
}

export function hasAdapter(provider: string): boolean {
  return getAdapter(provider) !== null;
}

export const SYNCABLE_PROVIDERS = Object.keys(ADAPTERS) as ConnectorProvider[];
