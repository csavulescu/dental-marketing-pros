/* Spam protection for the enquiry forms (contact + free SEO audit).
 * Sends submissions to /api/enquiry with a reCAPTCHA v3 token (when configured)
 * and the time spent on the page, then shows the thank-you page or an inline error.
 * Forms opt in with data-dmp-form="contact" or data-dmp-form="audit". */
(function () {
  var forms = Array.prototype.slice.call(document.querySelectorAll("form[data-dmp-form]"));
  if (!forms.length || !window.fetch) return;

  var loadedAt = Date.now();
  var siteKey = null;
  var recaptchaReady = null;

  var config = fetch("/api/enquiry", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (c) { siteKey = c && c.recaptchaSiteKey; return siteKey; })
    .catch(function () { return null; });

  function loadRecaptcha() {
    if (recaptchaReady) return recaptchaReady;
    recaptchaReady = config.then(function (key) {
      if (!key) return null;
      return new Promise(function (resolve) {
        var s = document.createElement("script");
        s.src = "https://www.google.com/recaptcha/api.js?render=" + encodeURIComponent(key);
        s.async = true;
        s.onload = function () { window.grecaptcha.ready(function () { resolve(window.grecaptcha); }); };
        s.onerror = function () { resolve(null); };
        document.head.appendChild(s);
        forms.forEach(function (f) {
          var note = f.querySelector(".form-recaptcha-note");
          if (note) note.hidden = false;
        });
      });
    });
    return recaptchaReady;
  }

  function getToken() {
    return loadRecaptcha().then(function (g) {
      if (!g || !siteKey) return "";
      return g.execute(siteKey, { action: "enquiry" }).catch(function () { return ""; });
    });
  }

  // GA4 conversion via GTM: push generate_lead, then continue once GTM has handled it (or after 1.2s).
  function trackLead(form, done) {
    var called = false;
    function go() { if (!called) { called = true; done(); } }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "generate_lead",
      form_name: form.getAttribute("data-dmp-form") || "enquiry",
      eventCallback: go,
      eventTimeout: 1200
    });
    setTimeout(go, 1500);
  }

  function showError(form, msg) {
    var box = form.querySelector(".form-error");
    if (!box) {
      box = document.createElement("p");
      box.className = "form-error";
      box.setAttribute("role", "alert");
      box.style.cssText = "color:#b42318;background:#fef3f2;border:1px solid #fecdca;border-radius:8px;padding:10px 12px;margin:0 0 14px;font-size:.92rem";
      var btn = form.querySelector('button[type="submit"]');
      form.insertBefore(box, btn);
    }
    box.textContent = msg;
  }

  forms.forEach(function (form) {
    // Load reCAPTCHA as soon as someone starts filling in the form (keeps page speed unaffected).
    form.addEventListener("focusin", loadRecaptcha, { once: true });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

      getToken().then(function (token) {
        var data = {};
        new FormData(form).forEach(function (v, k) { data[k] = v; });
        data._form = form.getAttribute("data-dmp-form");
        data._elapsed = String(Date.now() - loadedAt);
        data._recaptcha = token || "";
        return fetch(form.getAttribute("action") || "/api/enquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(data),
        });
      }).then(function (r) {
        return r.json().catch(function () { return { ok: false }; });
      }).then(function (out) {
        if (out && out.ok && out.deliver) {
          // Passed every check: hand the enquiry to FormSubmit from this browser.
          var f = document.createElement("form");
          f.method = "POST";
          f.action = out.deliver.action;
          f.style.display = "none";
          Object.keys(out.deliver.fields).forEach(function (k) {
            var i = document.createElement("input");
            i.type = "hidden";
            i.name = k;
            i.value = out.deliver.fields[k];
            f.appendChild(i);
          });
          document.body.appendChild(f);
          trackLead(form, function () { f.submit(); });
          return;
        }
        if (out && out.ok) {
          trackLead(form, function () { window.location.href = out.redirect || "/thank-you.html"; });
          return;
        }
        showError(form, (out && out.error) || "Sorry, something went wrong. Please try again, or call us on 01246 922127.");
        if (btn) { btn.disabled = false; btn.textContent = label; }
      }).catch(function () {
        showError(form, "Sorry, we couldn't send your message. Please check your connection and try again, or call us on 01246 922127.");
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
    });
  });
})();
