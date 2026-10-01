-- HealTrip+ database schema (PostgreSQL 14+).
-- Applied automatically at server start-up, or manually with `npm run db:migrate`.

-- Doctors and hospitals: the only source the assistant may recommend from.
CREATE TABLE providers (
  id                        TEXT PRIMARY KEY,                 -- e.g. prov_001, the only id the agent may reference
  type                      TEXT NOT NULL CHECK (type IN ('doctor', 'hospital')),
  name_en                   TEXT NOT NULL,
  name_ar                   TEXT NOT NULL,
  specialty                 TEXT NOT NULL,                    -- shared vocabulary with the triage engine
  city                      TEXT NOT NULL,
  hospital_en               TEXT NOT NULL,
  hospital_ar               TEXT NOT NULL,
  languages                 TEXT[] NOT NULL DEFAULT '{}',     -- ISO 639-1 codes
  accepts_insurance         TEXT[] NOT NULL DEFAULT '{}',
  er_available              BOOLEAN NOT NULL DEFAULT FALSE,
  accepting_second_opinions BOOLEAN NOT NULL DEFAULT FALSE,
  rating                    NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  phone                     TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX providers_specialty_idx  ON providers (specialty, rating DESC);
CREATE INDEX providers_city_idx       ON providers (lower(city));
CREATE INDEX providers_languages_gin  ON providers USING GIN (languages);
CREATE INDEX providers_insurance_gin  ON providers USING GIN (accepts_insurance);

-- Vetted guidance passages the assistant must cite (indexed in memory with BM25).
CREATE TABLE guidance (
  id          TEXT PRIMARY KEY,
  title_en    TEXT NOT NULL,
  title_ar    TEXT NOT NULL,
  text_en     TEXT NOT NULL,
  text_ar     TEXT NOT NULL,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             TEXT PRIMARY KEY,                             -- 'google:<sub>'
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  picture        TEXT,
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled       BOOLEAN NOT NULL DEFAULT FALSE,
  token_version  INTEGER NOT NULL DEFAULT 0,                   -- bump to revoke every session cookie
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE conversations (
  id           UUID PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  agent_state  JSONB,                                          -- server-only agent working state
  version      INTEGER NOT NULL DEFAULT 0,                     -- optimistic locking: one turn at a time
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_updated_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE messages (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  data             JSONB,                                      -- assistant result: providers, sources, urgency, trace
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, id);

-- Admin-editable settings (model switch, instructions, ML, app), validated by the API before saving.
CREATE TABLE app_settings (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  target   TEXT NOT NULL,
  summary  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- One row per answered chat turn, metadata only (never patient text). Feeds the admin statistics.
CREATE TABLE chat_events (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_step   TEXT NOT NULL,
  urgency     TEXT,
  department  TEXT,
  model       TEXT NOT NULL,
  fallback    BOOLEAN NOT NULL DEFAULT FALSE,
  lang        TEXT NOT NULL
);
CREATE INDEX chat_events_at_idx ON chat_events (at);

-- Small key/value table for one-off markers such as "sample data seeded".
CREATE TABLE app_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
