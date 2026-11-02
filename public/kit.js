// Small helpers shared by the J.A.R.V.I.S. OS app pages.
window.kit = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const get = (url) => fetch(url).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
  let timer;
  const toast = (m) => {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
    t.textContent = m; t.hidden = false;
    clearTimeout(timer); timer = setTimeout(() => (t.hidden = true), 2800);
  };
  const md = (s) => esc(s).split(/\n{2,}/).map((p) => /^\s*([-*•]|\d+[.)])\s/.test(p) ? `<ul>${p.split('\n').map((l) => `<li>${l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}</li>`).join('')}</ul>` : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
  const busy = (on) => document.body.classList.toggle('busy', on);
  return { $, $$, esc, get, post, toast, md, ago, size, busy };
})();
