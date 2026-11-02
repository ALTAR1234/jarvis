// Helper: add an assignment (typed, or a photo/PDF of the worksheet), get a step plan with
// reminders, tick steps off, ask J.A.R.V.I.S. to explain a step, and take a practice quiz.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
  const md = (s) => esc(s).split(/\n{2,}/).map((p) => /^\s*([-*•]|\d+[.)])\s/.test(p) ? `<ul>${p.split('\n').map((l) => `<li>${l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}</li>`).join('')}</ul>` : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let items = [], current = null, upload = null, quiz = null;
  let toastTimer;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800); };
  const busy = (on) => document.body.classList.toggle('busy', on);

  // ---------- add ----------
  const due = new Date(Date.now() + 3 * 86400000);
  $('#due').value = due.toISOString().slice(0, 10);
  const drop = $('#drop');
  drop.onclick = () => $('#file').click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); };
  $('#file').onchange = () => $('#file').files[0] && pickFile($('#file').files[0]);
  function pickFile(f) {
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(f.type)) return toast('Use a photo (PNG or JPG) or a PDF.');
    if (f.size > 8 * 1024 * 1024) return toast('That file is too big (8 MB at most).');
    const r = new FileReader();
    r.onload = () => {
      upload = { name: f.name, type: f.type, data: String(r.result).split(',')[1] };
      drop.classList.add('has');
      drop.innerHTML = (f.type.startsWith('image/') ? `<img src="${r.result}" alt="">` : '<b>📄</b>') + `<span>${esc(f.name)} · click to change</span>`;
    };
    r.readAsDataURL(f);
  }
  $('#add').onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#title').value.trim(), notes = $('#notes').value.trim();
    if (!title && !notes && !upload) return toast('Type what the assignment is, or drop in a photo or PDF.');
    busy(true);
    $('#make').disabled = true;
    $('#make').textContent = 'J.A.R.V.I.S. is planning…';
    try {
      const item = await post('/api/helper/add', { title, notes, due: $('#due').value, file: upload });
      $('#title').value = $('#notes').value = '';
      upload = null;
      drop.classList.remove('has');
      drop.innerHTML = '<input type="file" id="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden><b>Drop a photo or PDF of the worksheet</b><span>or click to pick one · optional</span>';
      $('#file').onchange = () => $('#file').files[0] && pickFile($('#file').files[0]);
      toast(`Planned “${item.title}”${item.reminders.length ? ` · ${item.reminders.length} reminder${item.reminders.length > 1 ? 's' : ''} set` : ''}`);
      await load(item.id);
    } catch (err) { toast(err.message); }
    $('#make').disabled = false;
    $('#make').textContent = 'Make my plan';
    busy(false);
  };

  // ---------- list ----------
  async function load(select) {
    items = (await fetch('/api/helper').then((r) => r.json())).items || [];
    current = items.find((i) => i.id === (select || current?.id)) || items[0] || null;
    quiz = null;
    renderList();
    renderDetail();
  }
  const dueText = (iso) => {
    const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
    return days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
  };
  function renderList() {
    $('#list').innerHTML = items.length ? items.map((i) => {
      const done = i.steps.filter((s) => s.done).length, pct = i.steps.length ? Math.round((done / i.steps.length) * 100) : 0;
      return `<button class="card a-card${i.id === current?.id ? ' on' : ''}" data-id="${i.id}"><span class="subj">${esc(i.subject)}</span><b>${esc(i.title)}</b><small class="${/late/.test(dueText(i.due)) && pct < 100 ? 'late' : ''}">${dueText(i.due)} · ${done}/${i.steps.length} steps</small><div class="bar"><i style="width:${pct}%"></i></div></button>`;
    }).join('') : '';
    document.querySelectorAll('.a-card').forEach((b) => (b.onclick = () => { current = items.find((i) => i.id === b.dataset.id); quiz = null; renderList(); renderDetail(); }));
  }

  // ---------- one assignment ----------
  function renderDetail() {
    const d = $('#detail');
    if (!current) { d.innerHTML = '<div class="empty">Add an assignment above to get a plan, reminders and a practice quiz.</div>'; return; }
    const it = current;
    const dayLabel = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : x.toLocaleDateString([], { weekday: 'long' }); };
    const start = new Date(it.created); start.setHours(0, 0, 0, 0);
    const offset = Math.round((new Date().setHours(0, 0, 0, 0) - start) / 86400000);
    d.innerHTML = `
      <h2>${esc(it.title)}</h2>
      <div class="meta">${esc(it.subject)} · ${dueText(it.due)} (${new Date(it.due).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })})${it.source ? ' · from ' + esc(it.source) : ''}</div>
      ${it.summary ? `<p>${esc(it.summary)}</p>` : ''}
      <h3>Your plan</h3>
      ${it.steps.map((s, k) => `<div class="step${s.done ? ' done' : ''}" data-k="${k}"><input type="checkbox"${s.done ? ' checked' : ''}><div><span>${esc(s.text)}</span><small>${dayLabel(s.day - offset)} · about ${s.minutes} min</small></div><button class="btn small" data-explain>Explain</button></div>`).join('')}
      <div class="ask"><input class="field" id="q" placeholder="Stuck? Ask J.A.R.V.I.S. anything about this assignment"><button class="btn" id="ask">Ask</button></div>
      <div id="answer"></div>
      <h3>Practice quiz</h3>
      <div id="quiz"></div>
      <div class="foot"><button class="btn small" id="newquiz">New questions</button><span style="flex:1"></span><button class="btn small danger" id="del">Delete assignment</button></div>`;
    d.querySelectorAll('.step').forEach((el) => {
      const k = +el.dataset.k;
      el.querySelector('input').onchange = async (e) => {
        current = await post('/api/helper/step', { id: it.id, index: k, done: e.target.checked });
        items = items.map((x) => (x.id === current.id ? current : x));
        if (current.steps.every((s) => s.done)) toast('All done! Nice work.');
        renderList(); renderDetail();
      };
      el.querySelector('[data-explain]').onclick = async (e) => {
        const btn = e.target;
        el.querySelector('.explain')?.remove();
        btn.disabled = true; btn.textContent = 'Thinking…'; busy(true);
        try {
          const { text } = await post('/api/helper/explain', { id: it.id, index: k });
          el.insertAdjacentHTML('beforeend', `<div class="explain md">${md(text)}</div>`);
        } catch (err) { toast(err.message); }
        btn.disabled = false; btn.textContent = 'Explain'; busy(false);
      };
    });
    const ask = async () => {
      const q = $('#q').value.trim();
      if (!q) return;
      busy(true);
      $('#answer').innerHTML = '<div class="explain">Thinking…</div>';
      try { const { text } = await post('/api/helper/explain', { id: it.id, index: -1, question: q }); $('#answer').innerHTML = `<div class="explain md">${md(text)}</div>`; }
      catch (err) { $('#answer').innerHTML = ''; toast(err.message); }
      busy(false);
    };
    $('#ask').onclick = ask;
    $('#q').onkeydown = (e) => e.key === 'Enter' && ask();
    $('#newquiz').onclick = async () => { busy(true); try { current = await post('/api/helper/quiz', { id: it.id }); items = items.map((x) => (x.id === current.id ? current : x)); quiz = null; renderDetail(); } catch (err) { toast(err.message); } busy(false); };
    $('#del').onclick = async () => { if (!confirm(`Delete “${it.title}” and its reminders?`)) return; await post('/api/helper/delete', { id: it.id }); current = null; load(); };
    renderQuiz();
  }

  function renderQuiz() {
    const box = $('#quiz'), qs = current.quiz || [];
    if (!qs.length) { box.innerHTML = '<div class="quiz">No questions yet. Press “New questions”.</div>'; return; }
    if (!quiz) { box.innerHTML = `<div class="quiz"><div class="q">${qs.length} questions on the skills in this assignment.</div><button class="btn primary" id="start">Quiz me</button></div>`; $('#start').onclick = () => { quiz = { i: 0, score: 0, picked: null }; renderQuiz(); }; return; }
    if (quiz.i >= qs.length) {
      box.innerHTML = `<div class="quiz"><div class="q">You got ${quiz.score} of ${qs.length}${quiz.score === qs.length ? '. Perfect!' : quiz.score >= qs.length * 0.6 ? '. Solid.' : '. Worth another look at the steps above.'}</div><button class="btn" id="again">Try again</button></div>`;
      $('#again').onclick = () => { quiz = { i: 0, score: 0, picked: null }; renderQuiz(); };
      return;
    }
    const q = qs[quiz.i];
    box.innerHTML = `<div class="quiz"><div class="q">${quiz.i + 1}. ${esc(q.q)}</div>${q.choices.map((c, k) => `<button class="choice${quiz.picked != null ? (k === q.answer ? ' right' : k === quiz.picked ? ' wrong' : '') : ''}" data-k="${k}">${esc(c)}</button>`).join('')}
      ${quiz.picked != null ? `<div class="why">${esc(q.explain)}</div>` : ''}
      <div class="nav"><span>Score ${quiz.score}/${qs.length}</span>${quiz.picked != null ? '<button class="btn small primary" id="next">Next</button>' : ''}</div></div>`;
    box.querySelectorAll('.choice').forEach((b) => (b.onclick = () => { if (quiz.picked != null) return; quiz.picked = +b.dataset.k; if (quiz.picked === q.answer) quiz.score++; renderQuiz(); }));
    $('#next')?.addEventListener('click', () => { quiz.i++; quiz.picked = null; renderQuiz(); });
  }

  load();
})();
