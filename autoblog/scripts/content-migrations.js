/**
 * content-migrations.js — one-off content additions, applied by seo-maintain.js.
 *
 * Each migration checks for its own signature first, so it runs exactly once:
 * after it has been applied (and committed), it is a no-op. The inserted HTML is
 * ordinary page content (no markers), so it can be edited by hand afterwards.
 *
 * 2026-09-25: expand the five town hubs (local market copy, approach, FAQs +
 * FAQPage schema), add a "why specialist" section + FAQs to the homepage, and a
 * founder section + Person schema to about.html (author target for bylines).
 */
const BASE = "https://dentalmarketingpros.co.uk";

const escText = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function addToGraph(html, nodes) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return html;
  const data = JSON.parse(m[1]);
  if (!Array.isArray(data["@graph"])) return html;
  data["@graph"].push(...nodes);
  const out = `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
  return html.replace(m[0], () => out);
}

function faqPage(faqs) {
  return {
    "@type": "FAQPage",
    "mainEntity": faqs.map(([q, a]) => ({ "@type": "Question", "name": q, "acceptedAnswer": { "@type": "Answer", "text": a } }))
  };
}

function faqDetails(faqs, indent) {
  return faqs.map(([q, a], i) =>
    `${indent}<details${i === 0 ? " open" : ""}><summary>${escText(q)}</summary><p>${escText(a)}</p></details>`).join("\n");
}

// ---------------- town hubs ----------------
const TOWNS = {
  sheffield: {
    name: "Sheffield",
    market: [
      "Sheffield is the largest dental market we cover, and it behaves like several smaller markets stitched together. A practice in Ecclesall or Fulwood competes for a different patient, and against different rivals, than one in Hillsborough, Chapeltown or the city centre. Patients search locally, so ranking “in Sheffield” is less useful than ranking in the neighbourhoods your patients actually travel from.",
      "The city also has a large and constantly changing population thanks to its two universities. That means a steady stream of people looking for a new dentist every year, and a lot of searches that start with “dentist near me” on a phone. Practices that keep their Google Business Profile, opening hours and treatment pages sharp tend to pick up a fair share of that demand without paying for every click.",
      "Because there are more practices competing, paid search for high-value treatments such as implants and Invisalign is more contested here than in the surrounding towns. That makes tight geo-targeting, negative keywords and a landing page that answers price and finance questions more important, not less."
    ],
    steps: [
      ["Map your real catchment", "We look at which Sheffield postcodes and neighbourhoods your patients come from, then target those areas first rather than the whole city."],
      ["Win the map pack locally", "Google Business Profile, reviews and location pages built around the neighbourhoods you serve, so you show up for nearby “dentist near me” searches."],
      ["Use Google Ads where it pays", "Treatment campaigns for implants, aligners and emergency appointments, tightly geo-targeted so you are not paying for clicks from across the city."],
      ["Convert and measure", "A fast, compliant website with clear booking routes, plus call and form tracking so you can see which work produced which enquiries."]
    ],
    faqExtra: ["Is Sheffield too competitive for a smaller practice?", "Not if you are specific. Smaller practices rarely win by chasing “dentist Sheffield”. They win by ranking for their own neighbourhood, their strongest treatments and the searches their competitors ignore, then converting that traffic well."]
  },
  doncaster: {
    name: "Doncaster",
    market: [
      "Doncaster gained city status in 2022, but its dental market still feels like a large town spread across a wide area. Patients in Bawtry, Thorne, Armthorpe or Mexborough usually want a practice close to home, so visibility in each local area matters as much as ranking for “dentist Doncaster”.",
      "Online competition for dental searches here is noticeably lighter than in Sheffield or Leeds. Not every practice has invested in search yet, which leaves room for a practice that invests in its Google Business Profile, reviews and treatment pages to become the obvious local choice.",
      "Lighter competition also tends to make paid search more affordable. That makes Google Ads a sensible way to fill specific gaps, such as implant consultations, cosmetic enquiries or same-day emergency slots, while SEO builds a lasting presence underneath."
    ],
    steps: [
      ["Audit your local visibility", "We check where you appear today across Doncaster and the surrounding villages, and what your nearest competitors are doing."],
      ["Claim the easy ground", "Google Business Profile, reviews, local citations and treatment pages that are often under-used locally."],
      ["Add targeted Google Ads", "Campaigns for the treatments you most want to grow, restricted to the DN postcodes you can realistically serve."],
      ["Track every enquiry", "Call and form tracking, with plain-English monthly reporting on what each channel produced."]
    ],
    faqExtra: ["Do you only work with practices in Doncaster itself?", "No. We work with practices right across the DN postcodes, including Bawtry, Tickhill, Thorne, Hatfield, Armthorpe, Conisbrough and Mexborough, and we tailor the targeting to each practice's real catchment."]
  },
  rotherham: {
    name: "Rotherham",
    market: [
      "Rotherham sits between Sheffield and Doncaster, and plenty of local patients commute into both. That creates a real risk for Rotherham practices: if you are not visible locally, patients may simply book with a practice near their workplace instead.",
      "The borough is made up of distinct communities, from Wickersley and Bramley to Wath-upon-Dearne, Maltby and Dinnington. People searching for a dentist usually want one close to home, so local relevance for each area is often more valuable than a single ranking for “dentist Rotherham”.",
      "Competition for dental searches is moderate, which means well-executed basics still make a big difference: a complete Google Business Profile, a steady flow of genuine reviews, clear treatment pages and a website that makes booking easy on a phone."
    ],
    steps: [
      ["Understand your catchment", "We identify which Rotherham communities you draw patients from, and where you are losing them to Sheffield or Doncaster."],
      ["Strengthen local search", "Google Business Profile, reviews and area-specific content so you appear for nearby searches across the borough."],
      ["Target high-value treatments", "Focused Google Ads for the treatments you want more of, with sensible geo-targeting and budgets."],
      ["Make booking effortless", "A mobile-first, compliant website with clear calls to action, measured with call and form tracking."]
    ],
    faqExtra: ["Should a Rotherham practice target Sheffield searches too?", "Sometimes. If you are close to the border or offer a treatment that patients will travel for, targeting nearby Sheffield areas can make sense. For most practices, winning the local Rotherham searches first gives a better return."]
  },
  barnsley: {
    name: "Barnsley",
    market: [
      "Barnsley's dental market stretches from the town centre out to Penistone, Wombwell, Hoyland, Royston and Goldthorpe. Many of these communities have their own practices, and patients tend to stay loyal to somewhere nearby, so local visibility in each area is what drives new patient enquiries.",
      "Online competition here is lighter than in the big cities. Not every practice keeps its Google Business Profile and website up to date, so a practice that does the fundamentals well can stand out quickly in local search.",
      "With good links along the M1, some patients will consider travelling for treatments like implants, aligners or cosmetic work. Clear treatment pages that explain the process, the options and how finance works help those patients choose you rather than a practice further afield."
    ],
    steps: [
      ["Benchmark your area", "We look at how you appear for local searches across Barnsley's towns and villages compared with nearby practices."],
      ["Fix the fundamentals", "Google Business Profile, reviews, citations and on-page improvements that help you win the local map pack."],
      ["Grow your key treatments", "Treatment-focused content and, where it makes sense, Google Ads for the services you most want to grow."],
      ["Report what matters", "Tracked calls and forms, reported monthly in plain English so you know what is working."]
    ],
    faqExtra: ["Is Google Ads worth it for a Barnsley practice?", "It often is, because lighter competition can mean lower costs per click. We usually start with one or two treatment campaigns, track every enquiry and only scale what produces booked appointments."]
  },
  chesterfield: {
    name: "Chesterfield",
    market: [
      "Chesterfield is the main town for north Derbyshire, and its practices draw patients from a wide area including Staveley, Dronfield, Clay Cross, Bolsover and Wingerworth. Patients from these areas often search for a dentist by their own village or town, so local visibility needs to reach well beyond the town centre.",
      "Being close to Sheffield means some patients weigh up practices in both. A strong Google Business Profile, genuine reviews and a website that makes your treatments, prices and booking options clear help keep those patients local.",
      "Competition for dental searches is moderate. That leaves room for a practice that invests consistently in local SEO and treatment content to build a lead that is hard for competitors to close, with Google Ads available to fill specific gaps quickly."
    ],
    steps: [
      ["Define your north Derbyshire catchment", "We map where your patients come from across Chesterfield and the surrounding towns and villages."],
      ["Build local authority", "Google Business Profile, reviews, citations and location-relevant content so you appear across the S40–S45 area."],
      ["Promote your best treatments", "Treatment pages and targeted Google Ads for the work you most want to grow."],
      ["Convert and track", "A fast, compliant website with easy booking, and tracking that shows which enquiries came from where."]
    ],
    faqExtra: ["Do you cover practices outside Chesterfield town?", "Yes. We work with practices across north Derbyshire, including Staveley, Dronfield, Clay Cross, Bolsover and Wingerworth, and tailor targeting to where each practice's patients actually live."]
  }
};

function townFaqs(t) {
  const n = t.name;
  return [
    [`How much does dental marketing cost in ${n}?`, "Our dental SEO starts from £450/month, Google Ads management from £350/month per campaign, and web design from £150/month over 12 months. Ad spend is separate and agreed with you. We will recommend the mix that fits your practice and budget on a free strategy call."],
    [`How long before we see results in ${n}?`, "Google Ads can start producing enquiries within days of launch. SEO takes longer, with most practices seeing meaningful ranking and enquiry gains within three to six months. We report monthly so you can see progress from the start."],
    ["Do you guarantee rankings or patient numbers?", "No, and you should be cautious of anyone who does. Guaranteed-outcome claims conflict with advertising guidance. We commit to the work, the process and honest reporting of what it produces."],
    t.faqExtra
  ];
}

function townSection(t) {
  const n = t.name;
  const paras = t.market.map(p => `        <p>${escText(p)}</p>`).join("\n");
  const steps = t.steps.map(([a, b]) => `          <li><strong>${escText(a)}.</strong> ${escText(b)}</li>`).join("\n");
  return `<div class="wrap"><section>
    <div class="split">
      <div class="prose">
        <span class="eyebrow">The ${n} market</span>
        <h2 style="margin-top:8px">What makes dental marketing in ${n} different</h2>
${paras}
      </div>
      <div class="panel">
        <span class="eyebrow">Our approach</span>
        <h3 style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;margin:10px 0 14px">How we'd grow a ${n} practice</h3>
        <ol class="prose" style="padding-left:0;list-style:none">
${steps}
        </ol>
        <p style="color:var(--slate);margin-top:14px">Everything we produce stays within GDC and ASA advertising guidance, so growth never comes at the cost of your registration or reputation.</p>
      </div>
    </div>
  </section></div>

<div style="background:var(--mist)"><div class="wrap"><section>
    <div class="sec-head"><span class="eyebrow">Questions</span><h2>Dental marketing in ${n}: FAQs</h2></div>
    <div class="faq">
${faqDetails(townFaqs(t), "        ")}
    </div>
  </section></div></div>
`;
}

function migrateTownHub(file, html) {
  const key = (file.match(/^dental-marketing-([a-z]+)\.html$/) || [])[1];
  const t = key && TOWNS[key];
  if (!t) return html;
  if (html.includes(`What makes dental marketing in ${t.name} different`)) return html;
  const marker = '<div class="wrap"><section>\n    <div class="sec-head"><span class="eyebrow">Areas we cover</span>';
  if (!html.includes(marker)) return html;
  html = html.replace(marker, () => townSection(t) + "\n" + marker);
  return addToGraph(html, [faqPage(townFaqs(t))]);
}

// ---------------- homepage ----------------
const HOME_FAQ = [
  ["What does a dental marketing agency actually do?", "We help dental practices attract and convert the patients they want. In practice that means local SEO and Google Business Profile work, Google Ads for specific treatments, and websites built to turn visitors into booked appointments, all measured with call and form tracking."],
  ["Why choose a dental-only agency over a generalist?", "Dental marketing has its own economics and its own rules. We understand treatment values, how patients choose a dentist, and what the GDC and ASA allow in advertising, so you are not paying for a generalist to learn on your budget."],
  ["Which areas do you cover?", "We are based in South Yorkshire and work with practices across Sheffield, Doncaster, Rotherham, Barnsley and Chesterfield, as well as practices elsewhere in the UK."],
  ["How much does it cost?", "Dental SEO starts from £450/month, Google Ads management from £350/month per campaign, and web design from £150/month over 12 months. Ad spend is separate. A free strategy call is the best way to work out the right mix for your practice."],
  ["Do you guarantee results?", "No. Guaranteed rankings or patient numbers conflict with advertising guidance and are rarely honest. We commit to the work, a clear plan and transparent reporting of every enquiry we generate."]
];

function migrateHome(html) {
  if (html.includes("Why dental practices need specialist marketing")) return html;
  const marker = "<!-- LOCAL SERVICES -->";
  if (!html.includes(marker)) return html;
  const section = `<!-- WHY DENTAL-ONLY -->
<div class="wrap">
  <section>
    <div class="split">
      <div class="prose">
        <span class="eyebrow">Marketing for dentists</span>
        <h2 style="margin-top:8px">Why dental practices need specialist marketing</h2>
        <p>Most practices do not have a demand problem. People search for a dentist every day, for check-ups, emergencies, implants, aligners and whitening. The practices that win those patients are simply easier to find and easier to book with than the one down the road.</p>
        <p>Getting there takes more than a generic marketing package. A routine check-up and a full-arch implant case are completely different decisions for a patient, with different search terms, different questions and very different value to your practice. Your marketing has to reflect that, and it has to stay within GDC and ASA rules on claims, testimonials and before-and-after images.</p>
        <p>That is why we only work with dental practices. We combine <a href="seo.html">local SEO</a> to win the map pack, <a href="ppc.html">Google Ads</a> for the treatments you want more of, and <a href="web-design.html">conversion-focused websites</a> that turn visits into appointments. Every call and form is tracked, so you can see what the marketing produces.</p>
      </div>
      <div class="panel">
        <span class="eyebrow">What we focus on</span>
        <h3 style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;margin:10px 0 14px">Growth that holds up</h3>
        <ul class="prose" style="padding-left:0">
          <li>Visibility for high-value treatments, not just your practice name</li>
          <li>Google Business Profile and reviews that win local searches</li>
          <li>Websites that make booking easy on a phone</li>
          <li>Honest reporting on calls, forms and booked appointments</li>
          <li>Compliance with GDC and ASA guidance built in from day one</li>
        </ul>
      </div>
    </div>
  </section>
</div>

<!-- HOME FAQ -->
<div style="background:var(--mist)">
  <div class="wrap">
    <section>
      <div class="sec-head">
        <span class="eyebrow">Questions</span>
        <h2>Dental marketing FAQs</h2>
      </div>
      <div class="faq">
${faqDetails(HOME_FAQ, "        ")}
      </div>
    </section>
  </div>
</div>

`;
  html = html.replace(marker, () => section + marker);
  return addToGraph(html, [faqPage(HOME_FAQ)]);
}

// ---------------- about: founder / author ----------------
function migrateAbout(html) {
  if (html.includes('id="cristian-savulescu"')) return html;
  const marker = "<!-- WHY CHOOSE US -->";
  if (!html.includes(marker)) return html;
  const section = `<!-- FOUNDER -->
<div class="wrap" id="cristian-savulescu">
  <section>
    <div class="split">
      <div class="panel" style="display:flex;flex-direction:column;align-items:flex-start;gap:14px">
        <div style="width:72px;height:72px;border-radius:50%;background:var(--mist2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.4rem;color:var(--teal)">CS</div>
        <div>
          <h3 style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;margin:0">Cristian Savulescu</h3>
          <p style="color:var(--slate);margin:4px 0 0">Founder, Dental Marketing Pros</p>
        </div>
        <p style="color:var(--slate);margin:0">SEO and Google Ads strategist · South Yorkshire</p>
      </div>
      <div class="prose">
        <span class="eyebrow">Who you'll work with</span>
        <h2 style="margin-top:8px">Meet the founder</h2>
        <p>Dental Marketing Pros was founded by Cristian Savulescu, an SEO and Google Ads strategist based in South Yorkshire. Cristian leads the SEO, paid search and website strategy for the practices we support.</p>
        <p>He also oversees the guides in our <a href="resources.html">resources library</a>, covering local SEO, Google Ads, websites and the GDC and ASA rules that shape what dental practices can say in their marketing.</p>
      </div>
    </div>
  </section>
</div>

`;
  html = html.replace(marker, () => section + marker);
  return addToGraph(html, [{
    "@type": "Person",
    "@id": BASE + "/about.html#cristian-savulescu",
    "name": "Cristian Savulescu",
    "jobTitle": "Founder",
    "url": BASE + "/about.html#cristian-savulescu",
    "worksFor": { "@id": BASE + "/#org" },
    "knowsAbout": ["Search engine optimisation", "Google Ads", "Dental marketing", "Local SEO"]
  }]);
}

module.exports = function applyContentMigrations(file, html) {
  if (file === "index.html") return migrateHome(html);
  if (file === "about.html") return migrateAbout(html);
  if (/^dental-marketing-[a-z]+\.html$/.test(file)) return migrateTownHub(file, html);
  return html;
};
