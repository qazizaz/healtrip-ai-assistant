# Notes and assumptions

**Scope.** Prototype of the "HealTrip AI Patient Decision Assistant": React chat, Node/Express backend, tool-calling agent, mock provider database, bilingual EN/AR. Built to show architecture and AI-agent design, with a production-style chat interface.

**How to run.** `npm install`, `npm run db:up` (PostgreSQL in Docker), `npm run setup:env -- --google-client-id=<id> --admin-email=<email>`, then `npm run dev:backend` and `npm run dev:frontend` and open http://localhost:5173. Sign in with Google (or set `AUTH_DEV_LOGIN=true` for a local email login). No AI key is needed: without `OPENROUTER_API_KEY` the rules-based agent answers. `npm test` and `npm run eval` need no network. Full guide in the README and `docs/`.

**Platform features.** Google login required for all users, per-user saved conversations, roles, no-code admin panel (model switch, instructions, ML settings, doctors, knowledge, users), OpenRouter model switch (Claude/ChatGPT/Gemini), ML/DL symptom-to-department scoring. The ML data is synthetic, which is called out as a limitation.

**Key decisions**
- LLM for language, code for decisions: red-flag screening, urgency rules, tool gating and output validation are deterministic and run regardless of the model.
- Emergency path never calls the model. Chest pain is never below "urgent".
- Hallucination control: provider data comes from DB rows by id; advice comes from retrieved, cited guidance; free text is scanned for unreturned names/phones; ordering is enforced (triage -> guidance -> search -> respond).
- Cost ladder with automatic fallback to the rules agent when a model fails, is rate-limited, or ignores the tool protocol.
- PostgreSQL as the database: versioned migrations, one-off seeding, parameterised provider search, per-user isolation and optimistic locking for chat turns. Storage sits behind small interfaces; tests run against PostgreSQL and an in-memory store.

**Assumptions.** All doctors, hospitals, phone numbers and guidance text are fictional/illustrative. Emergency number defaults to 997 (configurable). Triage thresholds are examples, not clinical rules.

**Known limitations.** Regex-based red flags with limited dialect coverage; BM25 retrieval (no embeddings); tier-0 understands clear descriptions only; model paths were not exercised against a live API in my build environment; eval cases are developer-authored.

**With more time.** pgvector embeddings for retrieval, streaming responses, clinician-reviewed rules and held-out evaluation set, booking/availability, consent flow, observability dashboards.
