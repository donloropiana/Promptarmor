/**
 * Registry of the Nango integrations this app uses.
 *
 * The keys are the integration "unique keys" configured in the Nango dashboard
 * (Nango calls them providerConfigKey / integration id). They also equal
 * `connections.provider` and `connections.provider_config_key` in the database
 * (a check constraint enforces that the two match).
 *
 * Safe to import from client and server code: no secrets, no Node APIs.
 */

export const INTEGRATION_KEYS = [
  "google-mail",
  "google-drive",
  "google-sheet",
  "outlook",
  "one-drive",
  "one-drive-personal",
] as const;

export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export const PROVIDER_GROUPS = ["google", "microsoft"] as const;
export type ProviderGroup = (typeof PROVIDER_GROUPS)[number];

export type IntegrationKind = "mail" | "files" | "sheets";

export interface IntegrationInfo {
  key: IntegrationKey;
  displayName: string;
  group: ProviderGroup;
  kind: IntegrationKind;
}

export const INTEGRATIONS: Readonly<Record<IntegrationKey, IntegrationInfo>> = {
  "google-mail": { key: "google-mail", displayName: "Gmail", group: "google", kind: "mail" },
  "google-drive": { key: "google-drive", displayName: "Google Drive", group: "google", kind: "files" },
  "google-sheet": { key: "google-sheet", displayName: "Google Sheets", group: "google", kind: "sheets" },
  outlook: { key: "outlook", displayName: "Outlook", group: "microsoft", kind: "mail" },
  "one-drive": { key: "one-drive", displayName: "OneDrive for Business", group: "microsoft", kind: "files" },
  "one-drive-personal": {
    key: "one-drive-personal",
    displayName: "OneDrive Personal",
    group: "microsoft",
    kind: "files",
  },
};

export const GROUP_LABELS: Readonly<Record<ProviderGroup, string>> = {
  google: "Google",
  microsoft: "Microsoft",
};

/**
 * One "Connect Google" / "Connect Microsoft" click runs these steps back to back.
 * Each step is one Nango connect session and one OAuth consent, because a Nango
 * connection belongs to exactly one integration.
 *
 * - Google: Gmail, then Drive (two separate Google consents).
 * - Microsoft: Outlook, then OneDrive. The OneDrive step allows both the
 *   business and the personal integration, so Connect UI lets the user pick the
 *   one that matches their account type (work/school vs outlook.com/hotmail).
 *
 * Google Sheets is registered but not part of the default flow: Drive already
 * exposes spreadsheets read-only.
 */
export interface ConnectStep {
  /** Index-stable id used by the session route. */
  id: "mail" | "files";
  label: string;
  integrations: readonly IntegrationKey[];
}

export const CONNECT_STEPS: Readonly<Record<ProviderGroup, readonly ConnectStep[]>> = {
  google: [
    { id: "mail", label: "Gmail", integrations: ["google-mail"] },
    { id: "files", label: "Google Drive", integrations: ["google-drive"] },
  ],
  microsoft: [
    { id: "mail", label: "Outlook", integrations: ["outlook"] },
    { id: "files", label: "OneDrive", integrations: ["one-drive", "one-drive-personal"] },
  ],
};

export function isIntegrationKey(value: unknown): value is IntegrationKey {
  return typeof value === "string" && (INTEGRATION_KEYS as readonly string[]).includes(value);
}

export function isProviderGroup(value: unknown): value is ProviderGroup {
  return typeof value === "string" && (PROVIDER_GROUPS as readonly string[]).includes(value);
}

export function getIntegration(key: IntegrationKey): IntegrationInfo {
  return INTEGRATIONS[key];
}

export function integrationsForGroup(group: ProviderGroup): IntegrationInfo[] {
  return INTEGRATION_KEYS.map((key) => INTEGRATIONS[key]).filter((i) => i.group === group);
}

export function getConnectStep(group: ProviderGroup, stepId: ConnectStep["id"]): ConnectStep | undefined {
  return CONNECT_STEPS[group].find((s) => s.id === stepId);
}
