#!/usr/bin/env node
/**
 * seo-maintain.js — sitewide on-page SEO pass for the static site.
 *
 * Idempotent: safe to run on every build / every daily article. A second run
 * with no new content produces no diff. Everything it injects sits between
 * <!-- dmp:NAME:start --> / <!-- dmp:NAME:end --> markers so it can be
 * replaced cleanly next time.
 *
 * What it does, per page:
 *   1. Home links: href="index.html" -> href="/" (index.html 301s to / via vercel.json)
 *   2. <title> + meta description: overrides from autoblog/seo-overrides.json,
 *      otherwise drops the " | Dental Marketing Pros" suffix when the title
 *      would run past 60 characters.
 *   3. Open Graph + Twitter card tags.
 *   4. Articles: named author (Person) in BlogPosting JSON-LD, visible byline,
 *      author box, and a "Related guides" block of the 4 closest articles
 *      (with a guarantee that no article is left without a related link).
 *   5. Service / town / hub pages: a "Guides" block linking into the articles;
 *      homepage: the 3 latest articles.
 *   6. One-off content additions from content-migrations.js (run once each).
 *   7. Sitewide menu: canonical Services mega menu, "Free SEO Audit" nav link,
 *      audit CTAs pointed at free-seo-audit.html, new-services blocks.
 * Before all that it publishes due managed pages (build-pages.js, max 3 new a day);
 * afterwards it rebuilds resources.html, sitemap.xml and llms.txt.
 *
 * Usage:  node autoblog/scripts/seo-maintain.js [SITE_ROOT]
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const rebuildResources = require("./rebuild-resources");
const applyContentMigrations = require("./content-migrations");
const { buildPages, megaInner } = require("./build-pages");

const SITE_ROOT = process.env.SITE_ROOT || (require.main === module && process.argv[2]) || path.join(__dirname, "..", "..");
const AUTOBLOG_DIR = path.join(__dirname, "..");
const BASE = (process.env.SITE_BASE || "https://dentalmarketingpros.co.uk").replace(/\/$/, "");
const BRAND = "Dental Marketing Pros";
const SUFFIX = " | " + BRAND;
const OG_IMAGE = BASE + "/hero.jpg";
const MAINT_COMMIT_PREFIX = "chore(seo-maintain)";

const AUTHOR = {
  name: "Cristian Savulescu",
  jobTitle: "Founder",
  anchor: "cristian-savulescu",
  bio: "Cristian Savulescu is the founder of Dental Marketing Pros and an SEO and Google Ads specialist with over 10 years' experience. He has worked with many different types of businesses, including some Fortune 500 companies, and now leads SEO and Google Ads strategy for dental practices across South Yorkshire and North Derbyshire."
};
const AUTHOR_URL = `${BASE}/about.html#${AUTHOR.anchor}`;

const NON_INDEX = ["thank-you.html"];
const SITEMAP_SKIP = ["thank-you.html", "cookies.html", "privacy.html", "terms.html"];
const TOWNS_SY = ["sheffield", "doncaster", "rotherham", "barnsley", "chesterfield"];
const TOWNS_EXP = ["wakefield", "leeds", "huddersfield", "worksop", "mansfield", "dewsbury", "pontefract", "wetherby", "nottingham"];

// ---------- small helpers ----------
const decode = s => String(s)
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => esc(s).replace(/"/g, "&quot;");
const jsonLd = obj => JSON.stringify(obj).replace(/</g, "\\u003c");

function block(name, inner) {
  return `<!-- dmp:${name}:start -->\n${inner}\n<!-- dmp:${name}:end -->`;
}
function stripBlock(html, name) {
  const re = new RegExp(`\\n?<!-- dmp:${name}:start -->[\\s\\S]*?<!-- dmp:${name}:end -->`, "g");
  return html.replace(re, "");
}

function fmtDate(iso) {
  const d = new Date(iso + "T12:00:00Z");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[''""·.,?:()£&]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function ldBlocks(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let data = null;
    try { data = JSON.parse(m[1]); } catch { /* leave invalid blocks alone */ }
    out.push({ full: m[0], data, index: m.index });
  }
  return out;
}
function findBlogPosting(html) {
  for (const b of ldBlocks(html)) {
    if (!b.data) continue;
    const nodes = b.data["@graph"] ? b.data["@graph"] : [b.data];
    const bp = nodes.find(n => n && n["@type"] === "BlogPosting");
    if (bp) return { block: b, bp };
  }
  return null;
}

// ---------- tokenising for "related" ----------
const STOP = new Set(("a an and are as at be by can do does for from get how in into is it its of on or our "
  + "the their them they this to what when where which who why will with without you your yours "
  + "dental dentist dentists practice practices uk guide marketing").split(" "));
function tokens(s) {
  return decode(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .map(w => w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"));
}

// ---------- load site ----------
function loadSite() {
  const files = fs.readdirSync(SITE_ROOT).filter(f => f.endsWith(".html")).sort();
  const cal = JSON.parse(fs.readFileSync(path.join(AUTOBLOG_DIR, "calendar.json"), "utf8"));
  const calBySlug = {};
  for (const a of cal.articles) calBySlug[slugify(a.title) + ".html"] = a;
  const HAND_PILLAR = {
    "how-to-get-more-patients-dental-practice.html": "Money",
    "nhs-to-private-dental-practice-conversion.html": "Money",
    "is-google-ads-worth-it-for-dentists.html": "PPC",
    "dental-seo-how-to-rank-google-map-pack.html": "SEO"
  };
  const pages = {};
  const articles = [];
  for (const f of files) {
    const html = fs.readFileSync(path.join(SITE_ROOT, f), "utf8");
    const found = findBlogPosting(html);
    const page = { file: f, html, orig: html, isArticle: !!found };
    if (found) {
      const c = calBySlug[f];
      page.headline = found.bp.headline || "";
      page.description = found.bp.description || "";
      page.datePublished = found.bp.datePublished || "";
      page.dateModified = found.bp.dateModified || page.datePublished;
      page.pillar = c ? c.pillar : (HAND_PILLAR[f] || "SEO");
      page.day = c ? c.day : 0;
      page.keyword = c ? c.keyword : "";
      page.town = [...TOWNS_EXP, ...TOWNS_SY].find(t => f.includes(t)) || null;
      page.tok = new Set([...tokens(page.headline), ...tokens(page.keyword), ...tokens(page.headline)]);
      page.tokDesc = new Set(tokens(page.description));
      articles.push(page);
    }
    pages[f] = page;
  }
  return { pages, articles };
}

// ---------- scoring ----------
function similarity(a, b) {
  let inter = 0;
  for (const t of a.tok) if (b.tok.has(t)) inter++;
  let interD = 0;
  for (const t of a.tokDesc) if (b.tokDesc.has(t)) interD++;
  let s = inter / Math.sqrt(a.tok.size * b.tok.size || 1) + 0.25 * interD / Math.sqrt(a.tokDesc.size * b.tokDesc.size || 1);
  if (a.pillar === b.pillar) s += 0.2;
  if (a.town && b.town) s += a.town === b.town ? 0.5 : -0.2;
  else if (a.town || b.town) s -= 0.15;
  return s;
}
function relatedFor(a, articles, n) {
  return articles
    .filter(b => b.file !== a.file)
    .map(b => ({ b, s: similarity(a, b) }))
    .sort((x, y) => y.s - x.s || x.b.file.localeCompare(y.b.file))
    .slice(0, n).map(x => x.b);
}

// stable "foundational first" ordering for hub blocks
const byDay = (x, y) => (x.day || 0) - (y.day || 0) || x.file.localeCompare(y.file);

function pickForPage(file, articles) {
  const P = p => articles.filter(a => a.pillar === p && !a.town).sort(byDay);
  const townArts = t => articles.filter(a => a.town === t).sort(byDay);
  const has = (...keys) => a => keys.some(k => a.file.includes(k));
  const uniq = arr => [...new Map(arr.map(a => [a.file, a])).values()];

  if (file === "seo.html") return { title: "Dental SEO guides", list: P("SEO").slice(0, 6) };
  if (file === "ppc.html") return { title: "Google Ads guides for dentists", list: P("PPC").slice(0, 6) };
  if (file === "web-design.html") return { title: "Dental website guides", list: P("Web").slice(0, 6) };
  if (file === "services.html") return { title: "Guides from our resources", list: uniq([...P("Money").slice(0, 3), ...P("Compliance").slice(0, 3)]) };
  if (file === "about.html") return { title: "Compliance guides we've written", list: P("Compliance").slice(0, 3) };
  if (file === "geo.html") return { title: "GEO & AI search guides", list: P("GEO").slice(0, 6) };
  if (file === "ai-websites.html") return { title: "Dental website guides", list: P("Web").slice(0, 3) };
  if (file === "free-seo-audit.html") return null;
  const g = file.match(/^dental-geo-([a-z]+)\.html$/);
  if (g) return { title: "GEO & AI search guides", list: P("GEO").slice(0, 3) };
  if (file === "locations.html") {
    const list = uniq(TOWNS_EXP.flatMap(t => townArts(t)));
    return { title: "Local market guides beyond South Yorkshire", list: list.slice(0, 12) };
  }
  let m = file.match(/^dental-(seo|ppc|web-design)-([a-z]+)\.html$/);
  if (m && TOWNS_SY.includes(m[2])) {
    const pillar = { seo: "SEO", ppc: "PPC", "web-design": "Web" }[m[1]];
    const local = articles.filter(has("local-seo", "map-pack", "google-business-profile", "geo-targeting", "multi-location")).sort(byDay);
    const list = uniq([...P(pillar).slice(0, 2), ...local.filter(a => a.pillar === pillar || pillar === "SEO").slice(0, 1), ...P(pillar).slice(2, 3)]).slice(0, 3);
    return { title: "Guides for local practices", list };
  }
  m = file.match(/^dental-marketing-([a-z]+)\.html$/);
  if (m && TOWNS_SY.includes(m[1])) {
    const picks = articles.filter(has(
      "how-to-get-more-patients", "local-seo-for-dentists", "dental-seo-how-to-rank-google-map-pack",
      "google-business-profile-optimisation", "how-much-do-google-ads-cost", "gdc-asa-compliant"
    )).sort(byDay);
    return { title: "Guides for practice owners", list: picks.slice(0, 6) };
  }
  return null;
}

// ---------- HTML fragments ----------
const CARD_IC = `<div class="ic"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>`;
// related lists for every article: 3 closest + a 4th slot that guarantees no
// article is left without a related-link from another article.
function buildRelatedMap(articles) {
  const map = {};
  for (const a of articles) map[a.file] = relatedFor(a, articles, 3);
  const inbound = {};
  for (const a of articles) inbound[a.file] = 0;
  for (const list of Object.values(map)) for (const b of list) inbound[b.file]++;
  const orphans = articles.filter(a => inbound[a.file] === 0).sort((x, y) => x.file.localeCompare(y.file));
  for (const z of orphans) {
    const host = articles
      .filter(a => a.file !== z.file && map[a.file].length < 4 && !map[a.file].includes(z))
      .map(a => ({ a, s: similarity(z, a) }))
      .sort((x, y) => y.s - x.s || x.a.file.localeCompare(y.a.file))[0];
    if (host) { map[host.a.file].push(z); inbound[z.file]++; }
  }
  for (const a of articles) {
    if (map[a.file].length < 4) {
      const next = relatedFor(a, articles, 10).find(b => !map[a.file].includes(b));
      if (next) map[a.file].push(next);
    }
  }
  return map;
}

function cardsSection(eyebrow, title, list, extraLink, gridClass) {
  const cards = list.map(a =>
`      <a class="card" href="${a.file}" style="display:block">
        ${CARD_IC}
        <h3>${esc(decode(a.headline))}</h3>
        <p>${esc(decode(a.description))}</p>
        <span class="more">Read the guide →</span>
      </a>`).join("\n");
  const more = extraLink ? `\n    <p style="text-align:center;margin-top:28px"><a href="resources.html" class="btn btn-ghost">${extraLink}</a></p>` : "";
  return `<div class="wrap"><section>
    <div class="sec-head"><span class="eyebrow">${eyebrow}</span><h2>${esc(title)}</h2></div>
    <div class="${gridClass || "cards"}">
${cards}
    </div>${more}
  </section></div>`;
}

function authorBox() {
  return `<div class="author-box" style="display:flex;gap:16px;align-items:flex-start;margin-top:40px;padding:22px 24px;border:1px solid var(--line);border-radius:var(--radius);background:var(--mist)">
  <div style="flex:0 0 48px;width:48px;height:48px;border-radius:50%;background:var(--mist2);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--teal)">CS</div>
  <div><p style="margin:0 0 4px;color:var(--ink)"><strong>About the author: <a href="about.html#${AUTHOR.anchor}">${AUTHOR.name}</a></strong>, ${AUTHOR.jobTitle}, ${BRAND}</p>
  <p style="margin:0;font-size:.92rem">${esc(AUTHOR.bio)}</p></div>
</div>`;
}

function byline(a) {
  const pub = a.datePublished ? `Published ${fmtDate(a.datePublished)}` : "";
  const upd = a.dateModified && a.dateModified !== a.datePublished ? ` · Updated ${fmtDate(a.dateModified)}` : "";
  return `<p class="byline" style="margin:10px 0 14px;font-size:.9rem;color:var(--slate)">By <a href="about.html#${AUTHOR.anchor}">${AUTHOR.name}</a>, ${AUTHOR.jobTitle} · ${pub}${upd}</p>`;
}

// ---------- sitewide menu + service promotion ----------
function normaliseNav(page) {
  if (page.html.includes("<!-- dmp:managed-page")) return; // rendered by build-pages.js
  let html = page.html;
  html = html.replace(/(<div class="mega-inner">)[\s\S]*?(<\/div>\s*<div class="mega-foot">)/, (m, a, b) => `${a}\n${megaInner("  ")}\n${b}`);
  html = html.split('<a href="/#results">Results</a>').join('<a href="free-seo-audit.html">Free SEO Audit</a>');
  html = html.split('<a href="dental-seo-sheffield.html">Location SEO</a>').join('<a href="geo.html">GEO &amp; AI Search</a>');
  html = html.replace(/<a href="contact\.html"( class="btn[^"]*"[^>]*)>([^<]*[Aa]udit[^<]*)<\/a>/g, '<a href="free-seo-audit.html"$1>$2</a>');
  if (page.file === "contact.html" && !html.includes("<option>AI website</option>")) {
    html = html.replace("<option>Web Design</option>", () => "<option>Web Design</option>\n              <option>GEO / AI search</option>\n              <option>AI website</option>\n              <option>Free SEO audit</option>");
  }
  page.html = html;
}

const NEW_SERVICES = [
  ["geo.html", "GEO &amp; AI search", "Get your practice recommended when patients ask ChatGPT, Google AI Overviews and other AI assistants for a dentist. From £450/month.", "Explore GEO"],
  ["ai-websites.html", "AI websites", "A managed, professional practice website with no upfront cost. £50/month, with hosting, domain, SSL and content changes included.", "See AI websites"],
  ["free-seo-audit.html", "Free SEO audit", "Send us your website and we'll put together an overview audit with clear, actionable advice. Free, no obligation.", "Get your free audit"]
];
function newServicesBlock() {
  const cards = NEW_SERVICES.map(([href, h, p, more]) =>
`      <a class="card" href="${href}" style="display:block">
        ${CARD_IC}
        <h3>${h}</h3>
        <p>${p}</p>
        <span class="more">${more} →</span>
      </a>`).join("\n");
  return block("newservices", `<div class="wrap"><section>
    <div class="sec-head"><span class="eyebrow">New from Dental Marketing Pros</span><h2>AI search, AI websites and a free audit</h2></div>
    <div class="cards">
${cards}
    </div>
  </section></div>`);
}
function setNewServices(page) {
  const marker = { "index.html": "<!-- RESULTS -->", "services.html": "<!-- SECONDARY SERVICES GRID -->" }[page.file];
  if (!marker) return;
  let html = stripBlock(page.html, "newservices");
  if (html.includes(marker)) html = html.replace(marker, () => newServicesBlock() + "\n" + marker);
  page.html = html;
}
function setAiWebsiteCrossLink(page) {
  const m = page.file.match(/^dental-web-design-([a-z]+)\.html$/);
  if (!m || !TOWNS_SY.includes(m[1])) return;
  const town = m[1][0].toUpperCase() + m[1].slice(1);
  let html = stripBlock(page.html, "aisites");
  const inner = `<div class="wrap"><section style="padding-top:0">
    <div class="panel" style="display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between">
      <div style="max-width:640px"><span class="eyebrow">Prefer no upfront cost?</span>
      <h3 style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;margin:8px 0 8px">AI websites for ${town} practices, £50/month</h3>
      <p style="color:var(--slate);margin:0">A managed presentation or lead-generation website built with AI to your brief. No upfront cost, with hosting, domain, SSL, backups and content changes included.</p></div>
      <a href="ai-websites.html" class="btn btn-primary">See AI websites</a>
    </div>
  </section></div>`;
  html = insertBeforeCta(html, block("aisites", inner));
  page.html = html;
}

function writeLlmsTxt(pages, articles) {
  const line = (f, name, desc) => `- [${name}](${BASE}/${f === "index.html" ? "" : f}): ${desc}`;
  const titleOf = f => decode((pages[f] && pages[f].title) || f).replace(/ \| Dental Marketing Pros$/, "");
  const core = ["index.html", "seo.html", "ppc.html", "web-design.html", "geo.html", "ai-websites.html", "free-seo-audit.html", "services.html", "locations.html", "about.html", "contact.html"]
    .filter(f => pages[f]).map(f => line(f, titleOf(f), pages[f].metaDescription || ""));
  const towns = Object.keys(pages).filter(f => /^dental-(marketing|seo|ppc|web-design|geo)-[a-z]+\.html$/.test(f) && !pages[f].isArticle).sort()
    .map(f => line(f, titleOf(f), pages[f].metaDescription || ""));
  const guides = [...articles].sort((a, b) => (b.datePublished || "").localeCompare(a.datePublished || "") || a.file.localeCompare(b.file))
    .map(a => line(a.file, decode(a.headline), decode(a.description)));
  const txt = `# Dental Marketing Pros

> Specialist dental marketing agency (a trading name of Elite Talent Media LTD) based in South Yorkshire, UK. We work only with dental practices, offering dental SEO, Google Ads (PPC), web design, GEO / AI search optimisation, managed AI websites and a free SEO audit, with GDC and ASA advertising compliance built in. Contact: hello@dentalmarketingpros.co.uk, 01302 616311.

## Services
${core.join("\n")}

## Locations
${towns.join("\n")}

## Guides
${guides.join("\n")}
`;
  const f = path.join(SITE_ROOT, "llms.txt");
  if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== txt) fs.writeFileSync(f, txt);
}

// ---------- per-page transforms ----------
function fixHomeLinks(html) {
  return html.replace(/href="index\.html#/g, 'href="/#').replace(/href="index\.html"/g, 'href="/"');
}

function fixTitleAndDescription(page, overrides) {
  let html = page.html;
  const ov = overrides[page.file] || {};
  const tm = html.match(/<title>([\s\S]*?)<\/title>/);
  if (tm) {
    let t = decode(tm[1].trim());
    if (ov.title) t = ov.title;
    else if (t.length > 60 && t.endsWith(SUFFIX)) t = t.slice(0, -SUFFIX.length);
    html = html.replace(tm[0], () => `<title>${esc(t)}</title>`);
    page.title = t;
  }
  if (ov.description) {
    html = html.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escAttr(ov.description)}">`);
  }
  const dm = html.match(/<meta name="description" content="([^"]*)">/);
  page.metaDescription = dm ? decode(dm[1]) : "";
  page.html = html;
}

function canonicalOf(page) {
  const m = page.html.match(/<link rel="canonical" href="([^"]+)"/);
  if (m) return m[1];
  return page.file === "index.html" ? BASE + "/" : `${BASE}/${page.file}`;
}

function setOpenGraph(page) {
  let html = stripBlock(page.html, "og");
  const title = page.title || BRAND;
  const url = canonicalOf(page);
  const tags = [
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:type" content="${page.isArticle ? "article" : "website"}">`,
    `<meta property="og:title" content="${escAttr(title)}">`,
    `<meta property="og:description" content="${escAttr(page.metaDescription || "")}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta property="og:image:width" content="1600">`,
    `<meta property="og:image:height" content="752">`,
    `<meta property="og:image:alt" content="Dental Marketing Pros, specialist marketing for dental practices">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escAttr(title)}">`,
    `<meta name="twitter:description" content="${escAttr(page.metaDescription || "")}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`
  ];
  if (page.isArticle && page.datePublished) {
    tags.push(`<meta property="article:published_time" content="${page.datePublished}">`);
    if (page.dateModified) tags.push(`<meta property="article:modified_time" content="${page.dateModified}">`);
    tags.push(`<meta property="article:author" content="${AUTHOR_URL}">`);
  }
  const og = block("og", tags.join("\n"));
  // place right after canonical (or after description / before </head>)
  const anchor = html.match(/<link rel="canonical"[^>]*>/) || html.match(/<meta name="description"[^>]*>/);
  if (anchor) html = html.replace(anchor[0], () => anchor[0] + "\n" + og);
  else html = html.replace("</head>", () => og + "\n</head>");
  page.html = html;
}

function setArticleSchemaAuthor(page) {
  const found = findBlogPosting(page.html);
  if (!found) return;
  const { block: b, bp } = found;
  bp.author = {
    "@type": "Person",
    "@id": AUTHOR_URL,
    "name": AUTHOR.name,
    "jobTitle": AUTHOR.jobTitle,
    "url": AUTHOR_URL,
    "worksFor": { "@type": "Organization", "name": BRAND, "url": BASE + "/" }
  };
  bp.image = OG_IMAGE;
  if (bp.publisher && typeof bp.publisher === "object") {
    bp.publisher.url = BASE + "/";
    bp.publisher.logo = { "@type": "ImageObject", "url": BASE + "/favicon.svg" };
  }
  const replacement = `<script type="application/ld+json">${jsonLd(b.data)}</script>`;
  page.html = page.html.replace(b.full, () => replacement);
}

function setByline(page) {
  let html = stripBlock(page.html, "byline");
  const h1 = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/);
  if (h1) html = html.replace(h1[0], () => h1[0] + "\n" + block("byline", byline(page)));
  page.html = html;
}

const CTA_RE = /(\n?(?:<!--[^>]*-->\s*)?<div class="wrap">\s*<div class="cta-band")/;

function insertBeforeCta(html, content) {
  const m = html.match(CTA_RE);
  if (m) return html.replace(CTA_RE, () => "\n" + content + m[1]);
  return html.replace(/<footer/, () => content + "\n<footer");
}

function setAuthorBoxAndRelated(page, relatedMap) {
  let html = stripBlock(page.html, "authorbox");
  html = stripBlock(html, "related");
  // author box: end of the article prose
  const proseEnd = html.match(/(<div class="narrow prose">[\s\S]*?)(\s*<\/div><\/section><\/div>)/);
  if (proseEnd) html = html.replace(proseEnd[0], () => proseEnd[1] + "\n" + block("authorbox", authorBox()) + proseEnd[2]);
  const rel = relatedMap[page.file] || [];
  html = insertBeforeCta(html, block("related", cardsSection("Keep reading", "Related guides", rel, null, "cards two")));
  page.html = html;
}

function setGuidesBlock(page, articles) {
  let html = stripBlock(page.html, "guides");
  const pick = pickForPage(page.file, articles);
  if (pick && pick.list.length) {
    html = insertBeforeCta(html, block("guides", cardsSection("From our resources", pick.title, pick.list, "Browse all guides")));
  }
  page.html = html;
}

function setHomeLatest(page, articles) {
  let html = stripBlock(page.html, "latest");
  const latest = [...articles].sort((x, y) =>
    (y.datePublished || "").localeCompare(x.datePublished || "") || x.file.localeCompare(y.file)).slice(0, 3);
  html = insertBeforeCta(html, block("latest", cardsSection("Latest guides", "Fresh advice for practice owners", latest, "Browse all guides")));
  page.html = html;
}

function setNoindex(page) {
  if (!NON_INDEX.includes(page.file)) return;
  if (!/<meta name="robots"/.test(page.html)) {
    page.html = page.html.replace(/<meta name="viewport"[^>]*>/, m => m + '\n<meta name="robots" content="noindex, follow">');
  }
}

// ---------- sitemap with honest lastmod ----------
let SHALLOW = null;
function isShallow() {
  if (SHALLOW === null) {
    try {
      SHALLOW = execFileSync("git", ["rev-parse", "--is-shallow-repository"],
        { cwd: SITE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "false";
    } catch { SHALLOW = true; }
  }
  return SHALLOW;
}
function gitDate(file) {
  if (isShallow()) return null; // shallow clone: git dates are meaningless
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--invert-grep", `--grep=^${MAINT_COMMIT_PREFIX.replace(/[()]/g, "\\$&")}`, "--", file],
      { cwd: SITE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out || null;
  } catch { return null; }
}
function rebuildSitemap(pages) {
  const today = new Date().toISOString().slice(0, 10);
  const prio = f => {
    if (f === "index.html") return "1.0";
    if (["seo.html", "ppc.html", "web-design.html", "locations.html", "geo.html", "ai-websites.html", "free-seo-audit.html"].includes(f)) return "0.9";
    if (["services.html", "about.html", "contact.html"].includes(f)) return "0.8";
    if (f.startsWith("dental-marketing-") && !pages[f].isArticle) return "0.8";
    if (/^dental-(seo|ppc|web-design|geo)-[a-z]+\.html$/.test(f) && !pages[f].isArticle) return "0.7";
    return "0.6";
  };
  // previous lastmods, used when git history is unavailable (shallow checkout)
  const prevMap = {};
  const smFile = path.join(SITE_ROOT, "sitemap.xml");
  if (fs.existsSync(smFile)) {
    const re = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
    let m; const x = fs.readFileSync(smFile, "utf8");
    while ((m = re.exec(x))) prevMap[m[1]] = m[2];
  }
  const entries = Object.values(pages)
    .filter(p => !SITEMAP_SKIP.includes(p.file))
    .map(p => {
      const locKey = p.file === "index.html" ? BASE + "/" : `${BASE}/${p.file}`;
      const fallback = (p.html === p.orig && prevMap[locKey]) || today;
      const lastmod = p.isArticle ? (p.dateModified || p.datePublished) : (gitDate(p.file) || fallback);
      const loc = p.file === "index.html" ? BASE + "/" : `${BASE}/${p.file}`;
      return { f: p.file, loc, lastmod: (lastmod || today).slice(0, 10), p: prio(p.file) };
    })
    .sort((a, b) => a.f === "index.html" ? -1 : b.f === "index.html" ? 1 : a.loc.localeCompare(b.loc));
  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e =>
`  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <priority>${e.p}</priority>
  </url>`).join("\n")}
</urlset>
`;
  const file = path.join(SITE_ROOT, "sitemap.xml");
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (prev !== xml) fs.writeFileSync(file, xml);
  const robots =
`# robots.txt for Dental Marketing Pros
User-agent: *
Allow: /

Disallow: /.vercel/

Sitemap: ${BASE}/sitemap.xml
`;
  const rf = path.join(SITE_ROOT, "robots.txt");
  if (!fs.existsSync(rf) || fs.readFileSync(rf, "utf8") !== robots) fs.writeFileSync(rf, robots);
  return entries.length;
}

// ---------- main ----------
function main() {
  const overridesPath = path.join(AUTOBLOG_DIR, "seo-overrides.json");
  const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, "utf8")).pages || {} : {};
  const built = buildPages(SITE_ROOT);
  if (built.published.length) console.log(`  ✓ published: ${built.published.join(", ")}`);
  if (built.waiting.length) console.log(`  · queued: ${built.waiting.join(", ")}`);
  const { pages, articles } = loadSite();
  const relatedMap = buildRelatedMap(articles);

  for (const page of Object.values(pages)) {
    page.html = applyContentMigrations(page.file, page.html);
    page.html = fixHomeLinks(page.html);
    normaliseNav(page);
    fixTitleAndDescription(page, overrides);
    setOpenGraph(page);
    setNoindex(page);
    if (page.isArticle) {
      setArticleSchemaAuthor(page);
      setByline(page);
      setAuthorBoxAndRelated(page, relatedMap);
    } else if (page.file === "index.html") {
      setHomeLatest(page, articles);
      setNewServices(page);
    } else {
      setGuidesBlock(page, articles);
      setNewServices(page);
      setAiWebsiteCrossLink(page);
    }
  }

  let changed = 0;
  for (const page of Object.values(pages)) {
    if (page.html !== page.orig) {
      fs.writeFileSync(path.join(SITE_ROOT, page.file), page.html, "utf8");
      changed++;
    }
  }
  const resBefore = fs.readFileSync(path.join(SITE_ROOT, "resources.html"), "utf8");
  const n = rebuildResources(SITE_ROOT);
  const resAfter = fs.readFileSync(path.join(SITE_ROOT, "resources.html"), "utf8");
  if (resAfter !== resBefore && !changed) changed++;
  const urls = rebuildSitemap(pages);
  writeLlmsTxt(pages, articles);
  console.log(`✓ seo-maintain: ${changed} page(s) updated, ${articles.length} articles, resources ${n}, sitemap ${urls} URLs.`);
}

module.exports = main;
if (require.main === module) main();
