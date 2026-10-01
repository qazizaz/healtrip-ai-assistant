# Security and privacy

## Authentication and access control

- Sign-in uses Google Identity Services. The browser receives a Google ID token; the server verifies its signature, audience, expiry and verified email with Google's public keys (`google-auth-library`). Only the public client ID is used.
- The server then issues its own session cookie: HMAC-SHA256 signed, 12-hour sliding expiry, `HttpOnly`, `SameSite=Lax`, and `Secure` with the `__Host-` prefix in production.
- **Login is always required.** Signed-out visitors only get the sign-in page; the API returns only the sign-in settings. Chat, history and provider search require an active user.
- **Revocation.** Each cookie carries the user's token version. Signing out, an admin "Sign out everywhere" or disabling an account increases it, so existing cookies stop working immediately.
- **Roles.** `admin` (emails in `ADMIN_EMAILS` plus users promoted by an admin) and `user`. Admin APIs check the role on every request. Admins listed in `ADMIN_EMAILS` and the last remaining admin cannot be demoted or disabled, and admins cannot disable their own account.
- **Data isolation.** Every conversation query is scoped to the signed-in user id; another user's conversation id returns 404. Admins see a conversation count per user, never the contents. Agent internals stay on the server.

## Web security

- CSRF: state-changing requests require a custom header that browsers only send same-origin.
- Security headers via `helmet`: Content Security Policy (no inline scripts, `frame-ancestors 'none'`, scripts only from self and Google sign-in, images only from self and Google profile pictures), `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, plus a restrictive `Permissions-Policy`.
- `Cache-Control: no-store` on all API responses.
- Input validation with zod on every endpoint; JSON body limit 50 KB; message limit 1000 characters.
- Rate limits: sign-in attempts per IP, chat messages per user, one in-flight reply per conversation.
- Errors return generic codes; stack traces are never sent to the client.

## AI safety

- Emergency detection is deterministic and runs before any model call.
- Patient text is only ever passed as user content; the system rules treat it as data.
- Tools are read-only with typed, validated arguments; all SQL uses parameterised queries, so there is no path from model output (or any user input) to SQL injection, shell or file access.
- Output validation and the text guard block invented doctors, phone numbers and uncited advice.
- Admin-editable instructions are appended below locked safety rules that cannot be changed from the admin panel.

## Secrets

- `.env`, Google client secret files and key files are git-ignored.
- `npm run check:secrets` scans for API key patterns, private keys and committed `.env` files. It runs in CI and, after `npm run hooks`, before every commit.
- In production, secrets live in the host's secret store; `render.yaml` contains no values and wires `DATABASE_URL` from the managed database.
- The secret scan also flags PostgreSQL connection strings with a password for a non-local host.
- The Google client secret is not used by the app. If one was ever shared, rotate it in Google Cloud Console.
- `OPENROUTER_API_KEY` is used only on the server and never reaches the browser.

## Privacy

- Logs contain metadata only (conversation id prefix, tools used, latency), never patient text.
- Conversation history is stored in PostgreSQL, scoped to the owner; users can delete one conversation or all of them (messages are deleted with them).
- Statistics are aggregated counts (next step, urgency, department, model, language).

## Before handling real patient data

- Use a managed PostgreSQL with encryption at rest, automated backups and restricted network access; consider row-level security as an extra layer.
- Add a consent screen, a data retention policy and a review against local regulations (for example the Saudi PDPL).
- Use model providers under a data processing agreement and send only the minimum necessary text.
- Have clinicians review triage rules, guidance texts and Arabic wording.

## Reporting a vulnerability

Please report security issues privately to the repository owner instead of opening a public issue.
