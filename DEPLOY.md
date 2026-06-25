# Deploying to Cloudflare — from scratch

This guide takes you from a fresh machine to a live, password-protected tickets
portal running on Cloudflare's free tier. No prior Cloudflare or Workers
experience is assumed. It takes about 15 minutes.

You will end up with a URL like `https://visibuild-tickets-portal.<your-subdomain>.workers.dev`
(or your own custom domain) that:

- shows the **Settings** page to anyone with the **admin** password, and
- shows the **tickets list** to anyone with the **viewer** password.

---

## 1. Prerequisites

1. **Node.js 20 or newer** — <https://nodejs.org> (the `npm` command comes with it).
   Check with `node --version`.
2. **A Cloudflare account** — free, sign up at <https://dash.cloudflare.com/sign-up>.
3. **A Visibuild API client** (OAuth 2.0, *Client Credentials* grant, **read**
   scope). In Visibuild: **Company settings → API → Create credentials**. Copy
   the **Client ID** and **Client secret** — you'll paste them into Settings
   later. (See <https://help.visibuild.com/en/articles/10051205-api-credentials>.)

> You do **not** need to commit any secrets to source control. Visibuild
> credentials are entered through the app's Settings page; the two Cloudflare
> secrets are set with the `wrangler` CLI.

---

## 2. Get the code and install

```bash
git clone <this-repo-url> visibuild-tickets-portal
cd visibuild-tickets-portal
npm install
```

---

## 3. Log in to Cloudflare

`wrangler` is Cloudflare's CLI; it's already installed as a dev dependency.

```bash
npx wrangler login
```

A browser window opens — approve the access request. (On a headless server, use
`npx wrangler login` and follow the printed URL, or set a `CLOUDFLARE_API_TOKEN`
environment variable instead.)

---

## 4. Create the KV namespace

The app stores its editable configuration (Visibuild credentials, exposed
projects, viewer password) in a Cloudflare **KV namespace**.

```bash
npx wrangler kv namespace create CONFIG
```

It prints something like:

```
[[kv_namespaces]]
binding = "CONFIG"
id = "0123456789abcdef0123456789abcdef"
```

Open **`wrangler.toml`** and replace `REPLACE_WITH_YOUR_KV_ID` with the printed
`id` value:

```toml
[[kv_namespaces]]
binding = "CONFIG"
id = "0123456789abcdef0123456789abcdef"   # <- your id
```

---

## 5. Deploy

```bash
npm run deploy
```

The first deploy creates the Worker. If your account doesn't have a workers.dev
subdomain yet, wrangler asks you to **register one** — pick a name (e.g.
`your-org`) and confirm. It then prints your live URL, e.g.
`https://visibuild-tickets-portal.<your-subdomain>.workers.dev`.

> Deploying *before* setting the secrets (next step) is deliberate: it means the
> Worker already exists, so `wrangler secret put` attaches to it instead of
> prompting to create a new Worker. The site won't work until the secrets are set
> in step 6 — that's expected.

---

## 6. Set the two secrets

```bash
# The password used to reach the Settings page.
npx wrangler secret put ADMIN_PASSWORD

# A long random string used to sign login cookies. Generate one first:
#   openssl rand -hex 32
npx wrangler secret put SESSION_SECRET
```

Each command prompts you to paste the value. Choose a strong admin password and a
random session secret. Secrets apply to the live Worker immediately — no redeploy
needed. (If you ever change `SESSION_SECRET`, everyone is signed out — that's the
safe way to force re-login.)

---

## 7. Configure it (one-time, in the browser)

1. Go to **`https://<your-url>/settings/login`** and sign in with the
   **admin password** you set in step 6.
2. Fill in:
   - **Site name** — e.g. `Post-completion portal` (shown in the header).
   - **Logo URL** *(optional)* — a direct link to your logo image; leave blank for
     the default icon.
   - **Primary colour** *(optional)* — your brand colour; buttons and accents are
     derived from it automatically.
   - **API base URL** — leave the default (`https://app.apac.visibuild.com/api/core/v1`)
     unless you're outside the AU/APAC region.
   - **OAuth client ID / secret** — from your Visibuild API client (step 1).
3. Click **Save & test connection**. You should see *"Connected to Visibuild
   successfully."* If not, re-check the credentials and base URL.
4. Tick the **project(s)** you want developers to see, and click **Save**.
   (Leaving all unticked shows every project the credentials can access.)
5. Set a **Viewer password** and click **Save**.

---

## 8. Share with developers

Send the developer two things:

- the URL **`https://<your-url>/login`**, and
- the **viewer password**.

They'll see only the tickets for the project(s) you exposed. The admin password
also works at `/login` if you want to view the list yourself.

---

## Day-to-day

- **Change which projects are shown / rotate the viewer password:** sign in at
  `/settings/login` and update Settings.
- **Rotate the admin password:** run `npx wrangler secret put ADMIN_PASSWORD`
  again — it updates the live Worker immediately, no redeploy needed.
- **Custom domain:** in the Cloudflare dashboard open **Workers & Pages → your
  worker → Settings → Domains & Routes → Add custom domain**.
- **Uptime check:** `GET /healthz` returns `ok` and needs no password.

---

## Local development

```bash
cp .dev.vars.example .dev.vars   # set ADMIN_PASSWORD and SESSION_SECRET
npm run dev                      # http://localhost:8787
```

`wrangler dev` uses a **local, simulated** KV store, so your local configuration
is separate from production and no Cloudflare account is needed just to run it.
Run the tests with `npm test`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/settings/login` rejects the password | `ADMIN_PASSWORD` secret isn't set or differs. Re-run `npx wrangler secret put ADMIN_PASSWORD`. |
| "Save & test connection" fails | Check the OAuth client ID/secret and the API base URL; confirm the client uses the *Client Credentials* grant with *read* scope. |
| Tickets list is empty | There may genuinely be no post-completion tickets yet, or the exposed project has none. Try removing the project filter, or pick a different project in Settings. |
| Deploy fails on the KV binding | You didn't paste the namespace `id` into `wrangler.toml` (step 4). |
| Everyone got signed out | `SESSION_SECRET` changed — expected; users just sign in again. |
