"use client";

import Nango from "@nangohq/frontend";
import type { ConnectUI, ConnectUIEvent } from "@nangohq/frontend";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { drainConnectionSync } from "@/components/connections/sync-drain";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  CONNECT_STEPS,
  GROUP_LABELS,
  PROVIDER_GROUPS,
  type ConnectStep,
  type ProviderGroup,
} from "@/lib/nango/integrations";

/**
 * "Connect Google" / "Connect Microsoft".
 *
 * One click runs every step of the group back to back (Google: Gmail, then
 * Drive; Microsoft: Outlook, then OneDrive). Each step gets its own Nango
 * connect session limited to that step's integration(s), so Connect UI goes
 * straight to the provider's consent screen. The OAuth popup is opened by the
 * user's click inside the Connect UI iframe, so the second step is not blocked
 * by popup blockers.
 *
 * The connection row is written server side: by the Nango auth webhook, and,
 * as a fallback when the webhook is late or not configured, by
 * POST /api/connections/confirm (which re-checks the connection's tags with
 * Nango before writing anything).
 *
 * The first sync starts on the server, but one pass is time-boxed (~45 s), so
 * after connecting the buttons keep the backfill going in the background
 * (drainConnectionSync: calls the sync route again while it reports hasMore)
 * for as long as the page stays open.
 */

type StepOutcome =
  | { status: "connected"; providerConfigKey: string; connectionId: string }
  | { status: "cancelled"; error?: string }
  | { status: "failed"; error: string };

export interface ConnectButtonsProps {
  profileId: string;
  /**
   * Provider keys (connections.provider) the current user already has a live
   * connection for in this profile. Steps already covered are skipped, so a
   * user who connected Gmail but skipped Drive only sees the Drive consent.
   */
  connectedIntegrations?: readonly string[];
  groups?: readonly ProviderGroup[];
  className?: string;
  size?: "sm" | "default" | "lg";
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string") return body.error;
    if (typeof body.message === "string") return body.message;
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`;
}

async function fetchSessionToken(
  profileId: string,
  group: ProviderGroup,
  step: ConnectStep["id"] | undefined,
  reconnectConnectionId?: string,
): Promise<string> {
  const res = await fetch("/api/connections/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      reconnectConnectionId ? { profileId, group, connectionId: reconnectConnectionId } : { profileId, group, step },
    ),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) throw new Error("No session token returned");
  return body.token;
}

/** Returns our connections.id for the recorded connection, or null. */
async function confirmConnection(profileId: string, providerConfigKey: string, connectionId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/connections/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId, providerConfigKey, connectionId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { connectionId?: unknown };
    return typeof body.connectionId === "string" ? body.connectionId : null;
  } catch {
    // Best effort: the Nango webhook records the connection too.
    return null;
  }
}

/**
 * Opens Connect UI with a session token from `getToken` and resolves when the
 * user finishes, closes it, or the token request fails.
 */
function openConnectUi(
  getToken: () => Promise<string>,
  activeUi: { current: ConnectUI | null },
): Promise<StepOutcome> {
  return new Promise<StepOutcome>((resolve) => {
    let settled = false;
    let lastError: string | undefined;
    const nango = new Nango();
    let ui: ConnectUI | null = null;

    const finish = (outcome: StepOutcome) => {
      if (settled) return;
      settled = true;
      ui?.close();
      if (activeUi.current === ui) activeUi.current = null;
      resolve(outcome);
    };

    ui = nango.openConnectUI({
      detectClosedAuthWindow: true,
      onEvent: (event: ConnectUIEvent) => {
        switch (event.type) {
          case "connect":
            finish({
              status: "connected",
              providerConfigKey: event.payload.providerConfigKey,
              connectionId: event.payload.connectionId,
            });
            break;
          case "error":
            // Connect UI shows the error and lets the user retry; remember it
            // in case they close the modal instead.
            lastError = event.payload.errorMessage;
            break;
          case "close":
            finish({ status: "cancelled", error: lastError });
            break;
          default:
            break;
        }
      },
    });
    activeUi.current = ui;

    // Connect UI shows a loader until the token arrives.
    getToken()
      .then((token) => {
        if (!settled) ui?.setSessionToken(token);
      })
      .catch((err: unknown) => {
        finish({ status: "failed", error: err instanceof Error ? err.message : "Could not start the connection" });
      });
  });
}

/** Keeps each connection's backfill going while the page is open. */
async function drainAll(connectionIds: string[], signal: AbortSignal, onChange: () => void): Promise<void> {
  for (const id of connectionIds) {
    if (signal.aborted) return;
    await drainConnectionSync(id, { signal, onPass: () => onChange() });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ConnectButtons({
  profileId,
  connectedIntegrations = [],
  groups = PROVIDER_GROUPS,
  className,
  size = "default",
}: ConnectButtonsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<ProviderGroup | null>(null);
  const activeUi = useRef<ConnectUI | null>(null);
  const drainAbort = useRef<AbortController | null>(null);

  // Never leave the Connect UI iframe mounted (or a backfill loop running)
  // after navigating away.
  useEffect(() => {
    return () => {
      activeUi.current?.close();
      activeUi.current = null;
      drainAbort.current?.abort();
    };
  }, []);

  function runStep(group: ProviderGroup, step: ConnectStep): Promise<StepOutcome> {
    return openConnectUi(() => fetchSessionToken(profileId, group, step.id), activeUi);
  }

  async function connect(group: ProviderGroup) {
    if (busy) return;
    setBusy(group);
    const label = GROUP_LABELS[group];
    const connected = new Set(connectedIntegrations);
    const allSteps = CONNECT_STEPS[group];
    const pending = allSteps.filter((s) => !s.integrations.some((key) => connected.has(key)));
    // Everything already connected: run the full flow again (e.g. another mailbox).
    const steps = pending.length > 0 ? pending : allSteps;
    const total = steps.length;
    const toastId = toast.loading(`Connecting ${label}`, {
      description: total > 1 ? `Step 1 of ${total}: ${steps[0].label}` : steps[0].label,
    });
    const done: string[] = [];
    const recorded: string[] = [];
    let changed = false;

    try {
      for (let i = 0; i < total; i++) {
        const step = steps[i];
        toast.loading(`Connecting ${label}`, {
          id: toastId,
          description:
            total > 1
              ? `Step ${i + 1} of ${total}: approve read access to ${step.label}${
                  group === "microsoft" && step.id === "files"
                    ? " (OneDrive for Business for work or school accounts, OneDrive Personal for outlook.com)"
                    : ""
                }`
              : `Approve read access to ${step.label}`,
        });

        const outcome = await runStep(group, step);

        if (outcome.status === "connected") {
          changed = true;
          done.push(step.label);
          const rowId = await confirmConnection(profileId, outcome.providerConfigKey, outcome.connectionId);
          if (rowId) recorded.push(rowId);
          if (i < total - 1) {
            toast.loading(`${step.label} connected`, {
              id: toastId,
              description: `Next: ${steps[i + 1].label}`,
            });
            router.refresh();
            await sleep(700);
          }
          continue;
        }

        // Cancelled or failed: stop here and say what is still missing.
        const missing = steps.slice(i).map((s) => s.label).join(" and ");
        const reason = (outcome.status === "failed" ? outcome.error : outcome.error ?? "Closed before finishing").replace(/\.+$/, "");
        if (done.length > 0) {
          toast.warning(`${done.join(" and ")} connected; ${missing} not connected`, {
            id: toastId,
            description: `${reason}. Click Connect ${label} again to finish.`,
          });
        } else {
          toast.error(`${label} not connected`, { id: toastId, description: reason });
        }
        return;
      }

      toast.success(`${label} connected`, {
        id: toastId,
        description: `${done.join(" and ")} connected (read-only). The first sync is starting.`,
      });
    } catch (err) {
      toast.error(`${label} not connected`, {
        id: toastId,
        description: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setBusy(null);
      if (changed) router.refresh();
      if (recorded.length > 0) {
        drainAbort.current?.abort();
        const controller = new AbortController();
        drainAbort.current = controller;
        void drainAll(recorded, controller.signal, () => router.refresh());
      }
    }
  }

  return (
    <div className={className ?? "flex flex-wrap gap-2"}>
      {groups.map((group) => (
        <Button
          key={group}
          type="button"
          variant="outline"
          size={size}
          disabled={busy !== null}
          aria-busy={busy === group}
          onClick={() => void connect(group)}
        >
          {busy === group ? <Spinner /> : group === "google" ? <GoogleMark /> : <MicrosoftMark />}
          Connect {GROUP_LABELS[group]}
        </Button>
      ))}
    </div>
  );
}

export interface ReconnectButtonProps {
  profileId: string;
  group: ProviderGroup;
  /** Our connections.id of a needs_reconnect / error row connected by the current user. */
  connectionId: string;
  label?: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}

/**
 * Re-authorizes an existing connection in place (Nango reconnect session):
 * same Nango connection id, so the auth webhook ("override") re-activates the
 * existing row instead of creating a second one.
 */
export function ReconnectButton({ profileId, group, connectionId, label = "Reconnect", size = "sm", className }: ReconnectButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const activeUi = useRef<ConnectUI | null>(null);
  const drainAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      activeUi.current?.close();
      activeUi.current = null;
      drainAbort.current?.abort();
    };
  }, []);

  async function reconnect() {
    if (busy) return;
    setBusy(true);
    const toastId = toast.loading(`Reconnecting ${GROUP_LABELS[group]}`, { description: "Approve read access again" });
    try {
      const outcome = await openConnectUi(() => fetchSessionToken(profileId, group, undefined, connectionId), activeUi);
      if (outcome.status !== "connected") {
        const reason = outcome.error ?? "Closed before finishing";
        toast.error("Not reconnected", { id: toastId, description: reason.replace(/\.+$/, "") });
        return;
      }
      const rowId = await confirmConnection(profileId, outcome.providerConfigKey, outcome.connectionId);
      toast.success("Reconnected", { id: toastId, description: "Syncing resumes from where it stopped." });
      router.refresh();
      if (rowId) {
        drainAbort.current?.abort();
        const controller = new AbortController();
        drainAbort.current = controller;
        void drainAll([rowId], controller.signal, () => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      disabled={busy}
      aria-busy={busy}
      onClick={() => void reconnect()}
    >
      {busy ? <Spinner /> : null}
      {label}
    </Button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.29V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.94 11.94 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}
