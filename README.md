<p align="center">
  <img src="frontend/public/healtrip-logo.png" alt="HealTrip+" width="260" />
</p>

# HealTrip+ AI Patient Decision Assistant

A bilingual (English / Arabic) chat assistant that helps a patient decide what to do next: go to the emergency room, see a specialist today, book routine care, or get a second opinion. It then recommends matching doctors and hospitals, **only from the HealTrip provider database**.

Built as a technical prototype for HealTrip. All doctors, hospitals, phone numbers and medical guidance in this repository are fictional and for demonstration only.

> **Medical safety:** this is an engineering prototype, not a medical device. Triage rules and guidance texts are illustrative and must be reviewed by clinicians before any real use.

| Chat | Emergency handling |
|---|---|
| ![Chat](docs/screenshots/chat.png) | ![Emergency](docs/screenshots/emergency.png) |
| **Admin panel** | **Mobile (Arabic, RTL)** |
| ![Admin](docs/screenshots/admin-users.png) | <img src="docs/screenshots/mobile-ar.png" width="230" /> |

## Features

**For patients**
- Sign in with Google; the app is only available to signed-in users
- Chat interface with saved conversation history (search, rename, delete)
- Asks clarifying questions (severity, onset, associated symptoms) before recommending anything
- Clear next step with an urgency level, and doctor/hospital cards with a match score and a call button
- Emergency detection that answers immediately with the emergency number and nearby emergency departments
- Full English and Arabic support, including right-to-left layout and Arabic number/spelling normalisation

**For administrators (no code needed)**
- Switch the AI model (Claude, GPT or Gemini through OpenRouter) and test it live
- Edit the assistant's persona, tone, rules, welcome text and example prompts (safety rules stay locked)
- Manage doctors and hospitals, knowledge articles, departments and the ML scoring settings
- Manage users: promote admins, disable accounts, sign a user out everywhere
- Usage statistics and an audit log of admin changes

**Engineering**
- Tool-calling AI agent with deterministic safety layers and hallucination guards
- ML (logistic regression) and DL (neural network) symptom-to-department scoring
- PostgreSQL database with versioned migrations, automatic sample-data seeding and parameterised SQL
- Works without any API key using a built-in rules-based agent, and falls back to it automatically if the model fails
- 78 automated backend tests (run against both PostgreSQL and an in-memory store), a safety/quality evaluation suite, and CI on every push

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite 5, plain CSS (responsive, RTL), Google Identity Services |
| Backend | Node.js 22, Express 4, TypeScript (`tsx`), zod, helmet, cors, express-rate-limit, google-auth-library |
| Database | PostgreSQL 16 (`pg` driver), SQL migrations in `db/migrations`, Docker Compose for local use |
| AI | OpenRouter (Claude / GPT / Gemini), optional Anthropic or any OpenAI-compatible server (Ollama, Groq), tool-calling agent, BM25 retrieval |
| ML | Python (numpy, scikit-learn) for training; inference in TypeScript |
| Quality | Node test runner, evaluation harness, GitHub Actions (with a PostgreSQL service), pre-commit secret scan |
| Deploy | Render blueprint (`render.yaml`) or any Node host |

## Requirements

- **Node.js 22** (20.12 or newer works) and npm 10+
- **PostgreSQL 14+**: local via Docker (`npm run db:up`), an installed PostgreSQL, or a free cloud database (Neon, Supabase, Render)
- A Google OAuth **Client ID** (Web application) for sign-in. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#google-sign-in-setup)
- Optional: an **OpenRouter API key** to use Claude / GPT / Gemini. Without it, the free rules-based agent answers
- Optional: Python 3.10+ only if you want to retrain the ML models (`ml/requirements.txt`)

## Getting started

```bash
git clone https://github.com/<your-username>/healtrip-ai-assistant.git
cd healtrip-ai-assistant
npm install

# 1. database: start PostgreSQL in Docker (or set DATABASE_URL to your own server)
npm run db:up

# 2. create a local .env (git-ignored) with a generated SESSION_SECRET
npm run setup:env -- --google-client-id=<YOUR_CLIENT_ID> --admin-email=<YOUR_GOOGLE_EMAIL>
# then open .env and check DATABASE_URL; add OPENROUTER_API_KEY=... (optional)

# 3. run (tables are created and sample doctors/guidance loaded on first start)
npm run dev:backend     # terminal 1 -> http://localhost:3001
npm run dev:frontend    # terminal 2 -> http://localhost:5173
```

**Windows one-click start:** with Docker Desktop running, double-click `start-dev.cmd`. It starts PostgreSQL, adds `DATABASE_URL` to `.env`, installs dependencies, creates the tables and opens the app (log in `start-dev.log`).

**No Docker?** Install PostgreSQL ([postgresql.org/download](https://www.postgresql.org/download/)) and create a database and user, or create a free database on [Neon](https://neon.tech) and paste its connection string into `DATABASE_URL` (add `DATABASE_SSL=true`). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#database).

The backend prints `db=postgres` when it is connected to the database. Open http://localhost:5173 and sign in. Accounts listed in `ADMIN_EMAILS` can open the admin panel from the user menu (or `/#/admin`).

To try it without Google, set `AUTH_DEV_LOGIN=true` in `.env` and restart the backend: a local email sign-in box appears. This is ignored in production.

Production-style run (one server serves the API and the built frontend):

```bash
npm run build
npm start               # http://localhost:3001
```

## Environment variables

Copy from `.env.example` (or use `npm run setup:env`). Never commit `.env`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgres://healtrip:healtrip@localhost:5432/healtrip` |
| `DATABASE_SSL` | No | `true` to require verified TLS (managed databases reached over the internet) |
| `GOOGLE_CLIENT_ID` | Yes | Public OAuth client ID (Web application). No client secret is used |
| `ADMIN_EMAILS` | Yes | Comma-separated Google emails that are always admins |
| `SESSION_SECRET` | Yes | Long random string used to sign login cookies |
| `OPENROUTER_API_KEY` | No | Enables Claude / GPT / Gemini. Empty = rules-based agent |
| `CORS_ORIGIN` | Yes in production | The public URL of the app, e.g. `https://healtrip.onrender.com` |
| `DATA_DIR` | No | JSON file fallback used only when `DATABASE_URL` is empty (local experiments; refused in production) |
| `PORT` | No | Server port (default `3001`) |
| `EMERGENCY_NUMBER` | No | Default emergency number shown to patients (default `997`, editable in admin) |
| `AUTH_DEV_LOGIN` | No | `true` enables a local dev sign-in (never in production) |
| `AUTH_RATE_LIMIT_PER_MIN` | No | Sign-in attempts per IP per minute (default `20`) |
| `LLM_FALLBACK`, `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS` | No | Fallback and cost controls |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | No | Alternative single-model setups, used only when no OpenRouter key is set |

## Scripts

| Command | Description |
|---|---|
| `npm run dev:backend` / `npm run dev:frontend` | Run in development mode |
| `npm run build` / `npm start` | Build the frontend and start the production server |
| `npm run db:up` / `npm run db:down` | Start / stop the local PostgreSQL container |
| `npm run db:migrate` | Apply pending migrations and load sample data (also runs automatically on start) |
| `start-dev.cmd` | Windows: one-click local start (database, dependencies, migrations, backend, frontend) |
| `npm test` | Backend test suite (set `TEST_DATABASE_URL` to also run it against PostgreSQL) |
| `npm run eval` | Safety and quality evaluation (fails on a safety regression) |
| `npm run typecheck` | Type-check backend and frontend |
| `npm run check:secrets` | Scan the repository for committed credentials |
| `npm run hooks` | Enable the pre-commit secret scan (run once after cloning) |
| `npm run setup:env` | Create a local `.env` |
| `npm run train` | Retrain the ML models (needs Python with `ml/requirements.txt`) |

## How it works (short version)

1. Every message is validated and checked by a **deterministic emergency screen** (English + Arabic). A match returns the emergency response immediately, without calling any AI model.
2. Otherwise an **AI agent** works through tools in a fixed order: `assess_urgency` (rule engine decides urgency) → `lookup_guidance` (retrieves vetted guidance to cite) → `search_providers` (database search, ranked by the ML department score) → `respond`.
3. The final answer is **validated**: doctors must come from the search results, advice must cite retrieved guidance, and invented names or phone numbers are rejected.
4. If the model fails, times out or ignores the rules, the same turn is answered by the **rules-based agent**.

The model handles language; code makes the medical and factual decisions. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project structure

```
healtrip-ai-assistant/
├── backend/
│   ├── src/
│   │   ├── server.ts            Express app, routes, security headers
│   │   ├── agent/               agent loop, tools, output guard, model clients, model router
│   │   ├── triage/              emergency screen and urgency rules
│   │   ├── nlp/                 Arabic/English normalisation, extraction, reply templates
│   │   ├── ml/                  department scoring (model weights + inference)
│   │   ├── knowledge/           BM25 retrieval over guidance articles
│   │   ├── auth/                Google sign-in, session cookies, access control
│   │   ├── admin/               admin API
│   │   ├── settings/            validated admin settings
│   │   ├── storage/             PostgreSQL stores, migrations runner, JSON fallback
│   │   ├── services.ts          business rules on top of the stores
│   │   ├── data/                sample providers (seed data)
│   │   └── ...
│   ├── test/                    unit and API tests
│   └── eval/                    evaluation harness
├── frontend/
│   ├── public/                  logo and icons
│   └── src/                     App, Sidebar, Chat, Login, Admin, i18n, styles
├── ml/                          training script, synthetic training table, requirements.txt
├── db/migrations/               PostgreSQL schema (versioned SQL migrations)
├── docker-compose.yml           local PostgreSQL
├── docs/                        architecture, API, deployment, security, notes
├── scripts/                     env setup, secret scan, Windows start script
├── start-dev.cmd                Windows one-click local start
├── .github/workflows/ci.yml     CI: secret scan, typecheck, tests, eval, build
└── render.yaml                  Render deployment blueprint
```

## Documentation

- [Architecture and AI design](docs/ARCHITECTURE.md)
- [Database (PostgreSQL)](docs/DATABASE.md)
- [API reference and data model](docs/API.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Security and privacy](docs/SECURITY.md)
- [Notes and assumptions](docs/SUBMISSION_NOTES.md)

## Known limitations

- Provider data, guidance texts and triage thresholds are fictional/illustrative and not clinically validated.
- The ML training data is synthetic, so its accuracy reflects the generating table, not real-world performance.
- Retrieval is keyword-based (BM25); paraphrases without shared words can be missed.
- The emergency screen is rule-based with limited dialect and typo coverage, deliberately biased towards over-triggering.
- Arabic texts should be reviewed by a native speaker; the admin panel is English only.

## Author

**Qazi Izaz Ahmad** · Full Stack Software Engineer
