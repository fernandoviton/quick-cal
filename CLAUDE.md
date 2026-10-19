# Quick Cal

A collaborative web app built on the listlet-shared starter kit.

## Architecture

- **No build step.** Vanilla JS using IIFEs. Script tags in HTML, no bundler.
- **Supabase** backend for auth (Google OAuth), database (PostgreSQL), and realtime sync.
- **Mock mode** on localhost — skips auth, uses localStorage. No Supabase needed for local dev.
- **GitHub Pages** for deployment.

## File Structure

- `app.js` — **YOUR APP LOGIC.** Replace this with your own code. Must export `App` with `init(container, listName)`.
- `app.css` — **YOUR APP STYLES.** Replace with your own styles.
- `shared/` — Shared infrastructure. **Do not edit** — managed by listlet-shared.
- `config.js` — Template config. Copy to `config.local.js` and fill in Supabase keys.
- `sql/setup.sql` — Database setup. Run in Supabase SQL Editor.

## Shared Infrastructure (`shared/`)

- `config-loader.js` — Loads config, sets `window.CONFIG`, auto-mocks on localhost
- `supabase-client.js` — Creates `window.supabaseClient` from CONFIG
- `api.js` — `createApi(listName)` — Supabase CRUD + mock mode
- `auth.js` — Google OAuth login, session check, mock bypass
- `home.js` — Home page: lists all lists, create new, open by name
- `header.js` — Header bar: app title, home button, profile/logout
- `sync.js` — Realtime subscriptions + polling fallback
- `utils.js` — `escapeHtml`, `generateListId`, `getListName`, `hasExplicitListName`

## Config Keys

- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` — Supabase project credentials (null = mock mode)
- `APP_TITLE` — Displayed in header and login page
- `DEFAULT_LIST_NAME` — Fallback when no `?list=` param

## Database Schema

Each item is its own row in `listlet_sample` (per-row model, not a single JSON blob per list):

- `id` (uuid, PK) — auto-generated
- `list_name` (text, indexed) — groups items into lists
- `content` (text) — the item's content
- `created_at` / `updated_at` (timestamptz) — auto-managed
- `content_date` (date, generated) — read-only projection of `content`'s JSON `date` field (NULL when content isn't JSON or has no date); backs date-range fetches. Apps that name this column differently set `CONFIG.CONTENT_DATE_COLUMN`.

## API Usage

```js
var api = createApi(listName);
var items = await api.fetchItems();              // returns array of item objects
var week = await api.fetchItems({dateFrom: '2026-07-01', dateTo: '2026-07-07'});  // bounded by content_date (inclusive)
api.setDateRange('2026-07-01', '2026-07-07');    // default range for later arg-less fetchItems (e.g. Sync refresh); null clears
var item = await api.createItem({content: ''});  // returns created item with id, timestamps
var updated = await api.updateItem(id, {content: 'new'});  // returns updated item
await api.deleteItem(id);
var allLists = await createApi.getAllLists();     // returns [{list_name, count, updated_at}]
```

## CLI Tooling (`scripts/`)

Node-only scaffolding for building CLI tools against the real Supabase table (never served to the browser):

- `scripts/supabase-cli.js` — shared client + `login()`. Authenticates as a real user via a stored Google refresh token (same RLS path as the browser), **never** a `service_role` key. Rotated refresh tokens are written back to `.env` automatically.
- `scripts/google-login.js` — one-time OAuth bootstrap: run it, sign in with Google at `http://localhost:3000`, and `SUPABASE_REFRESH_TOKEN` lands in `.env`. Requires the Google provider enabled and `http://localhost:3000/auth/callback` allowed in the Supabase dashboard.
- `scripts/env-file.js` — pure `.env` line-upsert logic (unit tested).
- Config comes from `.env` (copy `.env.example`): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_REFRESH_TOKEN`, optional `DB_TABLE`.

Build your app's CLI on top: `const { supabase, login, DB_TABLE } = require('./supabase-cli'); await login();` then query `DB_TABLE` normally.

## Local Development

```bash
python -m http.server 8000
```

Mock mode activates automatically on localhost. No Supabase needed.

## Testing

```bash
npm test          # Jest unit tests
npm run test:e2e  # Playwright E2E tests (starts local server)
npm run test:all  # Both
```

## Deployment

Push to `main` triggers GitHub Pages deploy. Requires `config.js` with real Supabase keys at the deploy root.
