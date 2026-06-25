# Visibuild tickets portal

A small, password-protected web app that gives external stakeholders read-only
visibility over **post-completion tickets** recorded in
[Visibuild](https://visibuild.com). It runs on
[Cloudflare Workers](https://workers.cloudflare.com) and fetches data live from
the Visibuild API — there is no database to manage.

## What it does

- **`/login`** – viewers enter a password to see the tickets list.
- **`/`** – the tickets list: filter by project and status, click through to a
  ticket.
- **`/tickets/:id`** – a single ticket: number, title, status, priority, dates,
  location, address, description, **photos/attachments**, and **public**
  comments. No contact details or internal notes.
- **`/settings`** – the admin enters the admin password to connect Visibuild,
  choose which projects to expose, set the viewer password, and brand the site
  (name, logo URL, and a primary colour the rest of the palette derives from).

Two passwords, no user accounts:

| Password | Set where | Unlocks |
| --- | --- | --- |
| **Admin** | `ADMIN_PASSWORD` secret (at deploy) | `/settings` (and the tickets list) |
| **Viewer** | Settings page (stored in Cloudflare KV) | the tickets list at `/login` |

## Quick start (local)

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit the two values
npm run dev                      # http://localhost:8787
```

Open `http://localhost:8787/settings/login`, sign in with the `ADMIN_PASSWORD`
from `.dev.vars`, then add your Visibuild credentials, pick projects, and set a
viewer password. Viewers then sign in at `http://localhost:8787/login`.

> Local dev uses a simulated KV store, so you don't need a Cloudflare account to
> try it out. You do need a Visibuild OAuth client to load real data.

## Deploy to Cloudflare

See **[DEPLOY.md](./DEPLOY.md)** for the complete from-scratch guide (create the
KV namespace, set the secrets, deploy, and configure).

## Scripts

```bash
npm run dev        # local dev server (wrangler)
npm run deploy     # deploy to Cloudflare
npm test           # run the unit tests (vitest)
npm run typecheck  # type-check with tsc
```

## How it works

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Hono app: routes, auth gates, security headers |
| `src/auth.ts` | HMAC-signed session cookies (Web Crypto), constant-time password check |
| `src/config.ts` | Editable config stored as one JSON blob in KV |
| `src/visibuild.ts` | Live, read-only Visibuild API client (OAuth + fetch + in-memory caching) |
| `src/views/*.ts` | Server-rendered HTML pages |
| `public/` | `styles.css`, `app.js`, and icons, served as static assets |

Data is fetched live from Visibuild on each request; OAuth tokens, the project
list, and per-project location names are cached briefly in memory per Worker
instance. Nothing is persisted except the configuration you enter in Settings.

## Licence

MIT — see [LICENSE](./LICENSE).
