# CLAUDE.md — portfolio

Operational guide for working inside this repo.

> **Path conventions in this doc:** bare paths like `src/pages/index.astro` are relative to this repo root — run commands from the repo root unless noted. Paths starting `D:\leon-web\...` refer to **workspace-only files** that don't live in this repo (cross-repo overview docs, scratch scripts, source images, the resume PDF). Those exist only on the author's local machine.

Strategic context (why this exists, how it fits with `mlhub/`) lives in `D:\leon-web\deployment.md` (workspace-only — not in this repo). Full deploy procedures (Cloudflare Pages via GitHub Actions, lessons learned) live in `DEPLOYMENT.md` (same directory as this file).

## What this repo is
Leon Zhao's portfolio site at `homepage.leonzhao.dev` (and eventually the apex `leonzhao.dev` once Adobe Portfolio is retired). Static Astro 5 + Tailwind 4 site deployed to Cloudflare Pages on push to `main`. Audience: college admissions officers — every design and content decision should serve that audience.

## Repo structure
```
portfolio/
  astro.config.mjs               Tailwind v4 via @tailwindcss/vite, devToolbar disabled
  package.json
  tsconfig.json
  .gitignore                     excludes node_modules/, dist/, .astro/
  public/
    logo.png                     site mark (mascot, not a portrait)
    cards/                       AI project card thumbnails — also used as detail-page heroes
      card_avalanche.png
      card_art_detector.png
      card_wordle_solver.png
      card_ai_enhanced_docs.png
      card_chatGPT.png
  src/
    styles/global.css            @import "tailwindcss" + dark variant + theme vars
    layouts/BaseLayout.astro     html shell, font load, no-flash theme script, header/footer
    components/
      Header.astro               logo + 6-item nav + ThemeToggle
      Footer.astro
      ThemeToggle.astro          sun/moon, localStorage persists, pre-paint script in BaseLayout
      ProjectCard.astro          image/placeholder + title + description + arrow
      ProjectGrid.astro          reusable show-more pattern (first 2 cards + "View all N")
    data/projects.ts             single source of truth for all project data
    pages/
      index.astro                About (landing)
      ai.astro                   AI grid (5 cards, links internally to /ai/[slug])
      games.astro                Games grid (18, mostly placeholders)
      math.astro                 Math grid (3 placeholders)
      physics.astro              Physics grid (2 placeholders)
      contact.astro              form (backend not wired yet)
      ai/[slug].astro            dynamic route, one detail page per AI project
  .github/workflows/deploy.yml   push to main → GitHub Actions → wrangler pages deploy
```

## Design decisions (locked 2026-05-25)
- **Visual reference**: `https://gungho0619.vercel.app/` — clean, sans-serif, left-aligned, project-card grid. Match restraint, not maximalism.
- **Framework**: Astro 5 + Tailwind CSS 4 (via `@tailwindcss/vite`).
- **Theme**: Default **light**, switchable to dark via toggle at top-right of every page. Pre-paint inline script in `BaseLayout` prevents flash.
- **Tab order**: About → AI → Games → Math → Physics → Contact. Six items, tested to fit at 390px viewport.
- **Per-tab pages**: each category gets its own page. Landing = About summary.
- **No comments / no public threads**: contact form only. Admissions audience = no risk surface.
- **About voice**: first-person ("I build..."). **Privacy filter**: no school name, no city, no SAT score, no "Top 10%", no email on About, no resume PDF link, no job-seeking language. Public site shows: name, grade, achievements/programs, snowboarding hook. `Golden Gate STEM Fair` is allowed despite mild Bay Area location leak — award is meaningful enough to keep.
- **Site mark**: `public/logo.png` (mascot, not a portrait). Used in `Header.astro`.
- **Project counts**: 5 AI, 18 Games, 3 Math, 2 Physics.
- **AI project detail pages**: each AI project gets its own detail page (`/ai/[slug]`). Visitor lands there first, reads story + sees screenshots, then clicks "Launch demo" to open the actual app in a new tab. Keeps visitor on Leon's brand. Games/Math/Physics cards link out directly (too many for detail pages).
- **Show-more pattern** on every project list page: first 2 cards shown by default, "View all N" black-pill button reveals the rest, "Show less" collapses. Pages with ≤2 projects skip the button. Implemented as reusable `<ProjectGrid>`.
- **Grid: always 3-col** (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). No state-based column switching — uniform card rhythm matches science/research-portfolio convention. Considered (and rejected 2026-05-25) a 2-col-collapsed → 3-col-expanded switch; the resize-on-click read as a layout shift.
- **Width strategy**: About + Contact use `max-w-3xl` (~768px, optimal reading line length). AI/Games/Math/Physics + AI detail pages use `max-w-6xl` (~1152px) for browsing. Toggled via the `wide` prop on `BaseLayout`.
- **Typography baseline** (legibility-tuned for admissions audience): body 16px, page h1 32–36px responsive, section h2 18px, nav 14px, card title 16px, card description 14.5px, button label 14px. Geist Sans + Geist Mono via Google Fonts.
- **AI card images** live in `public/cards/`. Each AI project's `image` field in `src/data/projects.ts` references `/cards/...`. The detail-page template falls back to this image as its hero when no `screenshots[]` array is provided — so one PNG serves both the card thumbnail and the detail-page hero.

## Demo URL mapping for AI projects (in `src/data/projects.ts`)
| Project | Live demo URL | Hosted on |
|---|---|---|
| Avalanche Risk Forecasting | `https://apps.leonzhao.dev/avalanche/` | Hetzner CCX13 via Caddy |
| AI Art Detection | `https://apps.leonzhao.dev/ai-art/` | Hetzner CCX13 via Caddy |
| Wordle Solver | `https://leoniscooler.github.io/wordlesolver/` | GitHub Pages |
| Docs | `https://leoniscooler.github.io/docs/` | GitHub Pages |
| ChatGPT Interface | `https://leoniscooler.github.io/chatgpt/` | GitHub Pages |

The first two were swapped from Streamlit Cloud (`avalancheprediction.streamlit.app`, `aiartdetection.streamlit.app`) to `apps.leonzhao.dev` on 2026-05-26 when the Hetzner stack went live. The Streamlit Cloud demos still resolve but are no longer linked.

## Always do first
- **Invoke the `frontend-design` skill** before writing any front-end code, every session, no exceptions. The skill is the source of truth for craft level; following it is what keeps this site out of generic-AI-aesthetic territory.

## Reference images
- **If a reference image is provided**: match layout, spacing, typography, and color exactly. Swap in placeholder content (images via `https://placehold.co/`, generic copy). Do not improve or add to the design.
- **If no reference image**: design from scratch with high craft.
- Screenshot your output, compare against reference, fix mismatches, re-screenshot. Do at least 2 comparison rounds. Stop only when no visible differences remain or the user says so.

## Local development

### Dev server
```powershell
npm install
npm run dev
```
Astro defaults to port `4321`. **If the server is already running, do NOT start a second instance.** Restart only if dependencies changed.

### Build
```powershell
npm run build      # outputs to dist/
npm run preview    # serve dist/ locally for a final check before push
```
GitHub Actions does the same on push to `main`. Don't commit `dist/` or `node_modules/`.

## Screenshot workflow
Captures use globally-installed Puppeteer:
- Puppeteer: `puppeteer@25.0.4` at `C:\Users\wenjunzh\AppData\Roaming\npm\node_modules`
- Bundled Chrome: `C:\Users\wenjunzh\.cache\puppeteer\chrome\win64-148.0.7778.167`
- Reference script: `D:\leon-web\temp\puppeteer-smoke.cjs` (workspace-only — not in this repo)

**Critical gotcha — CommonJS only.** Screenshot scripts must be `.cjs`, not `.mjs`. ES module `import` ignores `NODE_PATH`, so globally-installed packages can't be loaded from ESM. CommonJS `require()` honors `NODE_PATH`. Run pattern (PowerShell):

```powershell
$env:NODE_PATH = "C:\Users\wenjunzh\AppData\Roaming\npm\node_modules"
node screenshot.cjs http://localhost:4321 hero
```

- Read the port from the dev server's console output — Astro defaults to 4321, NOT 3000. Don't hardcode the wrong port.
- Screenshots auto-numbered into `D:\leon-web\temp\screenshot-N.png` (workspace-only, not committed).
- Optional label suffix: `node screenshot.cjs http://localhost:4321 hero` → `screenshot-N-hero.png`.
- After capture, read the PNG from `D:\leon-web\temp\` with the Read tool — Claude sees and analyzes the image directly.
- When comparing to a reference, be specific: "heading is 32px but reference shows ~24px", "card gap is 16px but should be 24px". Check: spacing/padding, font size/weight/line-height, colors (exact hex), alignment, border-radius, shadows, image sizing.

## Workspace-only files (NOT committed to this repo)
- Resume PDF at `D:\leon-web\Leon_Zhao_Resume.pdf` — do not copy into `public/` or expose on the public site.
- `D:\leon-web\deployment.md` — workspace-only cross-repo overview.
- `D:\leon-web\temp\*` — scratch, screenshots, smoke tests.
- `D:\leon-web\images\` — source for card images. Copy into `public/cards/` instead of referencing from outside the repo.
- `D:\leon-web\.venv\` — workspace-level Python venv (for `mlhub/` testing — irrelevant here).

This repo stays lean: only files needed for the Astro build/deploy.

## Quick gotchas reference
- **PowerShell may block `npx.ps1`** by default. One-time fix: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Microsoft's developer default; no admin rights needed.
- **Cloudflare dashboard hides Pages on new accounts**. Deep link to bypass: `https://dash.cloudflare.com/?to=/:account/pages/new/provider/github` (paste verbatim — don't replace `:account`, Cloudflare resolves it from the session).
- **Custom domains can only be removed via API**, not the dashboard. See `DEPLOYMENT.md` §Operational gotchas for the curl command.
- **Pages projects created via `wrangler pages deploy` cannot be retrofitted with Git integration**. The current setup uses GitHub Actions instead of native Git connect — see `DEPLOYMENT.md` §"Why GitHub Actions" for why.
