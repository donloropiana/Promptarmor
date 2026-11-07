# Setup: Supabase Auth, email, and environment

Apply these settings manually in the Supabase dashboard for project
`dquwmmysasjvvgxnbhdl` (https://dquwmmysasjvvgxnbhdl.supabase.co).
The app code assumes all of them. Nothing here touches the Twilight projects.

Sign-in methods: email magic link plus 6-digit code, and email + password
with required email confirmation. The Supabase Google provider stays
configured (section 3) but the app shows no Google button, by decision:
sign-in is email-only. The only email the app
causes is Supabase Auth's own auth email (confirm, magic link/code, invite,
reset). The app sends no other email.

---

## 1. Auth → URL Configuration

| Setting | Value |
| --- | --- |
| Site URL | `https://promptarmor-two.vercel.app` |
| Redirect URLs | `https://promptarmor-two.vercel.app/**` (production only) |

The app passes `redirectTo` / `emailRedirectTo` built from the request origin.
Supabase only honors values on this list and falls back to the Site URL
otherwise.

**Do not add wildcard `*.vercel.app` patterns or `localhost` to this
production project.** Every entry is a host that may receive OAuth codes and
email-link tokens. With a team-wide pattern such as
`https://*-<team>-projects.vercel.app/**`, anyone who can get a matching
`*.vercel.app` hostname can start Google sign-in with their own PKCE
challenge and `redirect_to` pointing at their host; when a victim consents,
the code lands on the attacker's host and they exchange it for the victim's
session. `http://localhost:3000/**` is a smaller version of the same risk
(any process listening on the victim's port 3000).

- To test a preview deployment, add its **exact** hostname
  (`https://promptarmor-<hash>-<team>-projects.vercel.app/**`) temporarily,
  and remove it afterwards. Better: use a separate Supabase project for
  previews and local development.
- On localhost, sign in with the 6-digit code or a password: both work
  without a redirect URL.

## 2. Auth → Sign In / Providers

**Email** (enabled):

| Setting | Value |
| --- | --- |
| Enable email provider | ON |
| Confirm email | **ON** (required: invitations are bound to verified emails) |
| Secure email change | **ON** |
| Secure password change | ON |
| Minimum password length | 8 |
| Email OTP length | **6** |
| Email OTP expiration | 3600 seconds |

**Google** (enabled in Supabase, unused by the app; keep it or turn it off):

| Setting | Value |
| --- | --- |
| Client ID | OAuth client ID of a Google Cloud "Web application" client (not the Nango-managed apps) |
| Client Secret | that client's secret |
| Skip nonce checks | OFF |
| Allow users without an email | OFF |

In Google Cloud Console → APIs & Services → Credentials → that OAuth client:

- Authorized redirect URI: `https://dquwmmysasjvvgxnbhdl.supabase.co/auth/v1/callback`
- Authorized JavaScript origins: `https://promptarmor-two.vercel.app`
- OAuth consent screen scopes: `openid`, `email`, `profile` only. Mailbox and
  Drive access are granted separately through Nango.

**Everything else OFF**: Phone, Anonymous sign-ins, Azure/Microsoft and every
other OAuth provider. A provider whose email claim can be unverified would let
someone take an invitation addressed to another person.

## 3. Auth → Emails → SMTP Settings (custom SMTP, Gmail app password)

Supabase's built-in mailer only delivers to project team members at a very low
rate, so custom SMTP is required for interviewers to receive links and codes.

| Field | Value |
| --- | --- |
| Enable custom SMTP | ON |
| Sender email | the Gmail address that owns the app password |
| Sender name | `Compliance Workbench` |
| Host | `smtp.gmail.com` |
| Port | `465` (SSL). `587` (STARTTLS) also works |
| Username | the same Gmail address |
| Password | the Gmail **app password** (Doppler `GOOGLE_APP_PASSWORD`; paste it from Doppler, never commit it) |
| Minimum interval per user | 60 seconds (default) |

The Gmail account needs 2-Step Verification on before Google will issue an app
password (Google Account → Security → App passwords). Gmail caps sending at
roughly 500 messages a day.

Then **Auth → Rate Limits → Rate limit for sending emails**: raise from the
custom-SMTP default (30/hour) to about `100` per hour for the demo.

## 4. Auth → Emails → Templates

All links go to `/auth/confirm`, which renders a **Continue** button and only
spends the token on that click (email security scanners prefetch links).
`{{ .RedirectTo }}` is the destination the app asked for; the app reduces it to
a same-origin path. It is an absolute URL, so it is URL-encoded with
`| urlquery`: otherwise an `&` or `#` in it would split into extra
`/auth/confirm` query parameters. `{{ .Token }}` is the 6-digit code the
sign-in page accepts.

Links always open the **Site URL** (production). When testing on localhost,
use the 6-digit code or password sign-in instead of the link.

### Confirm signup

Subject: `Confirm your email`

```html
<h2>Confirm your email</h2>
<p>Click to confirm your email address and sign in:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo | urlquery }}">Confirm and sign in</a></p>
<p>Or enter this code on the sign-in page: <strong>{{ .Token }}</strong></p>
<p>If you didn't create an account, you can ignore this email.</p>
```

### Magic Link

Subject: `Your sign-in link and code`

```html
<h2>Sign in</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo | urlquery }}">Sign in to Compliance Workbench</a></p>
<p>Or enter this code on the sign-in page: <strong>{{ .Token }}</strong></p>
<p>The link and code work once and expire in 1 hour. If you didn't ask to sign in, ignore this email.</p>
```

### Invite user

Sent when a profile owner invites an address that has no confirmed account.
`{{ .RedirectTo }}` is the app's `/invite/<token>` page, where the invitee
explicitly accepts.

Subject: `You've been invited to Compliance Workbench`

```html
<h2>You've been invited</h2>
<p>You've been invited to a review workspace on Compliance Workbench.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next={{ .RedirectTo | urlquery }}">Accept the invitation</a></p>
<p>The link works once. If you weren't expecting this, ignore this email.</p>
```

### Reset password

Subject: `Reset your password`

```html
<h2>Reset your password</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next={{ .RedirectTo | urlquery }}">Choose a new password</a></p>
<p>If you didn't ask to reset your password, ignore this email.</p>
```

### Change email address (optional, for completeness)

Subject: `Confirm your new email`

```html
<h2>Confirm your new email</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next={{ .RedirectTo | urlquery }}">Confirm email change</a></p>
```

## 5. Environment variables

Names only (see `.env.example`). Source of truth: Doppler project
`promptarmor`, config `prd`. Run locally with:

```sh
doppler run -p promptarmor -c prd -- bun run dev
```

| Name | Used by | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | server, proxy, build | mapped to `NEXT_PUBLIC_SUPABASE_URL` in `next.config.ts` |
| `SUPABASE_PUBLISHABLE_KEY` | server, proxy, build | `sb_publishable_…`; mapped to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SECRET_KEY` | server only | `sb_secret_…`; admin client (auth.admin, webhooks). Never `NEXT_PUBLIC_` |
| `SUPABASE_JWKS_URL` | server only | `https://dquwmmysasjvvgxnbhdl.supabase.co/auth/v1/.well-known/jwks.json` (ES256) |
| `NANGO_SECRET_KEY` | server only | Nango Cloud dev environment |
| `NANGO_WEBHOOK_SIGNING_KEY` | server only | webhook signature verification |
| `NEXT_PUBLIC_SITE_URL` | optional | fallback origin when it can't be derived from the request |
| `CRON_SECRET` | server only | random string (e.g. `openssl rand -hex 32`); Vercel Cron sends it as `Authorization: Bearer …` to `/api/cron/maintenance`. Without it the cron route refuses every call |

**Vercel:** add the variables above to Production and Preview (Doppler → Vercel
sync, or by hand). `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must exist at
**build** time, because `next.config.ts` inlines them into browser bundles.
Without them the app still builds and serves, but auth is disabled (the proxy
logs one warning and skips session refresh).

## 6. Smoke tests after deploy

1. Password sign-up with a fresh address, do not confirm: password sign-in
   fails with "Confirm your email first"; the confirm email shows a link and
   a 6-digit code; either one signs you in.
2. Magic link: request on `/signin`, open the email, see the **Continue** page
   (nothing spent yet), click Continue, land signed in. Re-opening the same
   link shows "invalid, expired, or already used".
3. Invitations: owner invites a new address → Supabase Invite email arrives →
   Continue → `/invite/<token>` → Accept. Signed in as a different address,
   the invite page shows "Wrong account" with the masked invited email.
4. Reset password: "Forgot password?" → email → Continue → `/reset-password`.

## 7. Nango (Google and Microsoft connections)

The full flow is in `docs/nango.md`. You need to set these up by hand in the Nango dashboard (Nango Cloud, `dev` environment):

| Setting | Value |
| --- | --- |
| Environment Settings → Webhooks → Webhook URL | `https://promptarmor-two.vercel.app/api/nango/webhook` |
| Send New Connection Creation Webhooks | ON |
| Auth webhooks for token-refresh failures and deletions | ON |
| Sync webhooks | not used |
| Integrations (unique keys, Nango-managed OAuth apps) | `google-mail`, `google-drive`, `google-sheet`, `outlook`, `one-drive`, `one-drive-personal` (all six exist) |

The webhook checks `X-Nango-Hmac-Sha256` with `NANGO_WEBHOOK_SIGNING_KEY` (Environment Settings → Webhooks → Signing key). This environment's signing key is not the same as `NANGO_SECRET_KEY`. Optionally, set `NANGO_WEBHOOK_SIGNING_KEY_PREVIOUS` while you rotate the signing key. Vercel needs both `NANGO_*` variables in Production. Without them, `/api/connections/session` and the webhook return 503.

Smoke test: click **Connect Google**, approve Gmail and then Drive. Two rows should appear in `connections` with `status = syncing`, then `connected` once the first sync finishes. Then click **Disconnect** on one of them. The row should change to `disconnected`, and the connection should disappear from Nango's Connections tab.
