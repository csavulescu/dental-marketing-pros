/**
 * build-pages.js — managed service/location pages with a publishing queue.
 *
 * Source of truth: autoblog/pages/<slug>.html. Each file starts with a JSON
 * header in an HTML comment, then the page body (everything between the site
 * header and the closing CTA band):
 *
 *   <!--page
 *   { "slug": "geo", "publishOn": "2026-09-25", "title": "...", "description": "...",
 *     "crumb": [["Services", "services.html"], ["GEO & AI Search"]], "navActive": "services",
 *     "service": { "name": "...", "serviceType": "...", "areaServed": "..." },
 *     "faqs": [["Question?", "Answer."]], "cta": { "eyebrow": "...", "heading": "...", "button": "...", "href": "...", "small": "..." } }
 *   -->
 *   ...body html... (use <!--faqs--> where the FAQ section should render)
 *
 * Rules:
 *  - A page goes live on or after its publishOn date (UTC).
 *  - At most MAX_NEW_PER_DAY pages are published for the first time on any one day;
 *    extra due pages wait for the next day. First-publish dates are recorded in
 *    autoblog/pages/published.json so the limit holds across several runs a day.
 *  - Published pages are re-rendered from their source on every run, so edit the
 *    source file, not the generated page in the site root.
 */
const fs = require("fs");
const path = require("path");

const MAX_NEW_PER_DAY = 3;
const BASE = (process.env.SITE_BASE || "https://dentalmarketingpros.co.uk").replace(/\/$/, "");

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => esc(s).replace(/"/g, "&quot;");
const jsonLd = obj => JSON.stringify(obj).replace(/</g, "\\u003c");

const ORG = {
  "@type": "ProfessionalService",
  "@id": BASE + "/#org",
  "name": "Dental Marketing Pros",
  "legalName": "Elite Talent Media LTD",
  "url": BASE + "/",
  "telephone": "+441302616311",
  "email": "hello@dentalmarketingpros.co.uk",
  "description": "Specialist dental marketing agency offering SEO, Google Ads and web design for UK dental practices.",
  "areaServed": ["South Yorkshire", "North Derbyshire", "United Kingdom"],
  "priceRange": "££"
};

// Canonical mega-menu cards (also used sitewide by seo-maintain.js).
const MEGA_CARDS = [
  ["seo.html", "SEO", "Rank higher and win more local patients", '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"/><path d="m20 20-4-4"/></svg>'],
  ["ppc.html", "PPC / Google Ads", "Instant, measurable patient enquiries", '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><circle cx="11" cy="11" r="3.5"/></svg>'],
  ["web-design.html", "Web Design", "Conversion-focused dental websites", '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'],
  ["geo.html", "GEO &amp; AI Search", "Get recommended by ChatGPT &amp; AI Overviews", '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z"/></svg>'],
  ["ai-websites.html", "AI Websites", "No upfront cost, £50/month", '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M12 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>'],
  ["free-seo-audit.html", "Free SEO Audit", "Actionable advice for your site, free", '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3"/><path d="M9 13l2 2 4-4"/></svg>']
];

function megaInner(indent = "") {
  return MEGA_CARDS.map(([href, title, sub, svg]) =>
    `${indent}<a class="mega-card" href="${href}"><span class="mega-ic">${svg}</span><span class="mega-tx"><b>${title}</b><small>${sub}</small></span></a>`).join("\n");
}

function nav(active) {
  const a = key => (active === key ? ' class="active"' : "");
  return `<header>
  <div class="wrap">
    <nav>
      <a href="/" class="logo">
        <svg class="logo-mark" viewBox="0 0 40 40"><path d="M20 6c-5 0-7-2-11-2C5 4 3 7 3 12c0 8 3 15 5 19 1.5 3 4 3 5-1l2-7c.8-2.8 2.2-2.8 3 0l2 7c1 4 3.5 4 5 1 2-4 5-11 5-19 0-5-2-8-6-8-4 0-6 2-9 2z" fill="#0d7a7a"/></svg>
        <span class="logo-text">DENTAL<span>MARKETING PROS</span></span>
      </a>
      <div class="nav-menu">
        <div class="nav-links">
          <a href="/">Home</a>
          <a href="about.html">About Us</a>
          <div class="has-mega">
            <a href="services.html" class="mega-trigger${active === "services" ? " active" : ""}">Services <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg></a>
            <div class="mega"><div class="mega-panel"><div class="mega-inner">
${megaInner("              ")}
            </div><div class="mega-foot"><span>Specialist marketing, dentists only</span><a href="services.html" class="mega-all">All services →</a></div></div></div>
          </div>
          <a href="free-seo-audit.html"${a("audit")}>Free SEO Audit</a>
          <a href="locations.html"${a("locations")}>Locations</a>
          <a href="resources.html"${a("resources")}>Resources</a>
          <a href="contact.html"${a("contact")}>Contact</a>
        </div>
        <div class="nav-cta"><a href="contact.html" class="btn btn-primary">📅 Book a Free Strategy Call</a></div>
      </div>
      <button class="menu-btn" aria-label="Menu" aria-expanded="false">☰</button>
    </nav>
  </div>
</header>`;
}

const FOOTER = `<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <div class="logo"><svg class="logo-mark" viewBox="0 0 40 40"><path d="M20 6c-5 0-7-2-11-2C5 4 3 7 3 12c0 8 3 15 5 19 1.5 3 4 3 5-1l2-7c.8-2.8 2.2-2.8 3 0l2 7c1 4 3.5 4 5 1 2-4 5-11 5-19 0-5-2-8-6-8-4 0-6 2-9 2z" fill="#fff"/></svg><span class="logo-text">DENTAL<span style="color:#7fd4d4">MARKETING PROS</span></span></div>
        <p class="foot-about">Specialist dental marketing that attracts more patients, strengthens your reputation and grows your practice.</p>
        <p class="compliance-note">GDC &amp; ASA-compliant marketing. We keep your campaigns within advertising guidelines.</p>
      </div>
      <div><h5>Services</h5><ul><li><a href="seo.html">SEO</a></li><li><a href="ppc.html">PPC Advertising</a></li><li><a href="web-design.html">Web Design</a></li><li><a href="geo.html">GEO &amp; AI Search</a></li><li><a href="ai-websites.html">AI Websites</a></li><li><a href="free-seo-audit.html">Free SEO Audit</a></li></ul></div>
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

function parseSource(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^<!--page\s*([\s\S]*?)-->\s*\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing <!--page {...} --> header`);
  const meta = JSON.parse(m[1]);
  if (!meta.slug || !meta.publishOn || !meta.title || !meta.description) throw new Error(`${file}: header needs slug, publishOn, title, description`);
  return { meta, body: m[2].trim() };
}

function faqSection(faqs, heading) {
  if (!faqs || !faqs.length) return "";
  const items = faqs.map(([q, a], i) =>
    `        <details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n");
  return `<div style="background:var(--mist)"><div class="wrap"><section>
    <div class="sec-head"><span class="eyebrow">Questions</span><h2>${esc(heading || "Frequently asked questions")}</h2></div>
    <div class="faq">
${items}
    </div>
  </section></div></div>`;
}

// {{live:slug|text|fallback.html}} links to slug.html once that managed page is
// live, otherwise to the fallback page, so pages can link ahead of the queue.
function resolveLiveLinks(html, isLive) {
  return html.replace(/\{\{live:([a-z0-9-]+)\|([^|}]+)\|([^}]+)\}\}/g, (m, slug, text, fallback) =>
    `<a href="${isLive(slug) ? slug + ".html" : fallback}">${text}</a>`);
}

function render({ meta, body }, isLive = () => false) {
  const url = `${BASE}/${meta.slug}.html`;
  const graph = [ORG];
  if (meta.service) {
    graph.push(Object.assign({ "@type": "Service", "provider": { "@id": BASE + "/#org" } }, meta.service));
  }
  if (meta.faqs && meta.faqs.length) {
    graph.push({ "@type": "FAQPage", "mainEntity": meta.faqs.map(([q, a]) => ({ "@type": "Question", "name": q, "acceptedAnswer": { "@type": "Answer", "text": a } })) });
  }
  const crumbs = [["Home", "/"], ...(meta.crumb || [])];
  graph.push({
    "@type": "BreadcrumbList",
    "itemListElement": crumbs.map(([name, href], i) => ({
      "@type": "ListItem", "position": i + 1, "name": name,
      "item": href ? (href === "/" ? BASE + "/" : `${BASE}/${href}`) : url
    }))
  });
  const crumbHtml = crumbs.map(([name, href]) => href ? `<a href="${href}">${esc(name)}</a>` : esc(name)).join(" / ");
  const cta = meta.cta || {};
  const content = resolveLiveLinks(body, isLive)
    .replace("<!--crumb-->", `<div class="crumb">${crumbHtml}</div>`)
    .replace("<!--faqs-->", faqSection(meta.faqs, meta.faqHeading));

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- dmp:managed-page (source: autoblog/pages/${meta.slug}.html, edit that file, not this one) -->
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<meta name="theme-color" content="#0d7a7a">
<title>${esc(meta.title)}</title>
<meta name="description" content="${escAttr(meta.description)}">
<link rel="canonical" href="${url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@graph": graph })}</script>
</head>
<body>
${nav(meta.navActive || "services")}
${content}

<div class="wrap"><div class="cta-band">
    <div><span class="eyebrow">${esc(cta.eyebrow || "Ready to grow your practice?")}</span><h2>${esc(cta.heading || "Book a free, no-obligation strategy call.")}</h2></div>
    <div class="cb-right"><a href="${cta.href || "contact.html"}" class="btn btn-white">${esc(cta.button || "📅 Book a Free Call")}</a><small>${esc(cta.small || "No obligation. Just growth.")}</small></div>
    <div class="ghost-tooth">🦷</div>
  </div></div>
${FOOTER}
</body>
</html>
`;
}

function buildPages(siteRoot) {
  const srcDir = path.join(siteRoot, "autoblog", "pages");
  if (!fs.existsSync(srcDir)) return { published: [], rendered: 0, waiting: [] };
  const logFile = path.join(srcDir, "published.json");
  const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : {};
  const today = process.env.DMP_TODAY || new Date().toISOString().slice(0, 10);

  const sources = fs.readdirSync(srcDir).filter(f => f.endsWith(".html")).sort()
    .map(f => parseSource(path.join(srcDir, f)))
    .sort((a, b) => a.meta.publishOn.localeCompare(b.meta.publishOn) || a.meta.slug.localeCompare(b.meta.slug));

  const isLive = slug => Boolean(log[slug]) || (!sources.some(x => x.meta.slug === slug) && fs.existsSync(path.join(siteRoot, `${slug}.html`)));
  let allowance = MAX_NEW_PER_DAY - Object.values(log).filter(d => d === today).length;
  const published = [], waiting = [];
  let rendered = 0;
  // pass 1: decide what is live (so links between pages resolve in the same run)
  for (const src of sources) {
    const { slug, publishOn } = src.meta;
    if (log[slug]) continue;
    if (publishOn > today) { waiting.push(`${slug} (${publishOn})`); continue; }
    if (allowance <= 0) { waiting.push(`${slug} (daily limit)`); continue; }
    log[slug] = today;
    allowance--;
    published.push(slug);
  }
  // pass 2: render every live page from its source
  const strip = s => s.replace(/\n?<!-- dmp:[a-z]+:start -->[\s\S]*?<!-- dmp:[a-z]+:end -->/g, "");
  for (const src of sources) {
    if (!log[src.meta.slug]) continue;
    const out = path.join(siteRoot, `${src.meta.slug}.html`);
    const html = render(src, isLive);
    const cur = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    // seo-maintain re-applies its dmp blocks afterwards; only rewrite when the
    // managed part changed, so runs stay idempotent.
    if (strip(cur) !== strip(html)) { fs.writeFileSync(out, html, "utf8"); rendered++; }
  }
  const sorted = Object.fromEntries(Object.entries(log).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])));
  const next = JSON.stringify(sorted, null, 2) + "\n";
  if (!fs.existsSync(logFile) || fs.readFileSync(logFile, "utf8") !== next) fs.writeFileSync(logFile, next);
  return { published, rendered, waiting };
}

module.exports = { buildPages, megaInner, MEGA_CARDS };

if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, "..", "..");
  const r = buildPages(root);
  console.log(`✓ build-pages: published ${r.published.length} new (${r.published.join(", ") || "none"}), re-rendered ${r.rendered}, waiting: ${r.waiting.join(", ") || "none"}`);
}
