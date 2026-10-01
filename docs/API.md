# API reference

Base URL: `/api`. Requests and responses are JSON.

- **Authentication:** an HttpOnly session cookie set by `POST /api/auth/google`. All endpoints except `/api/config`, `/api/health` and `/api/auth/*` require a signed-in user; `/api/admin/*` requires the admin role.
- **CSRF:** every `POST`, `PUT`, `PATCH` and `DELETE` must send the header `X-HealTrip-CSRF: 1`.
- **Errors:** `{ "error": "<code>" }` with the matching HTTP status. Common codes: `invalid_request` (400), `login_required` (401), `csrf` (403), `admin_only` (403), `account_disabled` (403), `not_found` (404), `busy` (409), `rate_limited` (429), `internal_error` (500).

## Auth

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/auth/me` | | Current user or `{ "user": null }` |
| POST | `/auth/google` | `{ "credential": "<Google ID token>" }` | Verifies the token with Google and starts a session |
| POST | `/auth/logout` | | Ends the session and revokes existing cookies for this user |
| POST | `/auth/dev` | `{ "email": "..." }` | Local development only (`AUTH_DEV_LOGIN=true`, not in production) |

## Chat

### `POST /chat`

```json
{
  "conversationId": "uuid (omit to start a new conversation)",
  "message": "I have chest pain since this morning",
  "lang": "en",
  "model": "claude"
}
```

`lang` is `en` or `ar`. `model` (`claude`, `chatgpt`, `gemini`) is optional and only applied when the admin allows patients to choose.

Response:

```json
{
  "conversationId": "uuid",
  "title": "I have chest pain since this morning",
  "reply": "Text shown to the patient",
  "lang": "en",
  "nextStep": "ask_question | see_specialist | second_opinion | routine_care | emergency | error",
  "urgency": "emergency | urgent | routine",
  "providers": [
    { "id": "prov_001", "type": "doctor", "name_en": "...", "name_ar": "...", "specialty": "cardiology",
      "city": "Riyadh", "phone": "...", "rating": 4.8, "match_score": 0.91 }
  ],
  "sources": [ { "id": "chest-pain", "title": "...", "text": "..." } ],
  "trace": [ { "tool": "assess_urgency", "ok": true, "summary": "urgent / cardiology" } ],
  "model": { "provider": "claude", "id": "~anthropic/claude-sonnet-latest" },
  "disclaimer": "Localized disclaimer",
  "limitReached": false
}
```

Agent failures still return `200` with `nextStep: "error"` and a safe message that includes the emergency number.

## Conversations

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/conversations` | | List of `{ id, title, createdAt, updatedAt, messageCount }`, newest first |
| GET | `/conversations/:id` | | `{ id, title, messages[], limitReached }` |
| PATCH | `/conversations/:id` | `{ "title": "..." }` | Rename |
| DELETE | `/conversations/:id` | | Delete one conversation |
| DELETE | `/conversations` | | Delete all of the user's conversations |

A conversation that belongs to another user always returns `404`.

## Other

| Method | Path | Description |
|---|---|---|
| GET | `/config` | Signed out: sign-in settings and emergency number. Signed in: also welcome texts, example prompts, departments and selectable models |
| GET | `/health` | `{ "ok": true }`; signed-in users also see the active model |
| GET | `/providers?specialty=cardiology` | Up to 5 providers for a department |

## Admin (`/admin/*`, admin role)

| Area | Endpoints |
|---|---|
| Overview | `GET /admin/overview`, `GET /admin/stats`, `GET /admin/audit` |
| Settings | `GET /admin/settings`, `PUT /admin/settings/:section`, `POST /admin/settings/:section/reset` (sections: `llm`, `instructions`, `ml`, `app`), `GET /admin/prompt-preview?lang=en` |
| Models | `GET /admin/openrouter-models?q=`, `POST /admin/llm-test` `{ "model": "<openrouter id>" }` |
| ML | `GET /admin/ml`, `POST /admin/ml/score` `{ "symptoms": ["chest_pain"] }` |
| Providers | `GET/POST /admin/providers`, `PUT/DELETE /admin/providers/:id` |
| Knowledge | `GET/POST /admin/guidance`, `PUT/DELETE /admin/guidance/:id` |
| Users | `GET /admin/users`, `PUT /admin/users/:id/role` `{ "role": "admin" }`, `PUT /admin/users/:id/status` `{ "disabled": true }`, `POST /admin/users/:id/signout` |

Admins never see conversation contents, only a count per user.

## Data model

Stored in PostgreSQL; full DDL in [`db/migrations/001_init.sql`](../db/migrations/001_init.sql).

**providers**

| Field | Notes |
|---|---|
| `id` | e.g. `prov_001`; the only identifier the agent may reference |
| `type` | `doctor` or `hospital` |
| `name_en`, `name_ar`, `hospital_en`, `hospital_ar` | Bilingual names |
| `specialty` | Shared vocabulary with the triage engine (cardiology, orthopedics, ...) |
| `city`, `languages[]`, `accepts_insurance[]` | Search filters |
| `er_available`, `accepting_second_opinions` | Routing flags |
| `rating`, `phone` | Ranking and contact (never sent to the model) |

**users**: `id` (`google:<sub>`), `email`, `name`, `picture`, `role`, `disabled`, `token_version`, `created_at`, `last_login_at`.

**conversations**: `id` (UUID), `user_id` → users (cascade), `title`, `agent_state` (JSONB, server-only), `version`, `created_at`, `updated_at`.

**messages**: `id`, `conversation_id` → conversations (cascade), `role` (`user`/`assistant`), `content`, `data` (JSONB: providers, sources, urgency, trace), `created_at`.

Also: `guidance`, `app_settings`, `audit_log`, `chat_events` (metadata for statistics), `schema_migrations`, `app_meta`.
