#!/usr/bin/env node
/**
 * rebuild-sitemap.js — regenerate sitemap.xml + robots.txt from the live .html files.
 *
 * Excludes low-value / non-indexable pages (thank-you + legal utility pages) per the
 * indexing plan, so only commercial service, city, hub, and resource pages are submitted.
 *
 * Usage:  node autoblog/scripts/rebuild-sitemap.js [SITE_ROOT]
 * Or:     require('./rebuild-sitemap')(siteRoot)
 */
const fs = require("fs");
const path = require("path");

const BASE = (process.env.SITE_BASE || "https://dentalmarketingpros.co.uk").replace(/\/$/, "");
const SKIP = ["thank-you.html", "cookies.html", "privacy.html", "terms.html"];

function rebuildSitemap(siteRoot) {
  const files = fs.readdirSync(siteRoot).filter(f => f.endsWith(".html") && !SKIP.includes(f));
  const meta = (f) => {
    if (f === "index.html") return { loc: BASE + "/", p: "1.0" };
    let p = "0.6";
    if (["seo.html", "ppc.html", "web-design.html", "locations.html"].includes(f)) p = "0.9";
    else if (["services.html", "about.html", "contact.html"].includes(f)) p = "0.8";
    else if (f.startsWith("dental-marketing-")) p = "0.8";
    else if (f.startsWith("dental-")) p = "0.7";
    return { loc: BASE + "/" + f, p };
  };
  const entries = files.map(f => {
    const st = fs.statSync(path.join(siteRoot, f));
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
  fs.writeFileSync(path.join(siteRoot, "sitemap.xml"), xml);
  const robots =
`# robots.txt for Dental Marketing Pros
User-agent: *
Allow: /

# Block nothing of value to search engines
Disallow: /.vercel/

Sitemap: ${BASE}/sitemap.xml
`;
  fs.writeFileSync(path.join(siteRoot, "robots.txt"), robots);
  return entries.length;
}

module.exports = rebuildSitemap;

if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, "..", "..");
  const n = rebuildSitemap(root);
  console.log(`✓ Rebuilt sitemap.xml (${n} URLs) and robots.txt.`);
}
