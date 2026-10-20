# Quick Cal

Shared availability calendar for friends, with no accounts and access by secret link. Built on the
listlet-shared starter kit. See README.md for the privacy model.

## Architecture

- **No build step.** Vanilla JS using IIFEs. Script tags in HTML, no bundler.
- **Supabase** backend, accessed **only through `quickcal_*` RPC functions** (security definer).
  Tables have RLS with no policies and no grants to anon/authenticated. Never add table policies
  or query tables directly from the client.
- **Mock mode** on localhost: `createMockBackend` in `cal-api.js` implements the same RPC contract in localStorage.
- **GitHub Pages** for deployment (`.github/workflows/deploy.yml`, which copies the files listed there).

## Files

- `app.js`: UI and routing on the URL fragment (`#c=<token>`, plus `&me=` / `&admin=` links that are absorbed into localStorage and stripped).
- `app.css`: app styles.
- `cal-util.js`: pure helpers (secrets, hash links, dates, day stats). Also `require`-able from Jest.
- `cal-api.js`: `CalApi.call(name, args)` maps to `supabase.rpc('quickcal_' + name, args)`, or to the mock.
- `sql/setup.sql`: schema, RPCs, and grants. It's the source of truth for the API contract.
- `sql/migrations/`: upgrades for the live database (re-running setup.sql wipes data). Add one for every schema or RPC change, and a contract test that applies it.

Only **blocked** days are stored (`status` is `busy` or `maybe`). A day with no row means the person is free, so
"free" counts are always derived from the member count.
- `shared/`: listlet-shared infrastructure. **Do not edit.** Only config-loader, supabase-client, utils, version, common.css and header.css are loaded; auth/home/api/sync are unused.

## Changing the API

Any change to an RPC must be made in **both** `sql/setup.sql` and `createMockBackend`, and covered in
`tests/unit/contract.test.js`, which runs every case against both the mock and the real SQL (PGlite as `anon`).
New public functions need an explicit `grant execute ... to anon, authenticated`. Internal helpers must be
in the `revoke` list, because Supabase grants EXECUTE to anon by default.

## Testing

```bash
npm test          # Jest (needs --experimental-vm-modules for PGlite; the npm script sets it)
npm run test:e2e  # Playwright, mock mode, serves via python3 -m http.server 8000
```

## Local Development

```bash
python3 -m http.server 8000
```
