# Managed page sources

The `.html` files in this folder are the sources for pages that
`autoblog/scripts/build-pages.js` renders into the site root: `geo.html`,
`ai-websites.html`, `free-seo-audit.html` and the `dental-geo-[town].html` pages.

- Edit the source here, not the generated page in the site root. The generated
  page is overwritten on every run of `seo-maintain.js`.
- Each file starts with a JSON header (title, description, breadcrumb, service
  schema, FAQs, CTA), followed by the page body. `<!--faqs-->` marks where the
  FAQ section renders.
- `published.json` records when each page first went live. Don't edit it by hand.
- Pushing a change here to `main` runs the SEO maintenance workflow, which
  rebuilds the pages and deploys them.
