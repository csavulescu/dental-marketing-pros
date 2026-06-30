/* GDPR cookie consent for Dental Marketing Pros (Elite Talent Media LTD)
   - Analytics (Vercel Web Analytics + Speed Insights) load ONLY after the
     visitor accepts. Reject => nothing non-essential loads.
   - Choice stored in localStorage (strictly necessary).
   - window.openCookieSettings() reopens the banner so consent can be changed. */
(function () {
  var KEY = 'dmp_cookie_consent';

  function loadAnalytics() {
    if (window.__dmpAnalytics) return;
    window.__dmpAnalytics = true;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    var a = document.createElement('script'); a.defer = true; a.src = '/_vercel/insights/script.js';
    document.head.appendChild(a);
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
    var s = document.createElement('script'); s.defer = true; s.src = '/_vercel/speed-insights/script.js';
    document.head.appendChild(s);
  }

  function injectStyles() {
    if (document.getElementById('dmp-cc-style')) return;
    var css =
      '#dmp-cc{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;' +
      'background:#fff;border:1px solid #e3e9e9;border-radius:14px;box-shadow:0 18px 50px -20px rgba(6,61,61,.4);' +
      "padding:20px 22px;font-family:'Inter',system-ui,sans-serif;color:#0f2e2e}" +
      '#dmp-cc h4{font-family:\'Plus Jakarta Sans\',sans-serif;font-size:1rem;font-weight:800;margin:0 0 6px}' +
      '#dmp-cc p{font-size:.85rem;line-height:1.5;color:#52606a;margin:0 0 14px}' +
      '#dmp-cc a{color:#0d7a7a;font-weight:600;text-decoration:underline}' +
      '#dmp-cc .dmp-cc-btns{display:flex;gap:10px;flex-wrap:wrap}' +
      '#dmp-cc button{flex:1;min-width:120px;border:none;border-radius:9px;padding:11px 16px;font-size:.9rem;' +
      "font-weight:600;cursor:pointer;font-family:'Inter',sans-serif}" +
      '#dmp-cc .dmp-accept{background:#0d7a7a;color:#fff}#dmp-cc .dmp-accept:hover{background:#0a5e5e}' +
      '#dmp-cc .dmp-reject{background:#f3f7f7;color:#0f2e2e;border:1px solid #e3e9e9}#dmp-cc .dmp-reject:hover{background:#eaf3f3}';
    var st = document.createElement('style'); st.id = 'dmp-cc-style'; st.textContent = css;
    document.head.appendChild(st);
  }

  function close() { var b = document.getElementById('dmp-cc'); if (b) b.remove(); }

  function showBanner() {
    injectStyles();
    if (document.getElementById('dmp-cc')) return;
    var d = document.createElement('div');
    d.id = 'dmp-cc';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Cookie consent');
    d.innerHTML =
      '<h4>We value your privacy</h4>' +
      '<p>We use a strictly necessary cookie to remember this choice, and privacy-friendly, cookieless analytics to understand how the site is used. ' +
      'Analytics only run if you accept. See our <a href="cookies.html">Cookie Policy</a>.</p>' +
      '<div class="dmp-cc-btns">' +
      '<button class="dmp-accept" type="button">Accept analytics</button>' +
      '<button class="dmp-reject" type="button">Reject non-essential</button>' +
      '</div>';
    document.body.appendChild(d);
    d.querySelector('.dmp-accept').addEventListener('click', function () {
      try { localStorage.setItem(KEY, 'accepted'); } catch (e) {}
      close(); loadAnalytics();
    });
    d.querySelector('.dmp-reject').addEventListener('click', function () {
      try { localStorage.setItem(KEY, 'rejected'); } catch (e) {}
      close();
    });
  }

  var consent = null;
  try { consent = localStorage.getItem(KEY); } catch (e) {}

  if (consent === 'accepted') loadAnalytics();
  else if (consent !== 'rejected') {
    if (document.body) showBanner();
    else document.addEventListener('DOMContentLoaded', showBanner);
  }

  window.openCookieSettings = function () {
    if (document.body) showBanner();
    else document.addEventListener('DOMContentLoaded', showBanner);
  };
})();
