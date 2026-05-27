# Astro → GitHub → Cloudflare Pages Workflow

> **Path conventions in this doc:** bare paths like `src/pages/index.astro` are relative to this repo root. Run the commands shown below from the repo root unless noted. The author's local workspace path is `D:\leon-web\portfolio` — substitute your own clone path.

## Status (2026-05-26)

The portfolio is **live at `homepage.leonzhao.dev`**, deployed via **GitHub Actions** running `cloudflare/wrangler-action@v3` — NOT via Cloudflare's native dashboard Git integration. Reason documented in the "Why GitHub Actions" section below.

Pages project: `portfolio` on the `Zoomaxed@gmail.com` Cloudflare account (the same account that owns `leonzhao.dev` DNS). Account ID: `3c5a3974fc58f2e9bc4f1d1151a85708`. Internal URL: `portfolio-4qb.pages.dev`.

**Update 2026-05-26**: AI project "Launch demo" links in `src/data/projects.ts` swapped from Streamlit Cloud (`*.streamlit.app`) to the Hetzner-hosted `apps.leonzhao.dev/{avalanche,ai-art}/` URLs after the mlhub stack went live. One-line edit per project; auto-deployed via the workflow described below.

---

## Prerequisites (one-time)

- Cloudflare account that owns `leonzhao.dev` DNS (currently `Zoomaxed@gmail.com`).
- GitHub repo `leoniscooler/portfolio` (public or private, both work).
- Node.js + npm on the local machine for the initial `wrangler` calls.

---

## The deploy path that worked

### 1. Create the Pages project locally via wrangler

From the repo root (in PowerShell):

```powershell
npx wrangler login
# Browser opens — make sure you're signed into the Zoomaxed account
# in that browser before clicking Authorize.

npx wrangler whoami   # confirm the right account

npm run build
npx wrangler pages deploy dist --project-name=portfolio
# Prompts: "Create a new project? yes" → "Production branch? main"
```

This uploads `dist/` directly and registers a Pages project named `portfolio` on Cloudflare. URL returned looks like `<hash>.portfolio-4qb.pages.dev`.

### 2. Add a GitHub Actions workflow for auto-deploy

Create `portfolio/.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=portfolio --branch=main
```

### 3. Add two GitHub repo secrets

https://github.com/leoniscooler/portfolio/settings/secrets/actions → **New repository secret**:

- `CLOUDFLARE_API_TOKEN` — create at https://dash.cloudflare.com/profile/api-tokens (must be signed into the Zoomaxed account first):
  - Create Token → **Custom token**
  - Permission: `Account` → `Cloudflare Pages` → `Edit`
  - Copy and paste into GitHub secret (shown only once)
- `CLOUDFLARE_ACCOUNT_ID` — `3c5a3974fc58f2e9bc4f1d1151a85708`

### 4. Commit and push

From the repo root:

```powershell
git add .github/workflows/deploy.yml
git commit -m "Add GitHub Actions workflow for Cloudflare Pages auto-deploy"
git push origin main
```

Watch the run at https://github.com/leoniscooler/portfolio/actions. Should complete in ~60–90s.

### 5. Add the custom domain

In Cloudflare dashboard (Zoomaxed account) → Workers & Pages → `portfolio` → **Custom domains** → **Set up a custom domain** → `homepage.leonzhao.dev`. Cloudflare auto-creates a CNAME (orange cloud, proxied) since DNS lives in the same account. Status goes Active within 1–5 min.

---

## Why GitHub Actions, not Cloudflare's dashboard Git integration

We tried the native flow first. It failed in two ways:

### Failure 1: Pages create flow hidden in the new UI

Cloudflare's dashboard (as of 2026-05) no longer shows a Pages tab in **Workers & Pages → Create application** on new accounts — only "Create a Worker" is offered. Pages is still fully supported but the create UI is hidden.

**Workaround** — deep link directly:

```
https://dash.cloudflare.com/?to=/:account/pages/new/provider/github
```

Paste verbatim. Do NOT replace `:account` — Cloudflare resolves it from the session. This opened the classic Pages wizard correctly on Leon's account.

### Failure 2: OAuth handshake bounced back

After clicking "Connect GitHub" on the new (Zoomaxed) account, the OAuth flow short-circuited — GitHub silently skipped the consent screen because the Cloudflare Workers and Pages GitHub App was already installed for the same GitHub user (`leoniscooler`) from a previous Cloudflare account. The OAuth callback never reached Cloudflare, so the dashboard kept showing "Connect GitHub."

We tried the full reset and it still failed:

1. Revoked the OAuth grant at https://github.com/settings/applications → Cloudflare Workers and Pages → Revoke access.
2. Uninstalled the GitHub App at https://github.com/settings/installations → Cloudflare Workers and Pages → Configure → Uninstall.
3. Verified neither URL listed Cloudflare anymore.
4. Retried Connect GitHub in a fresh incognito window with both sessions logged in fresh.

Still bounced back to the same Cloudflare "Connect GitHub" screen with no popup, no error. Likely a Cloudflare-side bug or cache when the same GitHub user is associated with multiple Cloudflare accounts.

**Resolution**: stopped fighting the OAuth and switched to GitHub Actions, which gives identical push-to-deploy behavior without ever touching the dashboard Git connection.

---

## Operational gotchas (encountered + documented)

### PowerShell blocks `npx.ps1` by default

First `npx wrangler login` failed with "running scripts is disabled on this system." One-time fix:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

`RemoteSigned` is Microsoft's developer-default — local scripts run, downloaded scripts need signing. No admin rights needed.

### Custom domains can only be removed via API

The dashboard's Custom domains table doesn't expose a remove button (only "SSL enabled" badge in the Actions column). `wrangler pages domain ...` was removed from the CLI. The only way to detach a custom domain from a Pages project is the API:

```powershell
$token = "YOUR_PAGES_EDIT_TOKEN"
curl.exe -X DELETE `
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/pages/projects/<PROJECT_NAME>/domains/<DOMAIN>" `
  -H "Authorization: Bearer $token"
```

Expected response: `{"result":null,"success":true,"errors":[],"messages":[]}`

Cloudflare enforces "remove custom domains first" before allowing project deletion (error code 8000028), so this matters any time you want to tear down a Pages project that has a custom domain attached.

### API token scope is per-Cloudflare-user

API tokens are created from a specific user's profile. A token created from Account A's user only works for Account A's resources. If you have two Cloudflare accounts under different emails, you need a separate token for each — they don't share.

### Cross-account CNAMEs need DNS-only (gray cloud)

If you ever set up a custom domain where the DNS lives on one Cloudflare account and the Pages project lives on another, the CNAME on the DNS account **must be gray cloud (DNS only)**, not proxied. Otherwise you hit "Error 1014: CNAME Cross-User Banned." This is intentional Cloudflare policy, not a bug. (Doesn't apply to our current setup since everything is on one account now.)

### Wrangler-created Pages projects can't be retrofitted with Git integration

Once a Pages project is created via `wrangler pages deploy` (direct upload), Cloudflare's dashboard doesn't expose a "Connect to Git" option for that project. The Settings tab only shows Build / Variables / Bindings / Runtime / General — no Source / Git section. To get Git integration you'd have to delete the project and recreate it via the Git flow. This is why we went straight to GitHub Actions instead.

---

## What happens on every future push

Push to `main` → GitHub Actions kicks off `deploy.yml` → `npm ci && npm run build` → `wrangler pages deploy dist` → new Pages deployment registered → `homepage.leonzhao.dev` updates within ~60–90s.

Roll back any deploy from the Cloudflare dashboard → `portfolio` → Deployments → click an older deployment → Manage deployment → Rollback.

---

## Cost

Free tier covers everything:
- Unlimited bandwidth
- 500 builds/month (we'll use <10)
- Custom domain
- HTTPS auto-configured
- GitHub Actions free minutes: 2000/month for public repos, plenty for this workload

---

## End-state plan

`homepage.leonzhao.dev` is a temporary staging subdomain. The intended permanent URL is the apex `leonzhao.dev` itself, once Leon retires the Adobe Portfolio site currently hosted there. At that point: update the two apex A records (currently pointing at Fastly/Adobe at `151.101.x.x`) to point at the Pages project, and drop or redirect the `homepage` subdomain.
