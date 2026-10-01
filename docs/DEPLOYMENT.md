# Deployment guide

The app runs as **one Node.js service** plus a **PostgreSQL database**. Express serves the API and the built React frontend from the same origin. Any host that runs Node 22 and can reach PostgreSQL 14+ works.

## Checklist

- [ ] PostgreSQL database created and `DATABASE_URL` set (tables are created automatically on first start)
- [ ] Google OAuth client created (Web application) with the production URL in **Authorized JavaScript origins**
- [ ] `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `SESSION_SECRET`, `CORS_ORIGIN` set in the host's secret/environment settings
- [ ] `OPENROUTER_API_KEY` set (optional; without it the rules-based agent answers)
- [ ] `NODE_ENV=production` (secure cookies, no dev login, refuses to start without `DATABASE_URL`)
- [ ] HTTPS in front of the app (required for secure cookies)
- [ ] Database backups enabled on the database host
- [ ] Open the deployed URL, sign in, send a test message, and run **Admin → AI model → Test this model**

## Database

### Local development

**Docker (easiest):**

```bash
npm run db:up        # PostgreSQL 16 on localhost:5432, user/password/db: healtrip
```

`.env.example` already contains the matching URL: `DATABASE_URL=postgres://healtrip:healtrip@localhost:5432/healtrip`. Stop it with `npm run db:down` (data is kept in a Docker volume).

**Installed PostgreSQL (Windows/macOS/Linux):** install from [postgresql.org/download](https://www.postgresql.org/download/), then in `psql` (or pgAdmin):

```sql
CREATE ROLE healtrip LOGIN PASSWORD 'choose-a-password';
CREATE DATABASE healtrip OWNER healtrip;
```

and set `DATABASE_URL=postgres://healtrip:choose-a-password@localhost:5432/healtrip`.

**Free cloud database:** create a project on [Neon](https://neon.tech) or [Supabase](https://supabase.com), copy the connection string into `DATABASE_URL` and set `DATABASE_SSL=true`.

### Schema and migrations

- Migrations live in `db/migrations/` and are applied in order, once each, when the server starts. You can also run them yourself with `npm run db:migrate`.
- The first run also loads the sample doctors/hospitals and guidance. It happens only once, so deleting a sample doctor in the admin panel is permanent.
- To change the schema, add a new file such as `db/migrations/002_add_booking.sql`; never edit a migration that has already been applied.

### Backups

Use the database host's automated backups. For a manual backup: `pg_dump "$DATABASE_URL" > healtrip.sql`; restore with `psql "$DATABASE_URL" < healtrip.sql`.

## Google sign-in setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → select or create a project.
2. **APIs & Services → OAuth consent screen**: set the app name, support email and logo. While the app is in *Testing* mode, add every Google account that should be able to sign in as a test user, or publish the app.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
4. Under **Authorized JavaScript origins** add:
   - `http://localhost:5173`, `http://localhost` and `http://localhost:3001` for local development
   - your production URL, e.g. `https://healtrip.onrender.com` (no trailing slash)
5. Leave **Authorized redirect URIs** empty. This app does not use them.
6. Copy the **Client ID** into `GOOGLE_CLIENT_ID`. The client secret is not needed; do not store it anywhere.

Changes can take a few minutes to apply. `Error 401: invalid_client` with "no registered origin" means the current URL is missing from the authorized origins.

## Option 1: Render

The repository includes a blueprint (`render.yaml`) that creates the web service **and** a PostgreSQL database, and connects them through `DATABASE_URL`.

1. Push the repository to GitHub.
2. In Render: **New → Blueprint** → select the repository.
3. Fill in the values Render asks for (`sync: false`): `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `OPENROUTER_API_KEY` (optional) and `CORS_ORIGIN` = `https://<your-service>.onrender.com`. `SESSION_SECRET` is generated, `DATABASE_URL` is wired from the database, `NODE_ENV` is `production`.
4. Deploy. The first start creates the tables and loads the sample data.
5. Add the Render URL to the Google OAuth client's authorized JavaScript origins.

Notes:
- Free web services sleep when idle; the first request after a pause can take about a minute.
- Render's free PostgreSQL plan expires after 30 days. For a longer-lived demo choose a paid database plan, or set `DATABASE_URL` (and `DATABASE_SSL=true`) to a free Neon/Supabase database instead and remove the `databases` block.

## Option 2: Any Linux server (VPS)

```bash
# Node 22 (for example with nvm) and PostgreSQL
nvm install 22 && nvm use 22
sudo apt install postgresql
sudo -u postgres psql -c "CREATE ROLE healtrip LOGIN PASSWORD 'choose-a-password';" -c "CREATE DATABASE healtrip OWNER healtrip;"

git clone https://github.com/<your-username>/healtrip-ai-assistant.git
cd healtrip-ai-assistant
npm ci
npm run build

cp .env.example .env      # set DATABASE_URL, NODE_ENV=production and the other values
chmod 600 .env
npm run db:migrate        # optional: also happens on start

# keep it running with pm2
npm install -g pm2
NODE_ENV=production pm2 start npm --name healtrip -- start
pm2 save && pm2 startup
```

Put a reverse proxy with HTTPS in front of port 3001, for example Nginx:

```nginx
server {
    server_name healtrip.example.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # TLS: certbot --nginx -d healtrip.example.com
}
```

The app trusts one proxy hop (`trust proxy = 1`) so rate limits and secure cookies work behind it.

## Updating

```bash
git pull
npm ci
npm run build
pm2 restart healtrip      # or redeploy on Render; new migrations are applied on start
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request with a PostgreSQL 16 service: secret scan, type check, tests (in-memory and PostgreSQL), migrations, evaluation and build.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Startup failed: connect ECONNREFUSED` | PostgreSQL is not running or `DATABASE_URL` is wrong. Start it (`npm run db:up`) and check host, port, user and password. |
| `Startup failed: ... self-signed certificate` / SSL errors | For cloud databases set `DATABASE_SSL=true`; for a local server leave it `false`. |
| Startup log shows `db=json` | `DATABASE_URL` is empty, so the development JSON fallback is used. Set it in `.env` and restart. |
| `/api/health` returns 503 | The app is running but cannot reach the database. |
| Startup log shows `google=false` or `openrouter=false` | The variable is not set, or `.env` is not next to `package.json` (Windows: check it is not saved as `.env.txt`). Restart after editing `.env`. |
| Google popup: `invalid_client` / `no registered origin` | Add the exact URL to Authorized JavaScript origins and wait a few minutes. |
| Google popup: `access_denied` | Consent screen is in Testing mode and the account is not a test user. |
| Replies show `fallback_to_rules` in "How this answer was made" | The model call failed: check the OpenRouter key and credit, and test the model in the admin panel. Choose a model that supports tool calling. |
