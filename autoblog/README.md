# DMP Autoblog (static-HTML build)

Daily B2B article generator for Dental Marketing Pros. It reads a 90-day content
calendar, drafts one publish-ready article a day with the Anthropic API, and writes
it straight into the site as a standalone `.html` page that matches the hand-built
articles (nav, mega menu, footer, canonical, BlogPosting + breadcrumb schema, cookie
banner). It also adds the article's card to `resources.html` and rebuilds
`sitemap.xml` + `robots.txt`.

This was adapted from the original MDX/Next.js version to fit this site, which is
**static HTML deployed via Vercel**.

## Files

- `scripts/generate.js` — the generator (no npm dependencies; Node 18+ built-in fetch)
- `calendar.json` — 90 article entries (`day`, `pillar`, `title`, `keyword`, `links`)
- `package.json` — `npm run generate`, `npm run test:day1`
- `../.github/workflows/daily-article.yml` — the daily GitHub Actions cron

## How it decides what to write

`day = (today − LAUNCH_DATE) + 1`, then it looks up that day in `calendar.json`.
Before launch, past day 90, or if the file already exists → it does nothing.

## Run it locally (the day-1 test)

From the **site root** (`dental-marketing-pros/`):

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # your key, not committed
node autoblog/scripts/generate.js        # writes today's article, or…
DAY_OVERRIDE=1 node autoblog/scripts/generate.js   # force day 1 for a test
```

It writes `<slug>.html` into the site root, updates `resources.html`, and rebuilds
`sitemap.xml` / `robots.txt`. Review the file, then deploy as usual
(`npx vercel@latest deploy --prod --yes`) — or commit and let Vercel's git
integration deploy it (see below).

Env vars: `ANTHROPIC_API_KEY` (required), `LAUNCH_DATE` (default `2026-07-01`),
`DAY_OVERRIDE`, `MODEL` (default `claude-sonnet-4-6`), `SITE_BASE`
(default `https://dentalmarketingpros.co.uk`), `SITE_ROOT` (default: the site root).

## Hands-off daily publishing (GitHub Actions)

The site currently deploys via the Vercel **CLI**. To let the daily job publish on
its own, switch the project to Vercel's **git integration** so a push to `main`
auto-deploys:

1. Make the site a git repo and push it to GitHub:
   `git init && git add -A && git commit -m "site" && git branch -M main`
   then create a repo and `git push -u origin main`.
2. In the Vercel project → **Settings → Git**, connect the GitHub repo. (CLI deploys
   keep working too; they're not mutually exclusive.)
3. In the GitHub repo, add:
   - **Secret** `ANTHROPIC_API_KEY` = your key (Settings → Secrets and variables → Actions).
   - **Variable** `LAUNCH_DATE` = e.g. `2026-07-01`.
   - **Variable** `AUTO_PUBLISH` — leave **unset** (or `false`) for review mode;
     set `true` only if you want articles to publish without review.

The workflow runs daily at 06:00 UTC. In review mode it opens a Pull Request (with a
Vercel preview) that you merge to publish; in auto mode it commits to `main` directly.

## Recommended: keep review mode on

90 AI-drafted articles in 90 days on a young domain is a real Google
"scaled content abuse" / quality risk. Keep `AUTO_PUBLISH` unset so every article is
human-reviewed before it goes live, and consider publishing a few good ones a week
rather than firing all 90. The generator never invents stats, testimonials, or
guaranteed-outcome claims (GDC/ASA), but a human gate is still the safe default.

## Cost

Sonnet 4.6 at ~$3 / $15 per 1M input/output tokens. At ~3,000–8,000 output tokens per
article that's roughly **5–10 pence each** — about £5–£10 for the full 90-day run.
