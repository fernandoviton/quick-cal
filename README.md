# Quick Cal

A shared availability calendar for friends. Someone creates a calendar, sends the
link around, and everyone taps or drags across the days they **can't** make (busy,
or "maybe"). Every unmarked day counts as free. The calendar shades days by how many
people are free.

**Dates that work** lists the stretches when *everyone* is free (no busy or maybe marks) over the next 6 months.
You choose the weekdays a stretch must include (Sat and Sun by default) and how many days in a row it needs (4 by
default). Stretches around the same weekend are merged into one result. For example, Thu–Sun, Fri–Mon and Sat–Tue
all being free shows as "Thu – Tue · 6 days free".
These settings are remembered per calendar, on each device.

There are no accounts. Built on [listlet-shared](https://github.com/fernandoviton/listlet-shared):
vanilla JS with no build step, Supabase for storage, GitHub Pages for hosting, and a
localStorage mock mode for local dev.

## Privacy model (why no Google sign-in)

Access works like a Google Docs "anyone with the link" share, but locked down further:

| Secret | Who has it | What it allows |
|---|---|---|
| Calendar token (`#c=…`) | Everyone you invite | See names and dates, join |
| Member key | Each person's own browser (or their personal link `#c=…&me=…`) | Edit only *that* person's dates and name |
| Admin key | The creator's browser (or the organizer link `#c=…&admin=…`) | Rename, remove people, delete the calendar |

- All secrets are 128-bit random values from `crypto.getRandomValues`, so they can't be guessed or brute-forced.
- They live in the URL **fragment** (after `#`). Browsers never send the fragment to the web host or in
  `Referer` headers, and the page also sets `referrer: no-referrer`.
- The database stores only SHA-256 hashes of the secrets.
- The tables have RLS on with **no policies**, and `anon`/`authenticated` have no table grants. The public
  Supabase key can only call the `quickcal_*` RPC functions, and each one checks the right secret. Nobody
  can list or enumerate calendars.
- Personal and organizer links are absorbed into localStorage and stripped from the address bar, so
  copying the URL only ever shares the invite link.
- The Supabase CDN script is pinned to a version with Subresource Integrity, since it runs on pages
  that hold the secret.

**What this doesn't protect against:** anyone who gets the invite link (forwarded chat, shared screen)
can view the calendar and join under any name. That's acceptable for friends sharing free dates. If it
leaks, the organizer can remove the stray people or delete the calendar and start a new one. If you ever
need real identities, swap in listlet's Google auth (`shared/auth.js`) and add RLS policies keyed on
`auth.uid()`.

**Abuse limits:** 50 people per calendar, 1000 blocked days per person, 366 days per write, dates within
about −1 to +2 years. Anyone with the public key can create calendars. Fine at friends scale; add a
rate limit or captcha if that ever becomes a problem.

## Local development

```bash
npm install
python3 -m http.server 8000
```

Open http://localhost:8000. Mock mode turns on automatically (data goes to localStorage, no backend needed).
To try "another person" locally, open the same link in a private window.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com) (or reuse one: all objects are prefixed `quickcal_`).
2. Run `sql/setup.sql` in the SQL Editor. Re-running it wipes Quick Cal data.
   Existing databases instead run the files in `sql/migrations/` that came after they were set up.
   `001_blocked_dates.sql` switches from "available" marks to "busy" marks, and drops the old ones.
3. No auth provider setup is needed.
4. To test locally against the real backend, copy `config.js` to `config.local.js` and fill in
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.

## Deployment (GitHub Pages)

Same as listlet-shared:

1. Settings → Pages → Source: **GitHub Actions** (or `gh api repos/<owner>/<repo>/pages -X POST -f build_type=workflow`).
2. Add the repo **variables** (not secrets) `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`:
   ```bash
   gh variable set SUPABASE_URL --body "https://xyz.supabase.co"
   gh variable set SUPABASE_PUBLISHABLE_KEY --body "sb_publishable_..."
   ```
3. Push to `main`. The workflow runs the unit tests, injects the config, and deploys.

## Testing

```bash
npm test          # Jest: helpers, and the API contract run against BOTH the mock and the real SQL (PGlite)
npm run test:e2e  # Playwright: create, block out days, drag, join, personal link, organizer actions
npm run test:all
```

The contract suite (`tests/unit/contract.test.js`) loads `sql/setup.sql` into an in-process Postgres
(PGlite), switches to the `anon` role, and checks the access rules, including that direct table access
and the internal helper functions are denied.
