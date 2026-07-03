#!/usr/bin/env node
/**
 * rebuild-resources.js — self-healing Resources index.
 *
 * Scans SITE_ROOT for every article page (identified by a BlogPosting JSON-LD
 * block — the reliable signal that separates content-hub articles from the
 * service/location pages, which use Service/ProfessionalService schema) and
 * rebuilds the card grid inside resources.html from scratch, newest first.
 *
 * Because it rebuilds from the actual files, resources.html can never drift:
 * every article that exists on disk is guaranteed to appear. Cards stay in
 * static HTML (good for crawling/SEO), not rendered client-side.
 *
 * Usage:  node autoblog/scripts/rebuild-resources.js [SITE_ROOT]
 * Or:     require('./rebuild-resources')(siteRoot)
 */
const fs = require("fs");
const path = require("path");

const CARD_IC = `<div class="ic"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>`;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractArticle(html, filename) {
  // must be an article
  if (!/"@type"\s*:\s*"BlogPosting"/.test(html)) return null;
  let headline = "", description = "", datePublished = "";
  // pull every ld+json block, find the BlogPosting node
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const b of blocks) {
    const json = b.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    let data;
    try { data = JSON.parse(json); } catch { continue; }
    const nodes = data["@graph"] ? data["@graph"] : [data];
    const bp = nodes.find(n => n && n["@type"] === "BlogPosting");
    if (bp) {
      headline = bp.headline || "";
      description = bp.description || "";
      datePublished = bp.datePublished || "";
      break;
    }
  }
  // fallbacks from the page body if schema was thin
  if (!headline) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1) headline = h1[1].replace(/<[^>]+>/g, "").trim();
  }
  if (!description) {
    const md = html.match(/<meta name="description" content="([^"]*)"/);
    if (md) description = md[1];
  }
  if (!headline) return null;
  return { file: filename, headline, description, datePublished };
}

function rebuildResources(siteRoot) {
  const resourcesPath = path.join(siteRoot, "resources.html");
  const files = fs.readdirSync(siteRoot).filter(f => f.endsWith(".html") && f !== "resources.html");
  const articles = [];
  for (const f of files) {
    const a = extractArticle(fs.readFileSync(path.join(siteRoot, f), "utf8"), f);
    if (a) articles.push(a);
  }
  // newest first; tie-break by title for stable ordering
  articles.sort((x, y) =>
    (y.datePublished || "").localeCompare(x.datePublished || "") ||
    x.headline.localeCompare(y.headline));

  const cards = articles.map(a =>
`        <a class="card" href="${a.file}" style="display:block">
          ${CARD_IC}
          <h3>${esc(a.headline)}</h3>
          <p>${esc(a.description)}</p>
          <span class="more" style="color:var(--teal);font-weight:600">Read article →</span>
        </a>`).join("\n");

  let html = fs.readFileSync(resourcesPath, "utf8");
  const re = /(<div class="cards">)[\s\S]*?(<\/div>\s*<\/section>)/;
  if (!re.test(html)) throw new Error("Could not find the .cards grid in resources.html");
  html = html.replace(re, `$1\n${cards}\n  $2`);
  fs.writeFileSync(resourcesPath, html, "utf8");
  return articles.length;
}

module.exports = rebuildResources;

if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, "..", "..");
  const n = rebuildResources(root);
  console.log(`✓ Rebuilt resources.html from ${n} article(s).`);
}
