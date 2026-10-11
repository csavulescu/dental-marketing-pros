/**
 * /api/enquiry — spam-filtered handler for the contact and free SEO audit forms.
 *
 * The forms post here instead of straight to FormSubmit, so the delivery
 * address never appears in the public HTML. Each submission goes through:
 *   1. honeypot fields (`_honey`, `url`) — bots that fill them are silently dropped
 *   2. time trap — submissions made within a few seconds of the page loading are dropped
 *   3. browser check — the form script must have run (plain scripted POSTs are refused)
 *   4. Google reCAPTCHA v3 — verified server-side when RECAPTCHA_SECRET_KEY is set
 *   5. field validation, link limits and a per-IP rate limit
 *   6. soft spam signals — delivered, but with "[Possible spam]" in the subject
 * Delivery of a submission that passes:
 *   - Resend (server-side email) when RESEND_API_KEY is set. Nothing about delivery
 *     is ever exposed to the browser, so this is the strongest setup.
 *   - Otherwise FormSubmit. FormSubmit sits behind a Cloudflare bot check that
 *     blocks server-to-server requests, so this function returns the FormSubmit
 *     delivery details only to submissions that passed every check, and the form
 *     script then posts them to FormSubmit from the visitor's browser.
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables):
 *   FORMSUBMIT_ENDPOINT   FormSubmit address or random-string alias that receives enquiries
 *   FORM_CC               optional. Comma-separated addresses to copy in
 *   RESEND_API_KEY        optional. Send through Resend instead of FormSubmit
 *   RESEND_FROM           with Resend: verified sender, e.g. "Website <forms@dentalmarketingpros.co.uk>"
 *   FORM_TO               with Resend: comma-separated recipient addresses
 *   RECAPTCHA_SITE_KEY    optional. reCAPTCHA v3 site key (public, served to the form script)
 *   RECAPTCHA_SECRET_KEY  optional. reCAPTCHA v3 secret key; when set, a valid token is required
 *   RECAPTCHA_MIN_SCORE   optional. Score below which a submission is dropped (default 0.5)
 */

const SITE = "https://dentalmarketingpros.co.uk";
const MIN_ELAPSED_MS = 3000;
const MAX_FIELD_LENGTH = 5000;
const MAX_LINKS = 2;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

const FORMS = {
  contact: {
    page: "/contact.html",
    subject: "Website enquiry",
    fields: ["name", "practice", "email", "phone", "service", "town", "message"],
    required: ["name", "email", "service", "message"],
  },
  audit: {
    page: "/free-seo-audit.html",
    subject: "Free SEO audit request",
    fields: ["name", "email", "website", "practice", "notes"],
    required: ["name", "email", "website"],
    extra: { request_type: "Free SEO audit" },
  },
};

const hits = new Map(); // ip -> [timestamps]; per-instance, best effort

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT.max;
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "");
  return fwd.split(",")[0].trim() || String(req.headers["x-real-ip"] || "") || "unknown";
}

function clean(value) {
  if (value == null) return "";
  return String(Array.isArray(value) ? value[0] : value).replace(/\u0000/g, "").trim();
}

function countLinks(text) {
  return (text.match(/https?:\/\/|www\.|\[url|<a\s/gi) || []).length;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function verifyRecaptcha(token, ip) {
  const params = new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET_KEY, response: token });
  if (ip && ip !== "unknown") params.set("remoteip", ip);
  const r = await fetch("https://www.google.com/recaptcha/api/siteverify", { method: "POST", body: params });
  return r.json();
}

function wantsJson(req) {
  return String(req.headers.accept || "").includes("application/json") ||
    String(req.headers["content-type"] || "").includes("application/json");
}

function errorPage(message, formPage) {
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>Message not sent | Dental Marketing Pros</title><link rel="stylesheet" href="/style.css"></head><body><div class="wrap"><section style="max-width:640px;margin:60px auto"><h1 style="font-family:'Plus Jakarta Sans';font-size:1.8rem;margin-bottom:12px">Sorry, your message wasn't sent</h1><p>${message}</p><p style="margin-top:16px">You can also call us on <a href="tel:01246922127">01246 922127</a> or email <a href="mailto:hello@dentalmarketingpros.co.uk">hello@dentalmarketingpros.co.uk</a>.</p><p style="margin-top:24px"><a class="btn btn-primary" href="${formPage}">Back to the form</a></p></section></div></body></html>`;
}

module.exports = async function handler(req, res) {
  // GET returns the public config the form script needs.
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || null });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const json = wantsJson(req);
  const body = typeof req.body === "object" && req.body ? req.body : {};
  const form = FORMS[clean(body._form)] || FORMS.contact;
  const ip = clientIp(req);

  // Success that delivers nothing — used for obvious bots so they learn nothing.
  const silentOk = (reason) => {
    console.log(`[enquiry] dropped (${reason}) ip=${ip} form=${clean(body._form)}`);
    if (json) return res.status(200).json({ ok: true, redirect: "/thank-you.html" });
    res.statusCode = 303;
    res.setHeader("Location", "/thank-you.html");
    return res.end();
  };
  const fail = (status, message, reason) => {
    console.log(`[enquiry] refused (${reason}) ip=${ip} form=${clean(body._form)}`);
    if (json) return res.status(status).json({ ok: false, error: message });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(status).send(errorPage(message, form.page));
  };

  // 1. honeypot
  if (clean(body._honey) || clean(body.url)) return silentOk("honeypot");

  // 2 + 3. the form script must have run, and the visitor must have spent a few seconds on the page
  const elapsed = Number(clean(body._elapsed));
  if (!clean(body._form) || !Number.isFinite(elapsed)) {
    return fail(400, "Our form needs JavaScript switched on to protect against spam. Please enable it and try again.", "no-script");
  }
  if (elapsed < MIN_ELAPSED_MS) return silentOk(`too-fast ${elapsed}ms`);

  // 5a. rate limit
  if (rateLimited(ip)) return fail(429, "We've received several messages from you in a short time. Please wait a few minutes and try again.", "rate-limit");

  // 4. reCAPTCHA v3
  let recaptchaNote = "not configured";
  if (process.env.RECAPTCHA_SECRET_KEY) {
    const token = clean(body._recaptcha);
    if (!token) return fail(400, "We couldn't complete our spam check. Please refresh the page and try again.", "recaptcha-missing");
    let result;
    try {
      result = await verifyRecaptcha(token, ip);
    } catch (e) {
      console.error("[enquiry] reCAPTCHA verify error", e);
      result = null;
    }
    if (result) {
      const minScore = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5);
      if (!result.success) return fail(400, "Our spam check expired. Please refresh the page and try again.", `recaptcha-invalid ${JSON.stringify(result["error-codes"] || [])}`);
      if (result.action && result.action !== "enquiry") return silentOk(`recaptcha-action ${result.action}`);
      if (typeof result.score === "number" && result.score < minScore) return silentOk(`recaptcha-score ${result.score}`);
      recaptchaNote = `passed (score ${result.score})`;
    } else {
      recaptchaNote = "unavailable (Google did not respond), delivered anyway";
    }
  }

  // 5b. validate fields
  const data = {};
  for (const key of form.fields) {
    const value = clean(body[key]);
    if (value.length > MAX_FIELD_LENGTH) return fail(400, "One of your answers is too long. Please shorten it and try again.", `too-long ${key}`);
    data[key] = value;
  }
  for (const key of form.required) {
    if (!data[key]) return fail(400, "Please fill in all the required fields.", `missing ${key}`);
  }
  if (!EMAIL_RE.test(data.email)) return fail(400, "Please check your email address.", "bad-email");

  const freeText = [data.message, data.notes, data.name, data.practice, data.town].filter(Boolean).join("\n");
  if (countLinks(freeText) > MAX_LINKS) return silentOk("too-many-links");
  if (/<\/?[a-z][^>]*>/i.test(data.name || "")) return silentOk("html-in-name");

  // 6. soft signals: deliver, but flag in the subject so they're easy to filter
  const flags = [];
  if (data.practice && data.name && data.practice.toLowerCase() === data.name.toLowerCase()) flags.push("practice name same as person's name");
  if (/^i would like more information\.? please contact me/i.test(data.message || "")) flags.push("template message");
  if (/[Ѐ-ӿ一-鿿]/.test(freeText)) flags.push("non-Latin script");

  const subject = `${flags.length ? "[Possible spam] " : ""}${form.subject}: ${data.name}`.slice(0, 200);

  const fields = {
    ...data,
    ...(form.extra || {}),
    spam_check: flags.length ? `flagged: ${flags.join("; ")}` : "passed",
    recaptcha: recaptchaNote,
  };
  const ok = (extra) => {
    console.log(`[enquiry] accepted form=${clean(body._form)} flags=${flags.length} recaptcha=${recaptchaNote} via=${extra ? "formsubmit" : "resend"}`);
    if (json) return res.status(200).json({ ok: true, redirect: "/thank-you.html", ...(extra || {}) });
    res.statusCode = 303;
    res.setHeader("Location", "/thank-you.html");
    return res.end();
  };

  // Delivery option 1: Resend, entirely server-side.
  if (process.env.RESEND_API_KEY) {
    const to = String(process.env.FORM_TO || "").split(",").map((x) => x.trim()).filter(Boolean);
    const cc = String(process.env.FORM_CC || "").split(",").map((x) => x.trim()).filter(Boolean);
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const rows = Object.entries(fields).filter(([, v]) => v)
      .map(([k, v]) => `<tr><td style="border:1px solid #ddd;padding:8px;font-weight:bold;vertical-align:top">${esc(k)}</td><td style="border:1px solid #ddd;padding:8px;white-space:pre-wrap">${esc(v)}</td></tr>`).join("");
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM, to, cc: cc.length ? cc : undefined, reply_to: data.email, subject,
          html: `<p>New submission from ${SITE}${form.page}</p><table style="border-collapse:collapse;font-family:Arial,sans-serif">${rows}</table>`,
        }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status} ${(await r.text()).slice(0, 300)}`);
    } catch (e) {
      console.error("[enquiry] Resend failed", e);
      return fail(502, "We couldn't send your message just now.", "resend-error");
    }
    return ok();
  }

  // Delivery option 2: FormSubmit, posted by the visitor's browser (see note at the top).
  const endpoint = process.env.FORMSUBMIT_ENDPOINT;
  if (!endpoint) {
    console.error("[enquiry] no delivery configured: set FORMSUBMIT_ENDPOINT or RESEND_API_KEY");
    return fail(500, "Our form is temporarily unavailable.", "no-endpoint");
  }
  if (!json) return fail(400, "Our form needs JavaScript switched on to protect against spam. Please enable it and try again.", "no-script-delivery");
  const deliver = {
    action: `https://formsubmit.co/${endpoint.trim()}`,
    fields: {
      ...fields,
      _subject: subject,
      _template: "table",
      _captcha: "false",
      _replyto: data.email,
      _next: `${SITE}/thank-you.html`,
      ...(process.env.FORM_CC ? { _cc: process.env.FORM_CC } : {}),
    },
  };
  return ok({ deliver });
};
