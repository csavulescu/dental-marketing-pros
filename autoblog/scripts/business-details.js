/**
 * business-details.js — keeps the company details consistent sitewide.
 *
 * Idempotent: rewrites any page, template or text file that still carries the
 * old phone number / legal entity, and adds the registered address + company
 * and VAT numbers. Once everything is current it changes nothing.
 * Emails are deliberately left untouched. Enquiry forms (FormSubmit) also get
 * FORM_CC added, so every submission is copied to those addresses.
 *
 * Usage: require("./business-details")(SITE_ROOT)  (called at the end of seo-maintain.js)
 */
const fs = require("fs");
const path = require("path");

const OLD_NAME = "Elite Talent " + "Media LTD";
const NEW_NAME = "UClimb Ltd";
const OLD_TEL = "0130" + "2616311";
const OLD_TEL_SPACED = "01302 " + "616311";
const OLD_TEL_INTL = "+44" + "1302616311";
const NEW_TEL = "01246922127";
const NEW_TEL_SPACED = "01246 922127";
const NEW_TEL_INTL = "+441246922127";
// Previous number (0330), swapped out Sept 2026
const PREV_TEL = "0330" + "2366568";
const PREV_TEL_SPACED = "0330 " + "236 6568";
const PREV_TEL_INTL = "+44" + "3302366568";
const ADDR_HTML = "5th Floor, 167&ndash;169 Great Portland Street, London W1W 5PF";
const LEGAL = "Company number 12505792 | VAT number GB328400425";
const ADDR_SCHEMA = '"address":{"@type":"PostalAddress","streetAddress":"5th Floor, 167-169 Great Portland Street","addressLocality":"London","postalCode":"W1W 5PF","addressCountry":"GB"},"vatID":"GB328400425",';
const ADDR_ORG_JS = '"address": { "@type": "PostalAddress", "streetAddress": "5th Floor, 167-169 Great Portland Street", "addressLocality": "London", "postalCode": "W1W 5PF", "addressCountry": "GB" },\n  "vatID": "GB328400425",\n  ';
const PLACEHOLDER = "a company registered in England and Wales. Company number: [add your company number]. Registered office: [add your registered office address].";
const REG_INLINE = `a company registered in England and Wales (company number 12505792, VAT number GB328400425, registered office ${ADDR_HTML}),`;
const REG_SENTENCE = `a company registered in England and Wales. Company number: 12505792. VAT number: GB328400425. Registered office: ${ADDR_HTML}.`;

// Areas served, as schema.org places (replaces the old plain-text lists).
const AREAS = [
  { "@type": "City", "name": "Sheffield" },
  { "@type": "City", "name": "Doncaster" },
  { "@type": "City", "name": "Rotherham" },
  { "@type": "City", "name": "Barnsley" },
  { "@type": "City", "name": "Chesterfield" },
  { "@type": "AdministrativeArea", "name": "South Yorkshire" },
  { "@type": "AdministrativeArea", "name": "North Derbyshire" },
  { "@type": "Country", "name": "United Kingdom" }
];
const AREAS_JSON = JSON.stringify(AREAS);

// Ordered: the specific patterns run before the generic phone / name swaps.
const REPLACEMENTS = [
  // schema: areaServed as structured places (page JSON-LD, page sources, build-pages.js ORG)
  ['"areaServed":["South Yorkshire","North Derbyshire","United Kingdom"]', `"areaServed":${AREAS_JSON}`],
  ['"areaServed":["South Yorkshire","United Kingdom"]', `"areaServed":${AREAS_JSON}`],
  ['"areaServed": ["South Yorkshire", "North Derbyshire", "United Kingdom"]', `"areaServed": ${AREAS_JSON}`],
  // schema: page JSON-LD (single line) and build-pages.js ORG object
  [`"legalName":"${OLD_NAME}","url":"https://dentalmarketingpros.co.uk/","telephone":"${OLD_TEL_INTL}",`,
   `"legalName":"${NEW_NAME}","url":"https://dentalmarketingpros.co.uk/","telephone":"${NEW_TEL_INTL}",${ADDR_SCHEMA}`],
  [`"telephone": "${OLD_TEL_INTL}",\n  "email"`, `"telephone": "${NEW_TEL_INTL}",\n  ${ADDR_ORG_JS}"email"`],
  // footer contact column: add the address
  [`<li>📞 <a href="tel:${OLD_TEL}">${OLD_TEL_SPACED}</a></li><li>✉ hello@dentalmarketingpros.co.uk</li></ul></div>`,
   `<li>📞 <a href="tel:${NEW_TEL}">${NEW_TEL_SPACED}</a></li><li>✉ hello@dentalmarketingpros.co.uk</li><li>📍 ${NEW_NAME}<br>5th Floor<br>167&ndash;169 Great Portland Street<br>London<br>W1W 5PF</li></ul></div>`],
  // footer copyright + legal details
  [`<span>© 2026 Dental Marketing Pros, a trading name of ${OLD_NAME}. All rights reserved.</span>`,
   `<span>© 2026 Dental Marketing Pros, a trading name of ${NEW_NAME}. All rights reserved.<br>${LEGAL}</span>`],
  // legal pages: fill in the company-number / registered-office placeholders
  [PLACEHOLDER + " collects", REG_INLINE + " collects"],
  [PLACEHOLDER + " uses", REG_INLINE + " uses"],
  [PLACEHOLDER + " by email", REG_INLINE + " by email"],
  [PLACEHOLDER, REG_SENTENCE],
  // everything else
  [`tel:${OLD_TEL}`, `tel:${NEW_TEL}`],
  [OLD_TEL_SPACED, NEW_TEL_SPACED],
  [OLD_TEL_INTL, NEW_TEL_INTL],
  [`tel:${PREV_TEL}`, `tel:${NEW_TEL}`],
  [PREV_TEL_SPACED, NEW_TEL_SPACED],
  [PREV_TEL_INTL, NEW_TEL_INTL],
  [OLD_NAME, NEW_NAME],
];

// FormSubmit: comma-separated addresses copied on every enquiry form submission
const FORM_CC = "cristian@uclimb.co.uk";
const CAPTCHA_FIELD = '<input type="hidden" name="_captcha" value="false">';

// Team: Person schema + anchor for team members named on about.html, so they can
// be referenced as authors. Cristian's Person node is added by content-migrations.js.
const BASE = "https://dentalmarketingpros.co.uk";
const TEAM = [{
  anchor: "furqan",
  card: '<h3 style="font-size:1.15rem;margin-bottom:4px">Furqan</h3>',
  person: {
    "@type": "Person",
    "@id": BASE + "/about.html#furqan",
    "name": "Furqan",
    "jobTitle": "SEO Specialist",
    "url": BASE + "/about.html#furqan",
    "worksFor": { "@id": BASE + "/#org" },
    "knowsAbout": ["Search engine optimisation", "Local SEO", "Technical SEO", "WordPress"],
    "description": "Furqan is an SEO specialist and WordPress designer at Dental Marketing Pros, with over 8 years' experience in search engine optimisation."
  }
}];

function addTeamSchema(s) {
  for (const t of TEAM) {
    // anchor on the team card so #furqan links land on it
    const cardOpen = '<div class="card" style="padding:26px 24px">';
    const at = s.indexOf(t.card);
    if (at > 0 && !s.includes(`id="${t.anchor}"`)) {
      const open = s.lastIndexOf(cardOpen, at);
      if (open >= 0) s = s.slice(0, open) + `<div class="card" id="${t.anchor}" style="padding:26px 24px">` + s.slice(open + cardOpen.length);
    }
    if (!s.includes(`"@id":"${t.person["@id"]}"`)) {
      const m = s.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (m) {
        const data = JSON.parse(m[1]);
        if (Array.isArray(data["@graph"])) {
          data["@graph"].push(t.person);
          s = s.replace(m[0], () => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
        }
      }
    }
  }
  return s;
}

const SKIP_DIRS = new Set([".git", "node_modules"]);
const EXTS = new Set([".html", ".js", ".txt", ".json", ".md", ".xml"]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (EXTS.has(path.extname(e.name)) && e.name !== "business-details.js") out.push(path.join(dir, e.name));
  }
  return out;
}

function applyBusinessDetails(siteRoot) {
  let changed = 0;
  for (const file of walk(siteRoot, [])) {
    const orig = fs.readFileSync(file, "utf8");
    let s = orig;
    for (const [from, to] of REPLACEMENTS) s = s.split(from).join(to);
    // contact page: show the address alongside the phone / email
    if (path.basename(file) === "contact.html" && !s.includes(`📍 ${NEW_NAME}, `)) {
      s = s.replace("<li>🕑 Mon–Fri, 9am–5pm</li>", `<li>📍 ${NEW_NAME}, ${ADDR_HTML}</li>\n            <li>🕑 Mon–Fri, 9am–5pm</li>`);
    }
    // about page: team Person schema
    if (file === path.join(siteRoot, "about.html")) s = addTeamSchema(s);
    // enquiry forms: copy submissions to FORM_CC
    if (s.includes('action="https://formsubmit.co/') && !s.includes('name="_cc"')) {
      s = s.split(CAPTCHA_FIELD).join(`${CAPTCHA_FIELD}\n          <input type="hidden" name="_cc" value="${FORM_CC}">`);
    }
    if (s !== orig) { fs.writeFileSync(file, s, "utf8"); changed++; }
  }
  console.log(`✓ business-details: ${changed} file(s) updated.`);
  return changed;
}

module.exports = applyBusinessDetails;
if (require.main === module) applyBusinessDetails(process.argv[2] || path.join(__dirname, "..", ".."));
