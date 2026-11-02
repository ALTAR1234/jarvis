// Persistent long-term memory and reminders (JSON files in the app data folder), plus the event bus that
// pushes tool activity, confirmation requests, and due reminders to the dashboard over Server-Sent Events.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dir = null;
const file = (name) => path.join(dir, name);
function load(name) { try { const v = JSON.parse(fs.readFileSync(file(name), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
function save(name, list) { fs.writeFileSync(file(name), JSON.stringify(list, null, 2), { mode: 0o600 }); }
const id = () => crypto.randomBytes(4).toString('hex');

// ---------- events ----------
const clients = new Set();
function subscribe(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => { clearInterval(ping); clients.delete(res); });
}
function emit(type, data = {}) { const line = `data: ${JSON.stringify({ type, ...data })}\n\n`; for (const c of clients) c.write(line); }

// ---------- confirmations ----------
const pending = new Map();
function requestConfirm({ tool, summary, detail, callId }) {
  const cid = id();
  return new Promise((resolve) => {
    if (!clients.size) { resolve(false); return; }
    const timer = setTimeout(() => settle(cid, false, 'timeout'), 60000);
    pending.set(cid, { resolve, timer, callId });
    emit('confirm', { id: cid, tool, summary, detail });
  });
}
function settle(cid, allow, reason) {
  const p = pending.get(cid); if (!p) return false;
  clearTimeout(p.timer); pending.delete(cid); p.resolve(Boolean(allow));
  emit('confirmResolved', { id: cid, allow: Boolean(allow), reason });
  return true;
}
function cancelConfirmsForCalls(callIds) { for (const [cid, p] of pending) if (callIds.includes(p.callId)) settle(cid, false, 'cancelled'); }

// ---------- memory ----------
function memories() { return load('memory.json'); }
function remember(text) {
  const fact = String(text || '').trim().slice(0, 500);
  if (!fact) throw new Error('Nothing to remember.');
  const list = memories();
  const dup = list.find((m) => m.text.toLowerCase() === fact.toLowerCase());
  if (dup) return { id: dup.id, text: dup.text, note: 'Already remembered.' };
  const item = { id: id(), text: fact, created: new Date().toISOString() };
  list.push(item); while (list.length > 300) list.shift();
  save('memory.json', list); emit('memory');
  return item;
}
function scoreFact(text, query) {
  const words = String(query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const t = text.toLowerCase(); return words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
}
function recall(query) {
  const list = memories();
  if (!query) return list.slice(-30);
  return list.map((m) => ({ m, s: scoreFact(m.text, query) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 15).map((x) => x.m);
}
function forget(idOrText) {
  const list = memories(), key = String(idOrText || '').trim();
  let idx = list.findIndex((m) => m.id === key);
  if (idx < 0) { const best = list.map((m, i) => ({ i, s: scoreFact(m.text, key) })).sort((a, b) => b.s - a.s)[0]; if (best?.s) idx = best.i; }
  if (idx < 0) throw new Error('No matching memory found.');
  const [removed] = list.splice(idx, 1); save('memory.json', list); emit('memory');
  return removed;
}

// ---------- reminders ----------
function reminders() { return load('reminders.json').sort((a, b) => a.due.localeCompare(b.due)); }
function parseDue({ minutes, time }) {
  if (Number.isFinite(Number(minutes)) && Number(minutes) > 0) return new Date(Date.now() + Number(minutes) * 60000);
  const t = String(time || '').trim();
  const hm = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (hm) {
    let h = Number(hm[1]) % (hm[3] ? 12 : 24); if (/pm/i.test(hm[3] || '')) h += 12;
    const d = new Date(); d.setHours(h, Number(hm[2] || 0), 0, 0);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    return d;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime()) && d > new Date()) return d;
  throw new Error('Give either minutes from now, a clock time like "17:30" or "5:30 pm", or a future date-time.');
}
function addReminder({ text, minutes, time }) {
  const msg = String(text || '').trim().slice(0, 300);
  if (!msg) throw new Error('What should the reminder say?');
  const item = { id: id(), text: msg, due: parseDue({ minutes, time }).toISOString() };
  const list = load('reminders.json'); list.push(item); save('reminders.json', list); emit('reminders');
  return { ...item, dueLocal: new Date(item.due).toLocaleString() };
}
function cancelReminder(idOrText) {
  const list = load('reminders.json'), key = String(idOrText || '').toLowerCase();
  const idx = list.findIndex((r) => r.id === key || r.text.toLowerCase().includes(key));
  if (idx < 0) throw new Error('No matching reminder.');
  const [removed] = list.splice(idx, 1); save('reminders.json', list); emit('reminders');
  return removed;
}
function startReminderLoop(onDue) {
  setInterval(() => {
    const list = load('reminders.json'); if (!list.length) return;
    const now = new Date().toISOString(), due = list.filter((r) => r.due <= now);
    if (!due.length) return;
    save('reminders.json', list.filter((r) => r.due > now)); emit('reminders');
    for (const r of due) onDue(r);
  }, 5000).unref?.();
}

function init(dataDir) { dir = dataDir; fs.mkdirSync(dir, { recursive: true }); }

module.exports = { init, subscribe, emit, requestConfirm, settle, cancelConfirmsForCalls, memories, remember, recall, forget, reminders, addReminder, cancelReminder, startReminderLoop };
