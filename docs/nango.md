# Nango (Google and Microsoft connections)

Users connect their own Google or Microsoft account. The app only reads mail and files. It never sends, modifies or deletes anything, even though the Nango-managed OAuth apps grant broader scopes. `nangoProxy` in `src/lib/nango/server.ts` enforces this: it allows GET, plus POST only for a Microsoft Graph `$batch` whose sub-requests are all GET.

## Integrations

These are the integration unique keys in the Nango dashboard (Nango cloud, `dev` environment). All use Nango-managed OAuth apps.

| Key | Name | Group | Kind | In the default connect flow |
|---|---|---|---|---|
| `google-mail` | Gmail | google | mail | yes, step 1 |
| `google-drive` | Google Drive | google | files | yes, step 2 |
| `google-sheet` | Google Sheets | google | sheets | no (Drive already lists spreadsheets) |
| `outlook` | Outlook | microsoft | mail | yes, step 1 |
| `one-drive` | OneDrive for Business | microsoft | files | step 2 (user picks) |
| `one-drive-personal` | OneDrive Personal | microsoft | files | step 2 (user picks) |

`src/lib/nango/integrations.ts` holds this registry. The key is also `connections.provider` and `connections.provider_config_key`.

## Connect flow

1. The user clicks **Connect Google** or **Connect Microsoft** (`src/features/connections/components/connect-buttons.tsx`).
2. For each step, the browser calls `POST /api/connections/session` with `{ group, profileId, step }`. The server checks membership, then calls `nango.createConnectSession` with:
   - `tags`: `end_user_id` (user id), `end_user_email`, `end_user_display_name`, `organization_id` (profile id)
   - `allowed_integrations`: the step's integration(s)
3. Connect UI opens with the token. With a single allowed integration it goes straight to the provider's consent screen. Google takes two consents in a row: Gmail, then Drive. For Microsoft, the OneDrive step lets the user choose OneDrive for Business (work or school account) or OneDrive Personal (outlook.com or hotmail.com).
4. When a step succeeds, the browser calls `POST /api/connections/confirm`. The server reads the connection back from Nango and checks that its tags name this user and this profile. If they match, it records the row. This is a fallback for the webhook below, and both paths are idempotent.
5. Nango sends an `auth` webhook. The server inserts the `connections` row (`status = syncing`). After the response, it looks up the account email with one read-only API call and runs the initial sync (`runConnectionSync`).

If the user closes Connect UI partway through, the steps that already succeeded stay connected. Clicking the button again skips them, as long as the page passes `connectedIntegrations`.

One sync pass is time-boxed (about 45 s on Vercel Hobby). When it runs out of time it leaves the connection `connected` with `stats.has_more = true` and returns `hasMore`. While the page stays open, the Connect buttons keep calling `POST /api/connections/:id/sync` until `hasMore` is false (`src/features/connections/components/sync-drain.ts`, up to 10 passes, waiting when a pass is already running). The daily maintenance cron also runs one pass for the connection that has waited longest.

## Reconnect

A connection in `needs_reconnect` or `error` is re-authorized in place: `ReconnectButton` calls `POST /api/connections/session` with `connectionId` (our row id). The server checks that the caller connected that row, then calls `nango.createReconnectSession({ connection_id, integration_id, tags })`. Nango keeps the same connection id and sends an `override` auth webhook, which re-activates the existing row (the confirm route does the same as a fallback). If someone connects the same account again instead, the new row supersedes the old broken one: it is marked `disconnected` and its Nango connection is revoked.

## Webhook

Configure this in the Nango dashboard under **Environment Settings > Webhooks** (dev environment):

- **Webhook URL:** `https://promptarmor-two.vercel.app/api/nango/webhook`
- Turn on **Send New Connection Creation Webhooks**.
- Turn on the auth webhooks for refresh failures and deletions.
- Sync webhooks are not used. The app does not deploy Nango sync functions.

The route verifies `X-Nango-Hmac-Sha256`, which is a hex HMAC-SHA256 of the raw body keyed with the **webhook signing key**. It rejects bad signatures with 401. Every authentic webhook gets a 200 quickly.

The signature covers only the body (no timestamp or nonce), so the route stores `sha256(raw body)` in `webhook_receipts` before acting. A body it has seen before gets `200 {duplicate: true}` and changes nothing. The maintenance cron deletes receipts older than 7 days.

| Webhook | Effect |
|---|---|
| `auth` / `creation`, success | Insert the `connections` row. The profile and user come from the tags. Then account email and initial sync run in `after()`. |
| `auth` / `override`, success | Re-activate a `needs_reconnect` or `error` row, then sync. |
| `auth` / `refresh`, failure | `needs_reconnect` with `last_error` |
| `auth` / `refresh`, success (recovery) | Back to `connected` |
| `auth` / `deletion` | `disconnected` |
| anything else | ignored |

The profile is read from the tags only when the row is first inserted. After that, every lookup uses `(provider_config_key, nango_connection_id)`. The `connections` insert trigger rejects a user who is no longer a member of the profile. In that case the Nango connection is deleted.

For local testing, use a tunnel (ngrok or similar) and set `webhook_url_override` on a test connection in the Nango dashboard. Do not change the environment's webhook URL.

## Disconnect

`DELETE /api/connections/:id` takes our `connections.id`, never a Nango id. It loads the row under RLS. Only the member who connected the account, or a profile owner, can disconnect it. The route deletes the Nango connection, which drops the tokens, then marks the row `disconnected` and sets `nango_revoked_at`.

A row can also become `disconnected` without that route: `remove_member` and `leave_profile` (callable directly through the Data API), a superseded connection, or a failed Nango delete. `revokeDisconnectedNangoConnections()` sweeps every `disconnected` row with `nango_revoked_at` null, deletes it at Nango and stamps `nango_revoked_at`. It runs after member removal and leaving, after manual syncs and webhooks (in `after()`), and from the daily cron.

`POST /api/connections/:id/sync` follows the same rule as Disconnect (the connecting member or an owner) and refuses a connection that finished a full sync less than a minute ago.

## Maintenance cron

`vercel.json` schedules `GET /api/cron/maintenance` daily (Hobby allows one run a day). Set `CRON_SECRET` in Vercel; Vercel sends it as `Authorization: Bearer …`, and without it the route refuses every call. Each run: closes sync runs killed by a timeout (`recover_stale_syncs`), runs the Nango revocation sweep, deletes old webhook receipts, then spends the rest of its 60 s on one sync pass.

## Environment variables (server only, in Doppler `promptarmor` / `prd`)

| Name | Purpose |
|---|---|
| `NANGO_SECRET_KEY` | Nango environment API key (Environment Settings > API Keys). Used for connect sessions, the proxy and deletes. |
| `NANGO_WEBHOOK_SIGNING_KEY` | Webhook signing key (Environment Settings > Webhooks > Signing key). It is a different key from the API key. |
| `NANGO_WEBHOOK_SIGNING_KEY_PREVIOUS` | Optional. The old signing key, accepted during the 5-minute rotation window. |
| `NANGO_HOST` | Optional. Defaults to `https://api.nango.dev`. |

None of these may be added to `next.config.ts` `env` or given a `NEXT_PUBLIC_` prefix. The browser only ever receives a 30-minute connect session token.

Vercel needs `NANGO_SECRET_KEY` and `NANGO_WEBHOOK_SIGNING_KEY` in Production, either from the Doppler sync or set by hand. Without them, the session route returns 503 and the webhook returns 503, so Nango logs the failure.
