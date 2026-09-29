/**
 * internal-links.js — contextual internal links inside article prose, applied by
 * seo-maintain.js on every run.
 *
 * Two things, both idempotent (stripped and re-applied each run, so a second run
 * produces no diff):
 *
 *   1. Auto-links: the first mention of a known topic phrase in an article's body
 *      becomes a link to the guide or service page that covers it. Max
 *      MAX_AUTO_LINKS per article, never to the article itself, never to a page
 *      the prose already links to, never inside headings or existing links.
 *      Inserted links carry data-dmp="auto" so they can be stripped next run.
 *      PHRASES is ordered by priority: guides with the fewest inbound links first.
 *
 *   2. Local next step: one short paragraph at the end of each article linking to
 *      the matching town service page (e.g. "dental SEO in Doncaster") and to
 *      locations.html. Generic articles are assigned one of the five South
 *      Yorkshire / North Derbyshire towns by a stable hash of the filename, so
 *      links spread evenly and don't move when new articles are published.
 *      Wrapped in <!-- dmp:nextstep --> markers.
 *
 *   3. Minimum links: every article body links to at least MIN_GUIDE_LINKS other
 *      guides. If the auto-links don't reach that, a "Further reading" line with
 *      the closest related guides is added to the next-step block.
 */
const fs = require("fs");
const path = require("path");

const MAX_AUTO_LINKS = 4;
const MIN_GUIDE_LINKS = 3;
const TOWNS_SY = ["sheffield", "doncaster", "rotherham", "barnsley", "chesterfield"];
const cap = s => s[0].toUpperCase() + s.slice(1);

// [regex source, target file, flags]. Case-insensitive unless flags given.
// Order = priority. Under-linked guides first, then the rest.
const PHRASES = [
  ["E-E-A-T|author bios?|authorship", "building-e-e-a-t-why-dentist-authorship-matters-for-seo.html"],
  ["WordPress|website platforms?|content management systems?", "choosing-a-dental-website-platform-wordpress-vs-custom-build.html"],
  ["content marketing|blog (?:articles|posts|content)", "content-marketing-for-dental-practices-a-beginners-strategy.html"],
  ["conversion tracking", "conversion-tracking-setup-for-dental-google-ads-ga4.html"],
  ["West Yorkshire", "dental-marketing-across-west-yorkshire-a-regional-overview.html", ""],
  ["(?:website|site) navigation|navigation structure|site (?:structure|architecture)|menu structure", "dental-website-navigation-structuring-for-treatments-locations.html"],
  ["emergency (?:appointments?|patients|slots|dental care)|same-day emergenc(?:y|ies)", "emergency-dentist-marketing-capturing-same-day-demand.html"],
  ["internal link(?:s|ing)", "internal-linking-for-dental-websites-a-simple-authority-boost.html"],
  ["seasonality|seasonal (?:demand|patterns?|trends?|campaigns?|peaks?|spikes?|promotions?|searches)", "seasonal-dental-ad-campaigns-when-demand-spikes-and-how-to-win.html"],
  ["TikTok", "should-your-dental-practice-be-on-tiktok-an-honest-take.html", ""],
  ["video testimonials?|testimonial videos?|filmed testimonials?|video (?:content|marketing)", "video-testimonials-for-dentists-filming-consent-and-impact.html"],
  ["before-and-after (?:photos?|images?|pictures?)", "before-and-after-image-consent-getting-it-right.html"],
  ["GDPR", "data-gdpr-patient-enquiries-handling-leads-compliantly.html", ""],
  ["ad scheduling|dayparting", "dayparting-scheduling-dental-ads-around-your-opening-hours.html"],
  ["landing pages?", "dental-landing-pages-that-convert-paid-traffic-into-bookings.html"],
  ["Invisalign (?:patients|audiences?|campaigns?)", "facebook-ad-targeting-for-invisalign-patients-step-by-step.html"],
  ["squat practices?|(?:opening|launching) a (?:new )?practice|brand-new practices?|new[- ]build practices?", "marketing-a-squat-new-dental-practice-from-day-one.html"],
  ["NHS[ -]to[ -]private|from NHS to private|converting to private", "nhs-to-private-dental-practice-conversion.html"],
  ["pricing pages?|treatment prices", "pricing-pages-for-dental-treatments-should-you-show-prices.html"],
  ["remarketing|retargeting", "remarketing-for-dental-practices-winning-back-lost-enquiries.html"],
  ["unconverted enquiries|enquiry handling|follow(?:ing)?[ -]up (?:on )?enquiries", "why-your-dental-enquiries-arent-turning-into-booked-appointments.html"],
  ["patient referrals|referral (?:schemes?|programmes?|engines?)|word-of-mouth referrals", "building-a-referral-engine-through-patient-reviews-social-proof.html"],
  ["misleading claims|claims you (?:can't|cannot) make", "claims-you-legally-cant-make-in-dental-marketing-uk.html"],
  ["page speed|site speed|load(?:ing)? (?:times?|speed)", "dental-website-page-speed-the-silent-ranking-conversion-killer.html"],
  ["Google reviews", "google-reviews-for-dentists-how-to-get-more-and-stay-compliant.html"],
  ["keyword research", "keyword-research-for-dental-practices-finding-what-patients-search.html"],
  ["long-tail (?:keywords|searches|terms)", "long-tail-keywords-that-bring-high-intent-dental-patients.html"],
  ["Meta Ads|Facebook and Instagram ads", "paid-social-for-dentists-a-beginners-meta-ads-guide.html"],
  ["multi-location|several (?:towns|locations|sites)|multiple (?:locations|sites)", "multi-location-dental-seo-ranking-across-several-towns.html"],
  ["short-form video|Reels", "reels-short-form-video-for-dentists-ideas-that-actually-get-views.html"],
  ["technical SEO", "technical-seo-for-dental-websites-a-non-technical-checklist.html"],
  ["marketing ROI|return on (?:your )?(?:marketing )?investment", "tracking-marketing-roi-across-seo-ppc-and-social.html"],
  ["compliance checklist", "your-annual-dental-marketing-compliance-checklist.html"],
  ["patient journey", "from-clicks-to-chairs-optimising-the-full-patient-journey.html"],
  ["hero section", "hero-sections-that-convert-the-top-of-your-dental-homepage.html"],
  ["Instagram", "instagram-for-dental-practices-a-content-plan-that-books-appointments.html", ""],
  ["clear aligners?|orthodontic", "marketing-for-orthodontics-clear-aligners-a-practice-guide.html"],
  ["negative reviews?", "negative-reviews-how-dentists-should-respond-compliantly.html"],
  ["patient retention|recall (?:reminders|campaigns|systems?)", "patient-retention-marketing-keeping-the-patients-you-win.html"],
  ["marketing budget", "the-dental-marketing-budget-breakdown-for-a-1m-practice.html"],
  ["high-value (?:treatments?|patients|cases)", "attracting-high-value-implant-cosmetic-patients-online.html"],
  ["call tracking", "call-tracking-for-dental-ads-stop-wasting-budget-on-lost-calls.html"],
  ["cost per new patient|cost per acquisition", "cost-per-new-patient-how-to-actually-measure-your-marketing-roi.html"],
  ["ad extensions", "dental-google-ads-ad-extensions-every-practice-should-use.html"],
  ["treatment keywords", "how-to-rank-for-treatment-keywords-implants-invisalign-whitening.html"],
  ["lifetime (?:patient )?value", "lifetime-patient-value-the-metric-that-changes-your-ad-budget.html"],
  ["negative keywords?", "negative-keywords-for-dental-google-ads-stop-wasting-spend.html"],
  ["schema markup|structured data", "schema-markup-for-dentists-helping-google-understand-your-site.html"],
  ["(?:website )?copywriting", "dental-website-copywriting-words-that-turn-browsers-into-bookings.html"],
  ["redesign(?:ing)? (?:your|a|the) (?:dental )?website|website redesign", "dental-website-redesign-signs-its-time-and-what-to-expect.html"],
  ["legal pages|privacy polic(?:y|ies)", "website-legal-pages-every-dental-practice-needs.html"],
  ["finance (?:plans|options)|payment plans", "advertising-finance-payment-plans-for-dental-treatment.html"],
  ["trust signals", "trust-signals-every-dental-website-needs-to-convert.html"],
  ["online booking", "online-booking-integration-turning-website-visitors-into-patients.html"],
  ["nervous (?:patients|people)|anxious patients|dental anxiety", "designing-a-dental-website-for-nervous-patients.html"],
  ["cost[ -]per[ -]click", "how-to-lower-your-cost-per-click-on-dental-google-ads.html"],
  ["mobile-first", "mobile-first-dental-websites-why-70-of-your-traffic-decides-on-a-phone.html"],
  ["accessibility", "accessibility-on-dental-websites-compliance-and-more-patients.html"],
  ["geo-target(?:ing|ed)", "geo-targeting-dental-ads-reaching-patients-in-your-catchment.html"],
  ["Google Business Profile", "google-business-profile-optimisation-for-dental-practices.html", ""],
  ["GDC and ASA|ASA and GDC", "gdc-asa-compliant-dental-advertising-what-you-can-and-cant-say.html", ""],
  ["map pack", "dental-seo-how-to-rank-google-map-pack.html"],
  ["local SEO", "local-seo-for-dentists-ranking-for-dentist-near-me.html"],
  ["generative engine optimisation|AI Overviews", "what-is-geo-a-plain-english-guide-for-dental-practice-owners.html"]
];

// town service page + anchor per pillar
const PILLAR_TOWN = {
  SEO: ["dental-seo-", t => `dental SEO in ${t}`],
  PPC: ["dental-ppc-", t => `Google Ads for dentists in ${t}`],
  Web: ["dental-web-design-", t => `dental web design in ${t}`],
  GEO: ["dental-geo-", t => `GEO and AI search for ${t} practices`]
};
const DEFAULT_TOWN = ["dental-marketing-", t => `dental marketing in ${t}`];

function hash(s) { // FNV-1a, stable across runs and Node versions
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

function stripAutoLinks(html) {
  return html.replace(/<a data-dmp="auto" href="[^"]*">([\s\S]*?)<\/a>/g, "$1");
}
function stripNextStep(html) {
  return html.replace(/\n?<!-- dmp:nextstep:start -->[\s\S]*?<!-- dmp:nextstep:end -->/g, "");
}

// [start, end) of the article body: from the prose div to the first dmp block
// or the end of the prose section, whichever comes first.
function proseRange(html) {
  const start = html.indexOf('<div class="narrow prose">');
  if (start < 0) return null;
  const from = start + '<div class="narrow prose">'.length;
  const ends = [html.indexOf("<!-- dmp:", from), html.indexOf("</div></section></div>", from)].filter(i => i >= 0);
  if (!ends.length) return null;
  return [from, Math.min(...ends)];
}

// Link the first match of re in the text nodes of <p>/<li> elements that are
// not inside an <a>. Returns new body or null if no match.
function linkFirst(body, re, target) {
  const parts = body.split(/(<[^>]+>)/);
  let inA = 0, inPara = 0, inHeading = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("<")) {
      if (/^<a[\s>]/i.test(p)) inA++;
      else if (/^<\/a>/i.test(p)) inA = Math.max(0, inA - 1);
      else if (/^<(p|li)[\s>]/i.test(p)) inPara++;
      else if (/^<\/(p|li)>/i.test(p)) inPara = Math.max(0, inPara - 1);
      else if (/^<h[1-6][\s>]/i.test(p)) inHeading++;
      else if (/^<\/h[1-6]>/i.test(p)) inHeading = Math.max(0, inHeading - 1);
      continue;
    }
    if (inA || !inPara || inHeading || !p) continue;
    const m = re.exec(p);
    if (!m) continue;
    parts[i] = p.slice(0, m.index) + `<a data-dmp="auto" href="${target}">${m[0]}</a>` + p.slice(m.index + m[0].length);
    return parts.join("");
  }
  return null;
}

function nextStepParagraph(page, exists) {
  const town = page.town;
  let town_file, anchor, townName;
  if (town && !TOWNS_SY.includes(town)) {
    // expansion-town article: point at the locations hub only
    return `<p>We're based in South Yorkshire and work with practices across the region and beyond. See <a href="locations.html">the areas we cover</a>, including our town pages for Sheffield, Doncaster, Rotherham, Barnsley and Chesterfield.</p>`;
  }
  townName = town || TOWNS_SY[hash(page.file) % TOWNS_SY.length];
  const [prefix, anchorFn] = PILLAR_TOWN[page.pillar] || DEFAULT_TOWN;
  town_file = `${prefix}${townName}.html`;
  if (!exists(town_file)) town_file = `dental-marketing-${townName}.html`;
  anchor = (exists(`${prefix}${townName}.html`) ? anchorFn : DEFAULT_TOWN[1])(cap(townName));
  const link = `<a href="${town_file}">${anchor}</a>`;
  const loc = `<a href="locations.html">`;
  const variants = [
    `Running a practice in or around ${cap(townName)}? Our page on ${link} shows how we apply this locally. We also work across ${loc}South Yorkshire and North Derbyshire</a>.`,
    `If your practice is in ${cap(townName)}, see ${link} for how we put this into practice there, or browse ${loc}all the towns we cover</a>.`,
    `For practices near ${cap(townName)}, we've set out our local approach on the ${link} page. Other towns are listed on our ${loc}locations page</a>.`
  ];
  return `<p>${variants[hash(page.file + ":v") % variants.length]}</p>`;
}

const escHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Apply the passes to one article page. `exists(file)` says whether a page exists;
 * `closest()` returns other articles ({file, headline}) ordered by relevance;
 * `isArticle(file)` says whether a file is an article.
 */
function setContextualLinks(page, exists, closest, isArticle) {
  let html = stripNextStep(stripAutoLinks(page.html));
  const r = proseRange(html);
  if (!r) { page.html = html; return; }
  let body = html.slice(r[0], r[1]);

  const nextStep = nextStepParagraph(page, exists);
  const linked = new Set((body + nextStep).match(/href="([^"#?]+)/g)?.map(h => h.slice(6).replace(/^\//, "")) || []);
  linked.add(page.file);

  let added = 0;
  for (const [src, target, flags] of PHRASES) {
    if (added >= MAX_AUTO_LINKS) break;
    if (linked.has(target) || !exists(target)) continue;
    const re = new RegExp(`(?<![\\w-])(?:${src})(?![\\w-])`, flags === undefined ? "i" : flags);
    const out = linkFirst(body, re, target);
    if (out) { body = out; linked.add(target); added++; }
  }

  // guarantee a minimum number of links to other guides in the body
  let further = "";
  if (closest && isArticle) {
    const guideLinks = new Set([...linked].filter(f => f !== page.file && isArticle(f)));
    const need = MIN_GUIDE_LINKS - guideLinks.size;
    if (need > 0) {
      const picks = closest().filter(a => !linked.has(a.file)).slice(0, need);
      if (picks.length) {
        const a = picks.map(x => `<a href="${x.file}">${escHtml(x.headline.replace(/&amp;/g, "&"))}</a>`);
        const list = a.length === 1 ? a[0] : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
        further = `\n<p>Further reading: ${list}.</p>`;
      }
    }
  }

  // trailing whitespace before the end of prose stays where it was
  const trail = body.match(/\s*$/)[0];
  body = body.slice(0, body.length - trail.length)
    + `\n<!-- dmp:nextstep:start -->${further}\n${nextStep}\n<!-- dmp:nextstep:end -->` + trail;
  page.html = html.slice(0, r[0]) + body + html.slice(r[1]);
}


// ---------- one-off contextual links on the homepage, about page and town hubs ----------
// Added 2026-09-29. Each edit checks its own signature, so it runs once and is then
// ordinary page content that can be edited by hand. If the source sentence has
// been reworded since, the edit is skipped.
const NHS = "nhs-to-private-dental-practice-conversion.html";
const GDC = "gdc-asa-compliant-dental-advertising-what-you-can-and-cant-say.html";

function replaceOnce(html, find, repl, signature) {
  if (html.includes(signature) || !html.includes(find)) return html;
  return html.replace(find, () => repl);
}

function migratePageLinks(file, html) {
  html = migrateHeadTerm(file, html);
  if (file === "index.html") {
    html = replaceOnce(html,
      'and <a href="dental-web-design-sheffield.html">dental web design in Sheffield</a>. See all towns',
      ', <a href="dental-web-design-sheffield.html">dental web design in Sheffield</a> and <a href="dental-seo-doncaster.html">dental SEO in Doncaster</a>. See all towns',
      'href="dental-seo-doncaster.html">dental SEO in Doncaster</a>');
    html = replaceOnce(html,
      "it has to stay within GDC and ASA rules on claims, testimonials and before-and-after images.</p>",
      `it has to stay within <a href="${GDC}">GDC and ASA rules</a> on claims, testimonials and before-and-after images. The same goes for practices <a href="${NHS}">converting from NHS to private</a>, where the message and the patients you target both change.</p>`,
      `">converting from NHS to private</a>`);
  }
  if (file === "about.html") {
    html = replaceOnce(html,
      "a family practice converting from NHS to private.",
      `a family practice <a href="${NHS}">converting from NHS to private</a>.`,
      `">converting from NHS to private</a>`);
    html = replaceOnce(html,
      "increasingly risky as enforcement tightens.</p>",
      `increasingly risky as enforcement tightens. Our guide to <a href="${GDC}">what you can and can't say under GDC and ASA rules</a> covers the essentials.</p>`,
      `">what you can and can't say under GDC and ASA rules</a>`);
  }
  const m = file.match(/^dental-marketing-([a-z]+)\.html$/);
  if (m && TOWNS_SY.includes(m[1])) {
    const t = m[1], name = cap(t);
    if (!html.includes(`href="dental-seo-${t}.html">dental SEO in ${name}</a>`)) {
      const h2 = `<h2 style="margin-top:8px">What makes dental marketing in ${name} different</h2>`;
      const at = html.indexOf(h2);
      const end = at < 0 ? -1 : html.indexOf("\n      </div>\n      <div class=\"panel\">", at);
      if (end > 0) {
        const para = `\n        <p>Most ${name} practices start with one of three services: <a href="dental-seo-${t}.html">dental SEO in ${name}</a> to win local and treatment searches, <a href="dental-ppc-${t}.html">Google Ads for dentists in ${name}</a> when you need enquiries quickly, or <a href="dental-web-design-${t}.html">dental web design in ${name}</a> when the website is losing bookings.</p>`;
        html = html.slice(0, end) + para + html.slice(end);
      }
    }
  }
  return html;
}

// ---------- 2026-09-29: homepage owns "dental marketing agency" ----------
// Puts the head term in the homepage H1 and turns about.html into a plain About
// page (title, description, eyebrow, H3, AboutPage schema), with one link from
// the About page to the homepage using the "dental marketing agency" anchor.
// Each edit is signature-checked, so it runs once and can be edited by hand after.
// The homepage has its own inline CSS and doesn't load style.css, so the classes
// used by the sections added in content-migrations.js (prose text and links, the
// two-column split, the panel and the FAQ list) are copied here from style.css.
const HOME_SECTION_CSS = "/* dmp:home-sections */"
  + ".prose h2{font-size:1.9rem;font-weight:800;margin:36px 0 14px}"
  + ".prose h3{font-size:1.25rem;font-weight:700;margin:28px 0 10px}"
  + ".prose p{color:var(--slate);margin-bottom:16px}"
  + ".prose ul,ul.prose{margin:0 0 18px 0;list-style:none;padding-left:0}"
  + ".prose li{position:relative;padding:6px 0 6px 28px;color:var(--ink)}"
  + ".prose li:before{content:\"\\u2713\";position:absolute;left:0;color:var(--teal);font-weight:700}"
  + ".prose a:not(.btn){color:var(--teal);font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}"
  + ".prose a:not(.btn):hover{color:var(--teal-dark);text-decoration-thickness:2px}"
  + ".split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}"
  + ".split .panel{background:var(--mist);border-radius:18px;padding:40px;border:1px solid var(--line)}"
  + ".faq{max-width:820px;margin:0 auto}"
  + ".faq details{border-bottom:1px solid var(--line);padding:20px 0}"
  + ".faq summary{font-family:'Plus Jakarta Sans';font-weight:700;font-size:1.05rem;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}"
  + ".faq summary::-webkit-details-marker{display:none}"
  + ".faq summary:after{content:\"+\";color:var(--teal);font-size:1.4rem;font-weight:400}"
  + ".faq details[open] summary:after{content:\"\\u2212\"}"
  + ".faq details p{color:var(--slate);margin-top:12px}"
  + "@media(max-width:900px){.split{grid-template-columns:1fr;gap:30px}.split .panel{padding:28px}}";

function migrateHeadTerm(file, html) {
  if (file === "index.html") {
    if (!html.includes("/* dmp:home-sections */")) html = html.replace("</style>", () => HOME_SECTION_CSS + "</style>");
    html = replaceOnce(html,
      '<span class="eyebrow">Dental marketing agency · Dentists only</span>',
      '<span class="eyebrow">Dentists only · South Yorkshire &amp; UK-wide</span>',
      'South Yorkshire &amp; UK-wide</span>');
    html = replaceOnce(html,
      '<h1>More Patients.<br>Stronger Practice.<br><span class="g">Lasting Growth.</span></h1>',
      '<h1>Dental Marketing Agency for More Patients &amp;<br><span class="g">Lasting Growth.</span></h1>',
      '<h1>Dental Marketing Agency');
  }
  if (file === "about.html") {
    html = replaceOnce(html,
      "<title>About Us | The Dental-Only Marketing Agency</title>",
      "<title>About Us: Our Team and Story | Dental Marketing Pros</title>",
      "<title>About Us: Our Team and Story");
    html = replaceOnce(html,
      '<meta name="description" content="We only work with dental practices. Learn how our dental-exclusive, compliance-first approach to SEO, PPC and web design helps UK dentists grow.">',
      '<meta name="description" content="Meet the team behind Dental Marketing Pros, a UClimb brand: our story, our specialists and how we work with dental practices in South Yorkshire and the UK.">',
      'content="Meet the team behind Dental Marketing Pros');
    html = replaceOnce(html,
      '<span class="eyebrow" style="margin-top:14px;display:block">Dental marketing is all we do</span>',
      '<span class="eyebrow" style="margin-top:14px;display:block">About us</span>',
      'display:block">About us</span>');
    html = replaceOnce(html,
      "and the kind of patient you actually want in the chair.</p>",
      'and the kind of patient you actually want in the chair. It is why we run a <a href="/">dental marketing agency</a> for dentists only, rather than adding practices to a general client list.</p>',
      '<a href="/">dental marketing agency</a>');
    html = replaceOnce(html,
      "margin:10px 0 14px\">Most dental marketing isn't compliant</h3>",
      "margin:10px 0 14px\">Most practice advertising isn't compliant</h3>",
      "Most practice advertising isn't compliant");
    if (!html.includes('"@type":"AboutPage"')) {
      const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (m) {
        const data = JSON.parse(m[1]);
        if (Array.isArray(data["@graph"])) {
          data["@graph"].push({
            "@type": "AboutPage",
            "@id": "https://dentalmarketingpros.co.uk/about.html#webpage",
            "url": "https://dentalmarketingpros.co.uk/about.html",
            "name": "About Dental Marketing Pros",
            "about": { "@id": "https://dentalmarketingpros.co.uk/#org" },
            "isPartOf": { "@type": "WebSite", "url": "https://dentalmarketingpros.co.uk/", "name": "Dental Marketing Pros" }
          });
          html = html.replace(m[0], () => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
        }
      }
    }
  }
  return html;
}

module.exports = { setContextualLinks, stripAutoLinks, migratePageLinks, PHRASES, MIN_GUIDE_LINKS };
