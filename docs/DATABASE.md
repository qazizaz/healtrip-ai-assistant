# Database (PostgreSQL)

HealTrip+ stores all application data in PostgreSQL 14+ (developed and tested on 16).

## Quick start

```bash
npm run db:up        # PostgreSQL 16 in Docker (docker-compose.yml), port 5432
npm run db:migrate   # create tables + load sample data (also runs automatically when the server starts)
npm run db:down      # stop the container (data is kept in the "healtrip-db" volume)
```

Connection string for the local container (already in `.env.example`):

```
DATABASE_URL=postgres://healtrip:healtrip@localhost:5432/healtrip
DATABASE_SSL=false
```

On Windows, `start-dev.cmd` does all of this in one step (Docker, `.env`, `npm install`, migrations, backend and frontend).

Other options: an installed PostgreSQL, or a managed database (Neon, Supabase, Render). For managed databases reached over the internet set `DATABASE_SSL=true`. See [DEPLOYMENT.md](DEPLOYMENT.md#database).

## Schema

Defined in [`db/migrations/001_init.sql`](../db/migrations/001_init.sql).

```mermaid
erDiagram
  users ||--o{ conversations : owns
  conversations ||--o{ messages : contains
  users {
    text id PK "google:<sub>"
    text email
    text name
    text role "user | admin"
    boolean disabled
    int token_version
    timestamptz last_login_at
  }
  conversations {
    uuid id PK
    text user_id FK
    text title
    jsonb agent_state
    int version
    timestamptz updated_at
  }
  messages {
    bigserial id PK
    uuid conversation_id FK
    text role "user | assistant"
    text content
    jsonb data
    timestamptz created_at
  }
  providers {
    text id PK "prov_001"
    text type "doctor | hospital"
    text specialty
    text city
    text_array languages
    text_array accepts_insurance
    boolean er_available
    numeric rating
    text phone
  }
  guidance {
    text id PK
    text title_en
    text text_en
    text_array tags
  }
  app_settings {
    smallint id PK "always 1"
    jsonb value
  }
  audit_log {
    bigserial id PK
    text actor
    text action
    text target
  }
  chat_events {
    bigserial id PK
    text next_step
    text urgency
    text department
    text model
    boolean fallback
  }
```

| Table | Purpose | Notes |
|---|---|---|
| `providers` | Doctors and hospitals the assistant may recommend | Indexes on `(specialty, rating)`, `lower(city)`, GIN on `languages` and `accepts_insurance` |
| `guidance` | Medical guidance passages the assistant must cite | Loaded into an in-memory BM25 index at start-up and after every admin edit |
| `users` | Google accounts and roles | `token_version` is increased to revoke all session cookies of a user |
| `conversations` | One row per chat | `agent_state` is server-only; `version` is used for optimistic locking |
| `messages` | Chat messages | Assistant rows keep the structured answer (providers, sources, urgency) in `data` |
| `app_settings` | Admin settings (single row) | Validated with zod before saving |
| `audit_log` | Admin and sign-in actions | Shown in Admin → Overview |
| `chat_events` | One row per answered turn, metadata only | Admin statistics are SQL aggregates over this table; never contains patient text |
| `app_meta` | One-off markers | e.g. `seed:v1` once sample data is loaded |
| `schema_migrations` | Applied migration files | Managed by the migration runner |

Deleting a user deletes their conversations and messages (`ON DELETE CASCADE`).

## Migrations

- Files in `db/migrations/` named `NNN_description.sql` are applied in order, once each, inside a transaction.
- The runner (`backend/src/storage/postgres.ts`) takes an advisory lock, so several app instances can start at the same time safely.
- To change the schema, add a new file (for example `002_add_appointments.sql`). Never edit a migration that has already been applied.

## Seed data

On the first start the 15 fictional providers (`backend/src/data/providers.json`) and the guidance passages (`backend/src/knowledge/guidance.json`) are inserted, and `app_meta.seed:v1` is recorded. Seeding never runs again, so providers deleted in the admin panel stay deleted. To reload the samples on a development database, reset it:

```bash
npm run db:down
docker volume rm healtrip-ai-assistant_healtrip-db   # deletes all local data
npm run db:up
```

## How the application uses it

- **Provider search** (`search_providers` tool and admin "try it"): one parameterised query filtered by specialty, city (case-insensitive), language and insurer (array membership), emergency department and second-opinion flags, ordered by rating, limited to 5.
- **Chat turns**: the user and assistant messages and the new agent state are written in one transaction. The update only succeeds if `conversations.version` still matches the value that was read; otherwise the API returns `409 busy`.
- **Isolation**: every conversation query includes `user_id = <signed-in user>`.
- **Health**: `GET /api/health` runs `SELECT 1` and returns `503` when the database is unreachable.
- **SQL safety**: all queries use bind parameters (`$1, $2, ...`); no SQL is built from user or model input.

## Useful commands

```bash
# open a SQL shell in the local container
docker compose exec db psql -U healtrip -d healtrip

# examples
\dt                                            -- list tables
SELECT id, name_en, specialty, city FROM providers ORDER BY id;
SELECT email, role, disabled, last_login_at FROM users;
SELECT next_step, count(*) FROM chat_events GROUP BY 1;

# backup and restore
pg_dump "$DATABASE_URL" > healtrip.sql
psql "$DATABASE_URL" < healtrip.sql
```

## Tests

`npm test` runs against an in-memory store by default. To run the same tests against PostgreSQL, point `TEST_DATABASE_URL` at an empty database whose name contains `test` (it is wiped before each test file):

```bash
docker compose exec db psql -U healtrip -c "CREATE DATABASE healtrip_test"
TEST_DATABASE_URL=postgres://healtrip:healtrip@localhost:5432/healtrip_test npm test

# Windows PowerShell
$env:TEST_DATABASE_URL="postgres://healtrip:healtrip@localhost:5432/healtrip_test"; npm test
```

CI does this on every push with a PostgreSQL 16 service.

## Development fallback

If `DATABASE_URL` is empty, the app stores data in JSON files under `DATA_DIR` so it can be tried without a database. This is for local experiments only: with `NODE_ENV=production` the server refuses to start without `DATABASE_URL`.
