// Inboxer: one inbox for Gmail, Socialer, your other apps' unread counts and today's reminders,
// sorted by J.A.R.V.I.S. into needs-you / FYI / junk, with replies drafted for what needs you.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
  let data = null, tab = 'needs';
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 0 ? new Date(t).toLocaleString() : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
  let toastTimer;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600); };

  async function load(fresh) {
    document.body.classList.add('busy');
    $('#sub').textContent = 'Checking Gmail, Socialer and your reminders…';
    try {
      data = await fetch('/api/inbox' + (fresh ? '?fresh=1' : '')).then((r) => r.json());
      if (data.error) throw new Error(data.error);
      render();
    } catch (e) {
      $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
    document.body.classList.remove('busy');
  }

  function render() {
    const n = (b) => data.items.filter((i) => i.bucket === b).length;
    const appTotal = Object.values(data.apps || {}).reduce((a, x) => a + x, 0);
    $('#sub').textContent = `${n('needs')} need you · ${n('fyi')} FYI · ${n('junk')} junk${data.triageError ? ' · couldn’t sort some: ' + data.triageError : ''} · updated ${new Date(data.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    $('#sources').innerHTML = `
      <div class="card src"><span class="ic" style="background:#ea4335">M</span><div><b>Gmail</b><small>${data.gmail ? 'Connected' : 'Not connected'}</small></div>${data.gmail ? '<button class="btn small" data-gmail="disconnect">Disconnect</button>' : '<button class="btn small primary" data-gmail="connect">Connect</button>'}</div>
      <div class="card src"><span class="ic" style="background:linear-gradient(135deg,#a9bcff,#ff7aa8);color:#0b0c10">S</span><div><b>Socialer</b><small>${data.socialer ? 'Connected' : 'Open Socialer to include it'}</small></div></div>
      <div class="card src"><span class="ic" style="background:linear-gradient(45deg,#f9a03f,#e1306c,#833ab4)">◎</span><div><b>Instagram · Snapchat · TikTok</b><small>${data.socialer ? (appTotal ? Object.entries(data.apps).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') : 'Nothing unread') : 'Counts come from Socialer’s sidebar'}</small></div></div>`;
    document.querySelectorAll('[data-gmail]').forEach((b) => (b.onclick = async () => {
      await post('/api/inbox/gmail', { action: b.dataset.gmail });
      if (b.dataset.gmail === 'connect') toast('Sign in to Google in the window that opened, then press Refresh.');
      else load(true);
    }));
    $('#tabs').innerHTML = [['needs', 'Needs you'], ['fyi', 'FYI'], ['junk', 'Junk']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}<b>${n(k)}</b></button>`).join('');
    document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
    const list = data.items.filter((i) => i.bucket === tab);
    if (!list.length) {
      $('#list').innerHTML = `<div class="empty">${tab === 'needs' ? 'Nothing needs you right now. Nice.' : 'Nothing here.'}${!data.gmail ? '<br>Connect Gmail above to bring your email in.' : ''}</div>`;
      return;
    }
    const TAG = { Gmail: 'M', Socialer: 'S', Reminder: '⏰' };
    $('#list').innerHTML = list.map((i, k) => `
      <article class="card item b-${i.bucket}" data-k="${k}">
        <span class="tag">${TAG[i.source] || '•'}</span>
        <div class="top"><b>${esc(i.from)}</b><small>${esc(i.source)} · ${ago(i.at)}</small></div>
        <div class="acts">${i.source !== 'Reminder' ? '<button class="btn small" data-act="open">Open</button>' : ''}${i.source !== 'Reminder' ? '<button class="btn small" data-act="done">Done</button>' : ''}</div>
        <div><div class="subj">${esc(i.subject)}</div>${i.snippet ? `<div class="snip">${esc(i.snippet)}</div>` : ''}${i.why ? `<span class="why">${esc(i.why)}</span>` : ''}</div>
        ${i.reply ? `<div class="reply"><textarea class="field">${esc(i.reply)}</textarea><div class="row"><span>Drafted by J.A.R.V.I.S. · edit it first if you like</span><button class="btn small" data-act="copy">Copy</button>${i.source === 'Socialer' ? '<button class="btn small primary" data-act="send">Send</button>' : ''}</div></div>` : ''}
      </article>`).join('');
    document.querySelectorAll('.item').forEach((el) => {
      const item = list[+el.dataset.k];
      el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
        const act = b.dataset.act;
        try {
          if (act === 'open') await post('/api/inbox/open', { item });
          if (act === 'done') { await post('/api/inbox/dismiss', { id: item.id }); data.items = data.items.filter((x) => x.id !== item.id); render(); }
          if (act === 'copy') { await navigator.clipboard.writeText(el.querySelector('textarea').value); toast(item.source === 'Gmail' ? 'Copied. Open the email and paste your reply.' : 'Copied'); }
          if (act === 'send') {
            b.disabled = true;
            const r = await post('/api/inbox/reply', { chat: item.chat, text: el.querySelector('textarea').value });
            await post('/api/inbox/dismiss', { id: item.id });
            toast(`Sent to ${r.to || item.from}`);
            data.items = data.items.filter((x) => x.id !== item.id);
            render();
          }
        } catch (e) { toast(e.message); b.disabled = false; }
      }));
    });
  }

  $('#refresh').onclick = () => load(true);
  addEventListener('focus', () => data && Date.now() - data.updated > 120000 && load(false));
  load(false);
})();
