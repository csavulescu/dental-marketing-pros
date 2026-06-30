#!/usr/bin/env node
/**
 * generate.js — Dental Marketing Pros daily article generator (static-HTML build)
 *
 * Reads calendar.json, works out which "day" we're on (days since LAUNCH_DATE),
 * calls the Anthropic API to draft a publish-ready B2B article, then:
 *   1. writes a complete standalone <slug>.html into the SITE ROOT (matching the
 *      hand-built articles' format: nav, mega menu, footer, canonical, BlogPosting
 *      + BreadcrumbList JSON-LD, cookie/analytics script),
 *   2. inserts a card for it at the top of resources.html,
 *   3. regenerates sitemap.xml + robots.txt from the live .html files.
 *
 * No external npm dependencies — Node 18+ only (built-in fetch).
 *
 * Env vars:
 *   ANTHROPIC_API_KEY   (required) Anthropic API key (set as a GitHub secret)
 *   LAUNCH_DATE         (optional) ISO date the calendar's "day 1" maps to (default 2026-07-01)
 *   DAY_OVERRIDE        (optional) force a specific day number (testing/backfill)
 *   MODEL               (optional) model string (default claude-sonnet-4-6)
 *   SITE_ROOT           (optional) project root that holds the .html files
 *                       (default: two levels up from this script = the site dir)
 *   SITE_BASE           (optional) base URL for canonical + internal links
 *                       (default https://dentalmarketingpros.co.uk)
 */

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const LAUNCH_DATE = process.env.LAUNCH_DATE || "2026-07-01";
const SITE_BASE = (process.env.SITE_BASE || "https://dentalmarketingpros.co.uk").replace(/\/$/, "");

const AUTOBLOG_DIR = path.join(__dirname, "..");                 // autoblog/
const SITE_ROOT = process.env.SITE_ROOT || path.join(AUTOBLOG_DIR, ".."); // project root

if (!API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

// ---- helpers ----
function dayNumber() {
  if (process.env.DAY_OVERRIDE) return parseInt(process.env.DAY_OVERRIDE, 10);
  const launch = new Date(LAUNCH_DATE + "T00:00:00Z");
  const now = new Date();
  const msPerDay = 86400000;
  const diff = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - launch.getTime()) / msPerDay
  );
  return diff + 1; // day 1 == launch date
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[''""·.,?:()£&]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

// Escape for HTML text nodes
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Escape for double-quoted HTML attributes
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}
// Safe JSON-LD: prevent </script> from closing the block early
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function readMinutes(html) {
  const words = String(html).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round(words / 200));
}

// ---- prompt (asks for HTML body, not markdown) ----
function buildPrompt(article) {
  const links = article.links.map(l => `${SITE_BASE}${l}`).join(", ");
  return `You are a senior B2B content writer for Dental Marketing Pros, a UK dental marketing agency that serves dental practice owners across South Yorkshire and North Derbyshire. Your readers are DENTISTS and PRACTICE OWNERS researching how to grow their own practices — not patients.

Write a complete, publish-ready article.

TITLE: ${article.title}
PRIMARY KEYWORD (use naturally, do not stuff): ${article.keyword}
PILLAR: ${article.pillar}

STRICT REQUIREMENTS:
- 1,200–1,800 words of genuinely useful, specific, non-generic advice.
- Audience: UK dental practice owners. British spelling. Professional, plain, confident tone — never hypey.
- Structure: a strong intro that names the problem, then H2/H3 sections following problem → why it happens → the fix → how a specialist agency does it better. End with a soft consultation CTA (never hard-sell).
- Include these internal links naturally in the body, at least once each: ${links}. Also link to ${SITE_BASE}/contact.html in the closing CTA. Use ROOT-RELATIVE hrefs only (e.g. href="seo.html", href="contact.html") — strip the ${SITE_BASE}/ prefix when you write the anchor tags.
- COMPLIANCE: This is regulated by the UK GDC and ASA. Do NOT invent statistics, do NOT fabricate study citations, do NOT make guaranteed-outcome or misleading claims. If you reference a figure you are not certain of, phrase it qualitatively (e.g. "the majority of") rather than inventing a precise number. Never promise specific rankings, lead volumes, or revenue. Do NOT fabricate client names, testimonials, or case-study results.
- Do NOT include the title as an H1 (the template renders it). Start with an intro <p>.

BODY HTML RULES (bodyHtml field):
- Output valid HTML fragment only: use <h2>, <h3>, <p>, <ul>/<li>, <ol>/<li>, <strong>, <em>, and <a href="...">. No <h1>, no <html>/<head>/<body>, no inline styles, no class attributes, no markdown, no code fences.

OUTPUT FORMAT: Respond with ONLY a single valid JSON object, no markdown fences, no preamble. Schema:
{
  "metaTitle": "string, <60 chars, includes keyword",
  "metaDescription": "string, <155 chars, compelling, includes keyword",
  "excerpt": "string, 1-2 sentence summary for the blog listing card and page intro",
  "bodyHtml": "string, the full article body as an HTML fragment per the rules above. No H1.",
  "imageAlt": "string, descriptive alt text for a hero image",
  "ppcAngle": "string, one sentence: the single best ad-copy angle this article reveals"
}`;
}

async function callAnthropic(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${t}`);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("Anthropic refused this request (safety classifier). Skipping this article.");
  }
  const block = (data.content || []).find(b => b.type === "text");
  if (!block) throw new Error("No text block in Anthropic response: " + JSON.stringify(data).slice(0, 400));
  const clean = block.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(clean);
}

// strip a stray leading H1 / code fence the model may have added
function tidyBody(html) {
  let h = String(html).trim();
  h = h.replace(/^```(?:html)?/i, "").replace(/```$/, "").trim();
  h = h.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");
  return h;
}

// ---- the shared chrome (kept byte-identical to the hand-built articles) ----
const NAV = `<header>
  <div class="wrap">
    <nav>
      <a href="index.html" class="logo">
        <svg class="logo-mark" viewBox="0 0 40 40"><path d="M20 6c-5 0-7-2-11-2C5 4 3 7 3 12c0 8 3 15 5 19 1.5 3 4 3 5-1l2-7c.8-2.8 2.2-2.8 3 0l2 7c1 4 3.5 4 5 1 2-4 5-11 5-19 0-5-2-8-6-8-4 0-6 2-9 2z" fill="#0d7a7a"/></svg>
        <span class="logo-text">DENTAL<span>MARKETING PROS</span></span>
      </a>
      <div class="nav-menu">
        <div class="nav-links">
          <a href="index.html">Home</a>
          <a href="about.html">About Us</a>
          <div class="has-mega">
            <a href="services.html" class="mega-trigger">Services <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg></a>
            <div class="mega"><div class="mega-panel"><div class="mega-inner">
              <a class="mega-card" href="seo.html"><span class="mega-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"/><path d="m20 20-4-4"/></svg></span><span class="mega-tx"><b>SEO</b><small>Rank higher and win more local patients</small></span></a>
              <a class="mega-card" href="ppc.html"><span class="mega-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><circle cx="11" cy="11" r="3.5"/></svg></span><span class="mega-tx"><b>PPC / Google Ads</b><small>Instant, measurable patient enquiries</small></span></a>
              <a class="mega-card" href="web-design.html"><span class="mega-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span><span class="mega-tx"><b>Web Design</b><small>Conversion-focused dental websites</small></span></a>
              <a class="mega-card" href="locations.html"><span class="mega-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span><span class="mega-tx"><b>Locations</b><small>SEO, PPC &amp; web by town</small></span></a>
            </div><div class="mega-foot"><span>Specialist marketing, dentists only</span><a href="services.html" class="mega-all">All services →</a></div></div></div>
          </div>
          <a href="index.html#results">Results</a>
          <a href="locations.html">Locations</a>
          <a href="resources.html" class="active">Resources</a>
          <a href="contact.html">Contact</a>
        </div>
        <div class="nav-cta"><a href="contact.html" class="btn btn-primary">📅 Book a Free Strategy Call</a></div>
      </div>
      <button class="menu-btn" aria-label="Menu" aria-expanded="false">☰</button>
    </nav>
  </div>
</header>`;

const FOOTER = `<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <div class="logo"><svg class="logo-mark" viewBox="0 0 40 40"><path d="M20 6c-5 0-7-2-11-2C5 4 3 7 3 12c0 8 3 15 5 19 1.5 3 4 3 5-1l2-7c.8-2.8 2.2-2.8 3 0l2 7c1 4 3.5 4 5 1 2-4 5-11 5-19 0-5-2-8-6-8-4 0-6 2-9 2z" fill="#fff"/></svg><span class="logo-text">DENTAL<span style="color:#7fd4d4">MARKETING PROS</span></span></div>
        <p class="foot-about">Specialist dental marketing that attracts more patients, strengthens your reputation and grows your practice.</p>
        <p class="compliance-note">GDC &amp; ASA-compliant marketing. We keep your campaigns within advertising guidelines.</p>
      </div>
      <div><h5>Services</h5><ul><li><a href="seo.html">SEO</a></li><li><a href="ppc.html">PPC Advertising</a></li><li><a href="web-design.html">Web Design</a></li><li><a href="locations.html">Locations</a></li></ul></div>
      <div><h5>Locations</h5><ul><li><a href="dental-marketing-sheffield.html">Sheffield</a></li><li><a href="dental-marketing-doncaster.html">Doncaster</a></li><li><a href="dental-marketing-rotherham.html">Rotherham</a></li><li><a href="dental-marketing-barnsley.html">Barnsley</a></li><li><a href="dental-marketing-chesterfield.html">Chesterfield</a></li></ul></div>
      <div><h5>Company</h5><ul><li><a href="about.html">About Us</a></li><li><a href="resources.html">Resources</a></li><li><a href="contact.html">Contact</a></li></ul></div>
      <div><h5>Contact Us</h5><ul><li>📞 <a href="tel:01302616311">01302 616311</a></li><li>✉ hello@dentalmarketingpros.co.uk</li></ul></div>
    </div>
    <div class="foot-bottom">
      <span>© 2026 Dental Marketing Pros, a trading name of Elite Talent Media LTD. All rights reserved.</span>
      <span><a href="privacy.html">Privacy Policy</a> &nbsp;·&nbsp; <a href="terms.html">Terms &amp; Conditions</a> &nbsp;·&nbsp; <a href="cookies.html">Cookie Policy</a> &nbsp;·&nbsp; <a href="#" onclick="window.openCookieSettings&&window.openCookieSettings();return false;">Cookie settings</a></span>
    </div>
  </div>
</footer>
<script>
  (function(){var btn=document.querySelector('.menu-btn'),nav=document.querySelector('nav');if(!btn||!nav)return;btn.addEventListener('click',function(){var o=nav.classList.toggle('open');btn.setAttribute('aria-expanded',o?'true':'false');btn.textContent=o?'\\u2715':'\\u2630';});nav.querySelectorAll('.nav-links a, .nav-cta a').forEach(function(l){l.addEventListener('click',function(){nav.classList.remove('open');btn.textContent='\\u2630';});});})();
</script>
<script defer src="cookies.js"></script>`;

function renderPage(article, gen, dateISO, slug) {
  const url = `${SITE_BASE}/${slug}.html`;
  const mins = readMinutes(gen.bodyHtml);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "headline": article.title,
        "description": gen.metaDescription,
        "datePublished": dateISO,
        "dateModified": dateISO,
        "author": { "@type": "Organization", "name": "Dental Marketing Pros" },
        "publisher": { "@type": "Organization", "name": "Dental Marketing Pros", "legalName": "Elite Talent Media LTD" },
        "mainEntityOfPage": url,
        "url": url
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_BASE + "/" },
          { "@type": "ListItem", "position": 2, "name": "Resources", "item": SITE_BASE + "/resources.html" },
          { "@type": "ListItem", "position": 3, "name": article.title, "item": url }
        ]
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(gen.metaTitle)} | Dental Marketing Pros</title>
<meta name="description" content="${escAttr(gen.metaDescription)}">
<link rel="canonical" href="${url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
<script type="application/ld+json">${jsonLd(ld)}</script>
</head>
<body>
${NAV}
<div class="page-hero"><div class="wrap">
  <div class="crumb"><a href="index.html">Home</a> / <a href="resources.html">Resources</a> / ${esc(article.title)}</div>
  <span class="eyebrow" style="margin-top:14px;display:block">Resources · ${mins} min read</span>
  <h1 style="margin-top:8px">${esc(article.title)}</h1>
  <p>${esc(gen.excerpt)}</p>
</div></div>
<div class="wrap"><section><div class="narrow prose">

${tidyBody(gen.bodyHtml)}

</div></section></div>
<div class="wrap"><div class="cta-band">
    <div><span class="eyebrow">Want help putting this into practice?</span><h2>Book a free, no-obligation strategy call.</h2></div>
    <div class="cb-right"><a href="contact.html" class="btn btn-white">📅 Book a Free Call</a><small>Dentists only. Honest advice.</small></div>
    <div class="ghost-tooth">🦷</div>
  </div></div>
${FOOTER}
</body>
</html>
`;
}

// card SVG matches the existing resources.html cards
const CARD_IC = `<div class="ic"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>`;

function insertResourceCard(article, gen, slug) {
  const file = path.join(SITE_ROOT, "resources.html");
  let html = fs.readFileSync(file, "utf8");
  if (html.includes(`href="${slug}.html"`)) {
    console.log("  resources.html already lists this article — not re-inserting.");
    return;
  }
  const card =
`        <a class="card" href="${slug}.html" style="display:block">
          ${CARD_IC}
          <h3>${esc(article.title)}</h3>
          <p>${esc(gen.excerpt)}</p>
          <span class="more" style="color:var(--teal);font-weight:600">Read article →</span>
        </a>\n`;
  const marker = `<div class="cards">\n`;
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error('Could not find `<div class="cards">` in resources.html');
  const at = idx + marker.length;
  html = html.slice(0, at) + card + html.slice(at);
  fs.writeFileSync(file, html, "utf8");
  console.log("  ✓ Added card to resources.html (newest first).");
}

function rebuildSitemap() {
  const BASE = SITE_BASE;
  const SKIP = ["thank-you.html"];
  const files = fs.readdirSync(SITE_ROOT).filter(f => f.endsWith(".html") && !SKIP.includes(f));
  const meta = (f) => {
    if (f === "index.html") return { loc: BASE + "/", p: "1.0" };
    let p = "0.6";
    if (["seo.html", "ppc.html", "web-design.html", "locations.html"].includes(f)) p = "0.9";
    else if (["services.html", "about.html", "contact.html"].includes(f)) p = "0.8";
    else if (["privacy.html", "terms.html", "cookies.html"].includes(f)) p = "0.3";
    else if (f.startsWith("dental-marketing-")) p = "0.8";
    else if (f.startsWith("dental-")) p = "0.7";
    return { loc: BASE + "/" + f, p };
  };
  const entries = files.map(f => {
    const st = fs.statSync(path.join(SITE_ROOT, f));
    const { loc, p } = meta(f);
    return { f, loc, p, lastmod: st.mtime.toISOString().slice(0, 10) };
  });
  entries.sort((a, b) => a.f === "index.html" ? -1 : b.f === "index.html" ? 1 : a.loc.localeCompare(b.loc));
  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e =>
`  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${e.p}</priority>
  </url>`).join("\n")}
</urlset>
`;
  fs.writeFileSync(path.join(SITE_ROOT, "sitemap.xml"), xml);
  const robots =
`# robots.txt for Dental Marketing Pros
User-agent: *
Allow: /

# Block nothing of value to search engines
Disallow: /.vercel/

Sitemap: ${BASE}/sitemap.xml
`;
  fs.writeFileSync(path.join(SITE_ROOT, "robots.txt"), robots);
  console.log(`  ✓ Rebuilt sitemap.xml (${entries.length} URLs) and robots.txt.`);
}

(async () => {
  const calendar = JSON.parse(fs.readFileSync(path.join(AUTOBLOG_DIR, "calendar.json"), "utf8"));
  const day = dayNumber();

  if (day < 1) { console.log(`Day ${day} is before launch (${LAUNCH_DATE}). Nothing to do.`); return; }
  const article = calendar.articles.find(a => a.day === day);
  if (!article) { console.log(`No calendar entry for day ${day} (calendar ends at day ${calendar.articles.length}). Nothing to do.`); return; }

  const slug = slugify(article.title);
  const outPath = path.join(SITE_ROOT, `${slug}.html`);
  if (fs.existsSync(outPath)) { console.log(`Already exists: ${slug}.html. Skipping.`); return; }

  console.log(`Day ${day}: generating "${article.title}" (${MODEL})…`);
  const gen = await callAnthropic(buildPrompt(article));

  const dateISO = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(outPath, renderPage(article, gen, dateISO, slug), "utf8");
  console.log(`✓ Wrote ${slug}.html`);

  insertResourceCard(article, gen, slug);
  rebuildSitemap();

  console.log(`  PPC angle: ${gen.ppcAngle}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `article_path=${slug}.html\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `article_title=${article.title.replace(/\n/g, " ")}\n`);
  }
})().catch(e => { console.error(e); process.exit(1); });
