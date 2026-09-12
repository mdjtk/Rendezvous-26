# Rendezvous '26

The 26th edition of Jamia Madeenathunnoor's Life Festival — **Decoding Phytolore**.

A plain HTML/CSS/JS multi-page festival website — no frameworks, no build step. Open any page in a browser and it works.

- **Home** (`index.html`) — theme showcase ("Decoding Phytolore"), festival vision, explore links
- **Results** (`results.html`) — published result posters, filterable by category
- **Gallery** (`gallery.html`) — captured festival photos with lightbox view and download
- **Team Points** (`team-points.html`) — live leaderboard (podium + full ranking)
- **Admin** (`admin.html`) — password-gated panel to upload photos, publish results and update team points

## Structure

```
index.html        home — theme showcase ("Decoding Phytolore"), festival vision
results.html      published result posters, filterable by category
gallery.html      captured festival photos with lightbox view and download
team-points.html  live leaderboard (podium + full ranking)
admin.html        password-gated panel (photos / results / teams)
poster-tiles.html standalone poster tile generator tool (jsPDF)

assets/img/       site images: rendezvous.png, decoding-cl/bw.png, BLeaf.png,
                  sideBranch.png, favicon.svg
css/style.css     all styles
js/config.js      Supabase URL/key + admin password (edit here)
js/db.js          data layer — Supabase REST (required)
js/ui.js          shared helpers: nav, feedback states, lightbox
js/results.js     results page logic
js/gallery.js     gallery page logic
js/team-points.js team points page logic
js/admin.js       admin panel logic
supabase/schema.sql  optional Supabase live-mode schema
```

## Running

No install needed. Just open `index.html`, or run any static server:

```bash
python -m http.server 8000
```

## Data mode

Supabase is required — there is no localStorage fallback. Team Points update every 10 seconds.
Admin/store access uses the `verify-pin` Edge Function — see "Security setup" below.

### Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in the SQL editor. It creates the tables, storage
   buckets and claim-gated read/write policies used by the site.
3. Open `js/config.js` and fill in:

   ```js
   SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
   SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
   ```

### Enabling the admin (security setup)

Writes are not open to the public. A short-lived JWT (8h) is required for every
write, minted by the `verify-pin` Edge Function when the correct PIN is entered:

```bash
# 1. create PIN hashes + a JWT secret (prints ready-to-paste values)
node supabase/generate-pins.mjs

# 2. deploy the function and store the secrets
supabase functions deploy verify-pin
supabase secrets set ADMIN_PIN_HASH=<...> STORE_PIN_HASH=<...> JWT_SECRET=<supabase JWT secret>

# 3. only for a database created before the migration: apply the gated policies
#    (run supabase/security_migration.sql in the SQL editor)
```

Until the function is deployed and `/admin` is opened, writes are rejected —
that is intentional. Reads stay public.

## Admin usage

Open `admin.html` and enter the admin access code. Three tabs:

- **Photos** — upload captured photos (multi-select), optional caption, delete photos.
- **Results** — publish a result poster (event name + category), delete posters.
- **Teams** — add teams, adjust points (+5 / -5), remove teams.

## Security note

The database enforces writes via Row Level Security: only JWTs carrying the
`rv26_role` claim (admin | store) can write, so even the shipped anon key cannot
mutate data. The PIN exists only as a hash in Supabase secrets and is exchanged
once, at login, for the JWT. `js/store.js` is stale, unreferenced code and can be
deleted.