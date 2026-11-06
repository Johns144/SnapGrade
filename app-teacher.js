/* ---------- teacher workspace ---------- */
const CACHE_KEY = 'pm-cache-v1', PEND_KEY = 'pm-pending-v1';
const T = {
  tab: 'exams', S: { exams: {}, results: {}, settings: {} }, mode: 'checking',
  editing: null, menu: null, sub: '', mtab: 'details', open: {}, scans: [], scanExam: '', resExam: '', rowOpen: '', sort: 'name', warn: '', shrink: 0, importMsg: ''
};
let db = null, ASSETS = null, DL = null, saveTimer = null, flushing = false;

/* storage: local copy first, synced to the database when it is reachable */
const saveCache = () => LS.set(CACHE_KEY, T.S);
const pending = () => LS.get(PEND_KEY, []);
function put(col, id, data) {
  if (data === null) delete T.S[col][id]; else T.S[col][id] = data;
  saveCache();
  const q = pending().filter(o => !(o.col === col && o.id === id));
  q.push({ col, id, data });
  LS.set(PEND_KEY, q);
  syncChip();
  flush();
}
async function flush() {
  if (!db || flushing) return;
  flushing = true;
  try {
    let q = pending();
    while (q.length) {
      const op = q[0], ref = db.doc(op.col + '/' + op.id), sig = JSON.stringify(op);
      if (op.data === null) await ref.delete(); else await ref.set(op.data);
      q = pending().filter(o => JSON.stringify(o) !== sig);
      LS.set(PEND_KEY, q);
      syncChip();
    }
  } catch (e) { /* stays queued, retried on the next change or when the connection returns */ }
  flushing = false;
  syncChip();
}
function subscribe() {
  ['exams', 'results', 'settings'].forEach(col => {
    db.collection(col).onSnapshot(snap => {
      const m = {};
      snap.docs.forEach(d => { m[d.id] = d.data(); });
      pending().filter(o => o.col === col).forEach(o => { if (o.data === null) delete m[o.id]; else m[o.id] = o.data; });
      if (col === 'exams' && T.editing && has(T.S.exams, T.editing)) m[T.editing] = T.S.exams[T.editing];
      T.S[col] = m; saveCache();
      if (!T.editing) render();
      flush();
    }, () => { syncChip(); });
  });
}
function syncChip() {
  const el = $('#sync');
  if (!el) return;
  const n = pending().length, online = navigator.onLine !== false;
  let txt = 'Saved', warn = false;
  if (T.mode === 'local' || !db) { txt = n ? n + ' waiting to sync' : 'This device only'; warn = true; }
  else if (!online) { txt = n ? 'Offline, ' + n + ' waiting' : 'Offline'; warn = true; }
  else if (n) txt = 'Syncing ' + n + '…';
  el.textContent = txt; el.classList.toggle('warn', warn);
}

/* data helpers */
const exams = () => Object.keys(T.S.exams).map(k => T.S.exams[k]).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
const getExam = id => (has(T.S.exams, id) ? T.S.exams[id] : null);
const resultsOf = id => Object.keys(T.S.results).map(k => T.S.results[k]).filter(r => r.examId === id);
const cfg = () => Object.assign({ paper: 'a4', idLen: 6, thr: 0.18, roster: '', base: '', scale: 'pct', pass: '' }, T.S.settings.app || {});
const passMark = () => { const p = parseFloat(cfg().pass); return Number.isFinite(p) ? p : (cfg().scale === 'deped' ? 75 : 60); };
const gradeOf = raw => (cfg().scale === 'deped' ? PM.transmute(raw) : Math.round(raw));
const gradeName = () => (cfg().scale === 'deped' ? 'Grade' : 'Percent');
const fmtGrade = v => (cfg().scale === 'deped' ? String(v) : v + '%');
const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(id) && id !== '__proto__';
const setCfg = p => put('settings', 'app', Object.assign({}, T.S.settings.app || {}, p));
const blankItem = k => ({ q: '', c: new Array(k).fill(''), a: '', pts: 1 });
function newExam(n) {
  const id = uid();
  return {
    id, title: 'Untitled exam', subject: '', choices: 4, nItems: n, items: Array.from({ length: n }, () => blankItem(4)),
    minutes: 0, shuffleQ: false, shuffleC: false, maxAway: 3, instructions: '', createdAt: Date.now(), updatedAt: Date.now(), pub: null
  };
}
function touch(ex) {
  ex.updatedAt = Date.now(); T.S.exams[ex.id] = ex; saveCache();
  const s = $('#saved'); if (s) s.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { put('exams', ex.id, ex); const s2 = $('#saved'); if (s2) s2.textContent = 'Saved'; }, 500);
}
function studentPayload(ex) {
  return {
    v: 1, id: ex.id, title: ex.title, subject: ex.subject, instructions: ex.instructions, minutes: ex.minutes | 0,
    shuffleQ: !!ex.shuffleQ, shuffleC: !!ex.shuffleC, maxAway: ex.maxAway | 0, choices: ex.choices,
    items: ex.items.map(it => ({ q: it.q, c: it.c.slice(0, ex.choices) }))
  };
}
const sigOf = ex => crc(JSON.stringify(studentPayload(ex)));
function rosterMap() {
  const m = {};
  String(cfg().roster).split('\n').forEach(line => {
    const p = line.split(/[,\t]/).map(s => s.trim());
    if (p[0] && p[1]) m[p[0]] = { name: p[1], section: p[2] || '' };
  });
  return m;
}
function rosterName(sid) {
  const m = rosterMap();
  if (!sid) return '';
  if (has(m, sid)) return m[sid].name;
  const z = sid.replace(/^0+/, '');
  const hit = Object.keys(m).find(k => k.replace(/^0+/, '') === z);
  return hit ? m[hit].name : '';
}
function rosterSection(sid) {
  const m = rosterMap();
  if (!sid) return '';
  if (has(m, sid)) return m[sid].section;
  const z = sid.replace(/^0+/, '');
  const hit = Object.keys(m).find(k => k.replace(/^0+/, '') === z);
  return hit ? m[hit].section : '';
}
const ansArr = (s, n) => { const a = String(s || '').split('').map(ch => (ch === '-' ? '' : ch)); while (a.length < n) a.push(''); return a; };

/* ---------- views ---------- */
function shellHTML() {
  $('#app').innerHTML = `<div class="top">
    <div class="brand"><div class="logo"><i aria-hidden="true"></i><span>Snap<b>Grade</b></span></div><span class="sync" id="sync"></span></div>
    <div class="tabs" role="tablist">${[['exams', 'Exams'], ['scan', 'Scan'], ['results', 'Results'], ['settings', 'Settings']].map(t => `<button class="tab" role="tab" data-act="tab" data-t="${t[0]}" aria-selected="false">${t[1]}</button>`).join('')}</div>
  </div><div id="view"></div>`;
  syncChip();
}
function examsHTML() {
  const list = exams();
  const head = `<div class="head"><h1>Exams</h1><button class="btn primary" data-act="new-exam">New exam</button></div>`;
  if (!list.length) {
    return head + `<div class="empty"><h2>Start with the number of items</h2>
      <p class="muted">Enter just the answer key for a printed test, or write full questions to give it online with a link. Both can be scanned from paper.</p>
      <div class="presets">${[15, 20, 30, 60].map(n => `<button class="btn" data-act="new-exam" data-n="${n}">${n} items</button>`).join('')}</div></div>`;
  }
  return head + `<div class="list">${list.map(ex => {
    const n = resultsOf(ex.id).length;
    return `<button class="item" data-act="open-exam" data-id="${esc(ex.id)}"><span class="t">${esc(ex.title)}</span>
      <span class="m">${ex.nItems} items · ${ex.choices} choices${ex.subject ? ' · ' + esc(ex.subject) : ''}</span>
      <span class="r">${ex.pub ? '<span class="pill live">Link open</span>' : ''}<span class="pill">${n} result${n === 1 ? '' : 's'}</span></span></button>`;
  }).join('')}</div>`;
}
function itemsHTML(ex) {
  return ex.items.map((it, i) => {
    const open = T.open[i];
    const tags = (it.tag ? `<span class="pill">${esc(it.tag)}</span>` : '') + (it.bonus ? '<span class="pill warn">credit to all</span>' : '') + (it.pts > 0 && +it.pts !== 1 ? `<span class="pill">${+it.pts} pts</span>` : '');
    return `<div class="krow"><span class="kn">${i + 1}</span>
      <div class="kb">${LET.slice(0, ex.choices).split('').map(L => `<button class="bub" data-act="key" data-i="${i}" data-l="${L}" aria-pressed="${it.a === L}" aria-label="Item ${i + 1}, answer ${L}">${L}</button>`).join('')}${tags}</div>
      <button class="link" data-act="open-item" data-i="${i}">${open ? 'Hide' : 'Question'}${it.q ? '<span class="dot"></span>' : ''}</button>
      ${open ? `<div class="qfull"><textarea data-i="${i}" data-k="q" rows="2" placeholder="Question text, needed for online exams">${esc(it.q)}</textarea>
        ${Array.from({ length: ex.choices }, (_, j) => `<label class="cl"><span class="bub sm">${LET[j]}</span><input data-i="${i}" data-c="${j}" value="${esc(it.c[j] || '')}" placeholder="Choice ${LET[j]}"></label>`).join('')}
        <div class="row"><label class="cust">Points<input type="number" min="0.5" max="20" step="0.5" data-i="${i}" data-k="pts" value="${it.pts > 0 ? +it.pts : 1}"></label>
        <label class="row"><input type="checkbox" data-i="${i}" data-k="bonus" ${it.bonus ? 'checked' : ''} style="width:auto"> Give credit to everyone</label></div>
        <label class="f">Tag <span class="opt">optional, for the tag report</span><input data-i="${i}" data-k="tag" maxlength="30" value="${esc(it.tag || '')}" placeholder="Topic or skill, like Plate tectonics"></label></div>` : ''}</div>`;
  }).join('');
}
function pubHTML(ex) {
  const c = cfg();
  const file = `<div class="row"><button class="btn" data-act="exam-file">${DL ? 'Download exam file' : 'Copy exam file'}</button></div>
    <p class="hint">${DL ? 'Or send students one file that opens in any browser and works without internet. They still send you their code.' : 'Downloads are off in this view, so the exam file is copied instead. Paste it into Notepad, save it as a .html file, and send that to students. It works without internet, and they still send you their code.'}</p>
    ${T.srcText ? `<label class="f">Exam file (copy everything below)<textarea class="code" id="src-box" rows="6" readonly>${esc(T.srcText)}</textarea></label><div class="row"><button class="btn" data-act="hide-src">Hide</button></div>` : ''}`;
  if (!ex.pub) {
    return `<p class="hint">Students open the link, answer on their own phone or laptop, and get a code to send you. The answer key stays in your account.</p>
      <div class="row"><button class="btn primary" data-act="publish">Publish student link</button></div>
      ${ASSETS ? '' : '<p class="note warn">Publishing needs you signed in to Claude as the owner of this page.</p>'}${file}`;
  }
  const stale = ex.pub.sig !== sigOf(ex);
  const link = c.base ? c.base.replace(/#.*$/, '') + '#q' + ex.pub.assetId : '';
  return `<p class="note good">The student link is open.</p>
    ${stale ? '<p class="note warn">You changed the exam after publishing. Publish again to send the changes. The link will change.</p>' : ''}
    ${link ? `<div class="linkbox"><input readonly id="plink" value="${esc(link)}" aria-label="Student link"><button class="btn" data-act="copy-link">Copy link</button></div>
      <p class="hint">Students can only open it if this page is shared with anyone who has the link.</p>`
      : `<p class="note warn">Paste your page link in Settings to get the full student link. Its ending is <span class="mono">#q${esc(ex.pub.assetId)}</span></p>`}
    <div class="row"><button class="btn" data-act="publish">Publish changes</button><button class="btn danger" data-act="unpublish">Close link</button></div>${file}`;
}
function editorHTML() {
  const ex = getExam(T.editing);
  if (!ex) { T.editing = null; return examsHTML(); }
  const std = [15, 20, 30, 60].indexOf(ex.nItems) >= 0;
  return `<div class="head"><button class="btn ghost" data-act="close-editor">← Exam menu</button><span class="saved" id="saved">Saved</span></div>
  <section class="blk">
    <label class="f">Exam title<input data-f="title" value="${esc(ex.title)}" maxlength="80"></label>
    <label class="f">Subject or topic <span class="opt">optional</span><input data-f="subject" value="${esc(ex.subject)}" maxlength="60"></label>
  </section>
  <section class="blk"><h2>Length and choices</h2>
    <div class="seg" role="group" aria-label="Number of items">${[15, 20, 30, 60].map(n => `<button class="segb" data-act="set-n" data-n="${n}" aria-pressed="${ex.nItems === n}">${n}</button>`).join('')}
      <label class="cust">Other<input type="number" min="1" max="60" id="f-n" value="${std ? '' : ex.nItems}" placeholder="1-60"></label></div>
    ${T.warn ? `<p class="note warn">${esc(T.warn)}</p>` : ''}
    <p class="hint">The printed sheet is the ${PM.formatFor(ex.nItems)}-item layout. Up to 60 items.</p>
    <div class="seg" role="group" aria-label="Choices per item">${[2, 3, 4, 5].map(k => `<button class="segb" data-act="set-k" data-k="${k}" aria-pressed="${ex.choices === k}">${LET.slice(0, k)[0]}-${LET[k - 1]}</button>`).join('')}</div>
  </section>
  <section class="blk"><h2>Answer key</h2>
    <p class="hint">Tap the right letter for each item, or type the whole key at once.</p>
    <div class="row"><input class="mono" id="e-quick" placeholder="ABCDDABC…" style="flex:1 1 220px;width:auto" autocapitalize="characters" autocomplete="off"><button class="btn" data-act="apply-quick">Apply key</button></div>
    <div id="items">${itemsHTML(ex)}</div>
  </section>
  <section class="blk"><h2>Paste questions</h2>
    <p class="hint">Paste questions from a document. Format: a numbered question, choices on lines starting A. B. C. D., and an optional line like Answer: B. This replaces the items above.</p>
    <textarea id="e-paste" rows="6" placeholder="1. What is the capital of France?&#10;A. Lyon&#10;B. Paris&#10;C. Nice&#10;D. Lille&#10;Answer: B"></textarea>
    <div class="row"><button class="btn" data-act="parse-paste">Import questions</button><button class="btn" data-act="pick-qfile">Upload text file</button><input type="file" id="in-qfile" accept=".txt,.text,.md,.csv,text/plain" hidden><span class="hint" id="paste-msg"></span></div>
    <p class="hint">A .txt file works best. For Word or PDF, copy the questions and paste them above.</p>
  </section>
  <section class="blk"><h2>Online exam settings</h2>
    <div class="grid2">
      <label class="f">Time limit in minutes <span class="opt">0 means none</span><input type="number" min="0" max="300" data-f="minutes" value="${ex.minutes | 0}"></label>
      <label class="f">Submit after leaving the page <span class="opt">0 means never</span><input type="number" min="0" max="20" data-f="maxAway" value="${ex.maxAway | 0}"></label>
    </div>
    <label class="row"><input type="checkbox" data-f="shuffleQ" ${ex.shuffleQ ? 'checked' : ''} style="width:auto"> Shuffle question order for each student</label>
    <label class="row"><input type="checkbox" data-f="shuffleC" ${ex.shuffleC ? 'checked' : ''} style="width:auto"> Shuffle choices for each student</label>
    <p class="hint">Avoid shuffling choices if any question says "all of the above".</p>
    <label class="f">Instructions for students <span class="opt">optional</span><textarea data-f="instructions" rows="2">${esc(ex.instructions)}</textarea></label>
    <div id="pub">${pubHTML(ex)}</div>
  </section>
  <section class="blk"><h2>Answer sheet</h2>
    <p class="hint">Prints on ${cfg().paper === 'letter' ? 'Letter' : 'A4'} paper with a ${cfg().idLen}-digit student ID grid. Change paper and ID length in Settings.</p>
    <div class="row"><button class="btn primary" data-act="sheet-pdf">Download answer sheet (PDF)</button></div>
  </section>
  <section class="blk"><div class="row"><button class="btn danger" data-act="del-exam">Delete this exam</button></div></section>`;
}

function flagHTML(s) {
  const multi = [], blank = [];
  s.ans.forEach((a, i) => { if (a === '*') multi.push(i + 1); else if (!a) blank.push(i + 1); });
  const list = a => a.slice(0, 10).join(', ') + (a.length > 10 ? '…' : '');
  const parts = [];
  if (multi.length) parts.push(`Double marks on ${list(multi)}. These count wrong until you tap the right bubble.`);
  if (blank.length) parts.push(`Blank: ${list(blank)}.`);
  return parts.length ? `<p class="note${multi.length ? ' warn' : ''}">${parts.join(' ')}</p>` : '';
}
function scanCard(s) {
  const ex = getExam(s.examId);
  if (s.state === 'saved') return `<div class="savedline"><span>${esc(s.label)}</span><span class="pill good">Saved</span></div>`;
  if (s.state === 'reading') return `<div class="scan"><p class="muted">Reading ${esc(s.file)}…</p></div>`;
  if (s.state === 'fail') return `<div class="scan"><header><b>${esc(s.file)}</b><button class="link" data-act="scan-drop" data-sid="${s.id}">Dismiss</button></header><p class="note bad">${esc(s.err)}</p></div>`;
  const g = PM.grade(ex, s.ans);
  const dup = findDup(s);
  return `<article class="scan"><header><b>${esc(s.file)}</b><span class="pill" id="sc-${s.id}">${g.earned} / ${g.total}</span></header>
    ${s.warnTxt ? `<p class="note warn">${esc(s.warnTxt)}</p>` : ''}
    <div id="fl-${s.id}">${flagHTML(s)}</div>
    <div class="scanrow"><div class="cvwrap"><canvas class="rcv" data-cv="${s.id}" aria-label="Scanned sheet. Tap a bubble to correct an answer."></canvas></div>
    <div class="side">
      <label class="f">Student ID<input class="mono" data-sf="sid" data-sid="${s.id}" value="${esc(s.sid)}" inputmode="numeric" placeholder="${esc(s.idHint)}"></label>
      <label class="f">Name<input data-sf="name" data-sid="${s.id}" value="${esc(s.name)}" list="roster-names" autocomplete="off"></label>
      <p class="hint">Tap any bubble on the sheet to correct it. Tap again to clear. Green is correct, red is wrong, a green ring marks the right answer.</p>
      <div class="row"><button class="btn primary" data-act="scan-save" data-sid="${s.id}">${dup ? 'Replace earlier scan' : 'Save'}</button><button class="btn" data-act="scan-drop" data-sid="${s.id}">Discard</button></div>
    </div></div></article>`;
}
function findDup(s) {
  if (!s.sid) return null;
  return resultsOf(s.examId).find(r => r.source === 'scan' && r.sid === s.sid) || null;
}
function scanHTML() {
  const list = exams();
  if (!list.length) return `<h1>Scan</h1><div class="empty"><p class="muted">Create an exam with an answer key first. Then print its answer sheet and scan the filled sheets here.</p></div>`;
  if (!T.scanExam || !getExam(T.scanExam)) T.scanExam = list[0].id;
  const ex = getExam(T.scanExam), miss = ex.items.map((it, i) => (it.a || it.bonus ? 0 : i + 1)).filter(Boolean);
  const names = Object.keys(rosterMap()).map(k => rosterMap()[k].name);
  const ready = T.scans.filter(s => s.state === 'ready').length;
  return `<h1>Scan</h1>
  <label class="f">Exam<select data-act="pick-exam" id="scan-exam">${list.map(e => `<option value="${esc(e.id)}"${e.id === T.scanExam ? ' selected' : ''}>${esc(e.title)} (${e.nItems} items)</option>`).join('')}</select></label>
  ${miss.length ? `<p class="note warn">No answer key for item${miss.length === 1 ? '' : 's'} ${miss.slice(0, 12).join(', ')}${miss.length > 12 ? '…' : ''}. They will count as wrong.</p>` : ''}
  <div class="drop">
    <div class="row"><button class="btn primary" data-act="pick-cam">Take photo of a sheet</button><button class="btn" data-act="pick-file">Choose photos</button></div>
    <p class="hint">Lay the sheet flat in good light. Keep all four black corner squares in the frame. The sheet can be turned any way. Choose many photos at once to scan a whole stack. Photos are read on this device and are not uploaded.</p>
    <input type="file" id="in-cam" accept="image/*" capture="environment" hidden>
    <input type="file" id="in-file" accept="image/*" multiple hidden>
  </div>
  <datalist id="roster-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
  ${ready > 1 ? `<div class="row"><button class="btn primary" data-act="scan-all">Save all ready (${ready})</button><span class="hint">Saves sheets with a full ID and no double marks. The rest stay here for you to check.</span></div>` : ''}
  <div id="scans" style="display:flex;flex-direction:column;gap:14px">${T.scans.map(scanCard).join('')}</div>`;
}

function rowsFor(ex) {
  const pm = passMark();
  return resultsOf(ex.id).map(r => {
    const ans = ansArr(r.answers, ex.items.length), g = PM.grade(ex, ans);
    const raw = g.total ? 100 * g.earned / g.total : 0, gr = gradeOf(raw);
    return { r, ans, g, raw, pct: Math.round(raw), gr, pass: gr >= pm };
  });
}
function histHTML(rows) {
  const bins = new Array(10).fill(0);
  rows.forEach(x => { bins[Math.min(9, Math.floor(x.raw / 10))]++; });
  const mx = Math.max.apply(null, bins) || 1;
  const label = bins.map((c, i) => `${i * 10} to ${i === 9 ? 100 : i * 10 + 9} percent, ${c} student${c === 1 ? '' : 's'}`).join('; ');
  return `<figure class="hf" role="img" aria-label="Students per score band. ${label}">
    <div class="hist">${bins.map(c => `<div class="hcol">${c ? `<span class="hn">${c}</span>` : ''}<div class="hbar" style="height:${c ? Math.max(4, Math.round(96 * c / mx)) : 0}px"></div></div>`).join('')}</div>
    <div class="hx">${bins.map((c, i) => `<span>${i * 10}</span>`).join('')}</div>
    <figcaption class="hint">Students per score band, in percent of points. The table below has every score.</figcaption></figure>`;
}
function resultsHTML() {
  const list = exams();
  if (!list.length) return `<h1>Results</h1><div class="empty"><p class="muted">Results appear here after you scan sheets or import student codes.</p></div>`;
  if (!T.resExam || !getExam(T.resExam)) T.resExam = list[0].id;
  const ex = getExam(T.resExam);
  let rows = rowsFor(ex);
  rows.sort((a, b) => T.sort === 'score' ? b.raw - a.raw : T.sort === 'recent' ? (b.r.ts || 0) - (a.r.ts || 0) : String(a.r.name || a.r.sid).localeCompare(String(b.r.name || b.r.sid)));
  const n = rows.length, avg = n ? rows.reduce((t, x) => t + x.gr, 0) / n : 0;
  const hi = n ? Math.max.apply(null, rows.map(x => x.gr)) : 0, lo = n ? Math.min.apply(null, rows.map(x => x.gr)) : 0;
  const passed = rows.filter(x => x.pass).length;
  const flagged = rows.filter(x => x.r.away && x.r.away.n > 0).length;
  const body = rows.map(x => {
    const r = x.r, open = T.rowOpen === r.id;
    return `<tr class="${open ? 'sel' : ''}"><td><button class="rowbtn" data-act="row" data-id="${esc(r.id)}">${esc(r.name || '(no name)')}</button><span class="sub">${esc(r.sid || '')}${r.sid ? ' · ' : ''}${r.source === 'online' ? 'Online' : 'Paper'}</span></td>
      <td class="mono hs">${esc(r.sid || '')}</td><td class="hs">${r.source === 'online' ? 'Online' : 'Paper'}</td>
      <td class="num">${x.g.earned}/${x.g.total}</td><td class="num">${fmtGrade(x.gr)}</td>
      <td>${x.pass ? '<span class="pill good">Passed</span>' : '<span class="pill bad">Not passed</span>'}</td>
      <td class="num">${r.away ? (r.away.n ? `<span class="pill warn">${r.away.n}× away</span>` : '0') : ''}</td></tr>
      ${open ? `<tr class="sel"><td colspan="7">${detailHTML(ex, x)}</td></tr>` : ''}`;
  }).join('');
  return `<div class="head"><h1>Results</h1><button class="btn" data-act="export-csv"${n && DL ? '' : ' disabled'}>Export CSV</button></div>
  <label class="f">Exam<select data-act="pick-res" id="res-exam">${list.map(e => `<option value="${esc(e.id)}"${e.id === T.resExam ? ' selected' : ''}>${esc(e.title)}</option>`).join('')}</select></label>
  ${n ? `<div class="stats"><span><b>${n}</b>students</span><span><b>${fmtGrade(Math.round(avg * 10) / 10)}</b>average</span><span><b>${passed} of ${n}</b>passed (${fmtGrade(passMark())} or more)</span><span><b>${fmtGrade(hi)}</b>highest</span><span><b>${fmtGrade(lo)}</b>lowest</span><span><b>${(rows.reduce((t, x) => t + x.raw, 0) / n).toFixed(1)}%</b>MPS</span>${flagged ? `<span><b>${flagged}</b>left the page</span>` : ''}</div>
  ${histHTML(rows)}
  <div class="row"><span class="hint">Sort</span><select data-act="sort" style="width:auto"><option value="name"${T.sort === 'name' ? ' selected' : ''}>Name</option><option value="score"${T.sort === 'score' ? ' selected' : ''}>Highest score</option><option value="recent"${T.sort === 'recent' ? ' selected' : ''}>Most recent</option></select></div>
  <div class="tablewrap"><table><thead><tr><th>Student</th><th class="hs">ID</th><th class="hs">Source</th><th class="num">Score</th><th class="num">${gradeName()}</th><th>Result</th><th class="num">Tab switches</th></tr></thead><tbody>${body}</tbody></table></div>`
      : `<p class="muted">No results for this exam yet.</p>`}
  <section class="blk"><h2>Import online submissions</h2>
    <p class="hint">Paste the codes students sent you, one per line or all together.</p>
    <textarea id="imp" class="code" rows="4" placeholder="PM1.…"></textarea>
    <div class="row"><button class="btn" data-act="import">Import codes</button><span class="hint" id="imp-msg">${esc(T.importMsg)}</span></div>
  </section>
  ${n ? `<section class="blk"><h2>Item analysis</h2><p class="hint">Difficulty index, D.F. and the choice counts for every item are in the exam menu.</p><div class="row"><button class="btn" data-act="open-ia" data-id="${esc(ex.id)}">Open item analysis</button></div></section>` : ''}`;
}
function detailHTML(ex, x) {
  const r = x.r;
  const chips = ex.items.map((it, i) => {
    const a = x.ans[i], cls = PM.right(it, a) ? 'ok' : !a ? 'bl' : 'no';
    return `<div class="chip ${cls}"><span>${esc(a === '*' ? '*' : a || '·')}</span>${i + 1}</div>`;
  }).join('');
  const ev = r.away && r.away.ev && r.away.ev.length ? r.away.ev.map(e => `${fmtTime(e[0])} into the exam, ${e[1]}s ${e[2] === 'h' ? 'hidden or switched tab' : e[2] === 'r' ? 'page reloaded' : 'window lost focus'}`).join('; ') : '';
  return `<div class="det"><div class="chips" aria-label="Answers">${chips}</div>
    <p class="hint">Circle shows the student's answer. Green earned credit, red did not, dashed means blank, * means more than one mark.</p>
    ${r.source === 'online' ? `<p class="hint">Took ${fmtTime(r.secs || 0)}${r.section ? ' · ' + esc(r.section) : ''}${r.reason === 'time' ? ' · submitted when time ran out' : r.reason === 'away' ? ' · auto-submitted after leaving the page' : ''}${r.cp ? ' · tried to copy ' + r.cp + ' time' + (r.cp === 1 ? '' : 's') : ''}</p>` : ''}
    ${ev ? `<p class="note warn">Left the page: ${esc(ev)}</p>` : ''}
    <div class="row"><button class="btn danger" data-act="del-result" data-id="${esc(r.id)}">Delete this result</button></div></div>`;
}
/* ---------- exam menu, item analysis, tag report ---------- */
const num2 = v => (v == null || !Number.isFinite(v) ? '–' : String(Math.round(v * 100) / 100));
const num1 = v => (v == null || !Number.isFinite(v) ? '–' : String(Math.round(v * 10) / 10));
function rangeText(nums) {
  const out = []; let i = 0;
  while (i < nums.length) { let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++; out.push(j > i + 1 ? nums[i] + '–' + nums[j] : nums.slice(i, j + 1).join(', ')); i = j + 1; }
  return out.join(', ');
}
function backBtn(label) { return `<div class="head"><button class="btn ghost" data-act="menu-back">← ${label}</button></div>`; }
function menuHTML() {
  const ex = getExam(T.menu);
  if (!ex) { T.menu = null; return examsHTML(); }
  const rows = rowsFor(ex), st = PM.analyze(ex, rows.map(x => x.ans));
  const cls = Array.from(new Set(rows.map(x => x.r.section || rosterSection(x.r.sid || '')).filter(Boolean)));
  const tabs = [['details', 'Details'], ['stats', 'Statistics']].map(t => `<button class="tab" role="tab" data-act="mtab" data-t="${t[0]}" aria-selected="${T.mtab === t[0]}">${t[1]}</button>`).join('');
  const row = (k, v) => `<div class="qrow"><span class="qk">${k}</span><span class="qv">${v}</span></div>`;
  let panel;
  if (T.mtab === 'stats') {
    const sc = st.score, pc = st.pct, f = (o, k, d) => (o ? (d ? num1(o[k]) : num2(o[k])) : '–');
    panel = st.n ? `<div class="tablewrap"><table class="st"><thead><tr><th></th><th class="num">Score</th><th class="num">Percent</th></tr></thead><tbody>
        ${[['Min', 'min'], ['Max', 'max'], ['Average', 'avg'], ['Median', 'med'], ['Std. deviation', 'sd']].map(r => `<tr><td>${r[0]}</td><td class="num">${f(sc, r[1])}</td><td class="num">${f(pc, r[1], 1)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="mps"><span class="qk">MPS (mean percentage score)</span><b>${num1(st.mps)}%</b><span class="pill">${esc(PM.mastery(st.mps))}</span></div>
      <p class="hint">Out of ${st.total} point${st.total === 1 ? '' : 's'}, from ${st.n} paper${st.n === 1 ? '' : 's'}. Standard deviation is the sample deviation, so it needs two papers.</p>`
      : '<p class="muted">Statistics appear after you scan sheets or import codes.</p>';
  } else {
    panel = `<div class="qcard">${row('Subject', esc(ex.subject || '–'))}${row('Classes', cls.length ? esc(cls.join(', ')) : '–')}
      ${row('Answer sheet', `<button class="link" data-act="sheet-pdf">Download PDF</button>`)}
      ${row('Date', (ex.createdAt > 1e11 ? esc(new Date(ex.createdAt).toLocaleDateString()) : '–'))}${row('Papers', String(st.n))}${row('Questions', String(ex.items.length))}</div>
      ${st.n ? `<div class="mps"><span class="qk">MPS</span><b>${num1(st.mps)}%</b><span class="pill">${esc(PM.mastery(st.mps))}</span></div>` : ''}`;
  }
  const btns = [['edit-key', 'Edit key and questions', 'Answer key, choices, tags, online link'], ['go-scan', 'Scan papers', 'Read filled answer sheets'], ['go-review', 'Review papers', st.n + ' saved, with scores and tab switches'], ['open-ia', 'Item analysis', 'Difficulty index, D.F., choice counts'], ['open-tags', 'Tag report', 'MPS for each topic or skill']];
  return `<div class="head"><button class="btn ghost" data-act="menu-back">← All exams</button></div>
  <h1>${esc(ex.title)}</h1>
  <div class="tabs mtabs" role="tablist">${tabs}</div>
  ${panel}
  <div class="mbtns">${btns.map(b => `<button class="mbtn" data-act="${b[0]}"><b>${b[1]}</b><span>${b[2]}</span></button>`).join('')}</div>`;
}
function iaSuggest(it, x) {
  if (it.bonus) return '<span class="pill warn">Credit to all</span>';
  if (!it.a) return '<span class="pill warn">No key</span>';
  if (x.df == null) return '';
  if (x.df < 0) return '<span class="pill bad">Check the key</span>';
  if (x.df < 0.2 || x.p <= 0.2) return '<span class="pill warn">Revise</span>';
  return '<span class="pill good">Keep</span>';
}
function iaHTML() {
  const ex = getExam(T.menu);
  if (!ex) { T.menu = null; T.sub = ''; return examsHTML(); }
  const rows = rowsFor(ex), st = PM.analyze(ex, rows.map(x => x.ans)), k = ex.choices;
  if (!st.n) return backBtn('Back') + `<h1>Item analysis</h1><p class="muted">Item analysis appears after you scan sheets or import codes for this exam.</p>`;
  const items = st.items.map(x => {
    const it = ex.items[x.i], key = it.a;
    const letters = LET.slice(0, k).split('');
    const order = key ? [key].concat(letters.filter(L => L !== key)) : letters;
    const bars = order.map(L => {
      const c = x.counts[L] || 0, h = Math.round(44 * c / st.n);
      const cls = L === key ? 'key' : c ? '' : 'neu';
      return `<div class="bcol ${cls}"><span class="bc">${c}</span><div class="bb"><i style="height:${c ? Math.max(3, h) : 0}px"></i></div><span class="bl">${L}</span></div>`;
    }).join('');
    const label = `Item ${x.n}: ${Math.round(x.p * 100)} percent right. ` + order.map(L => `${L} ${x.counts[L] || 0}`).join(', ') + `, blank ${x.blank}.`;
    return `<article class="ia2"><span class="ia2n">${x.n}</span><b class="ia2p">${Math.round(x.p * 100)}%</b>
      <div class="bars" role="img" aria-label="${label}">${bars}</div>
      <div class="ia2m"><span>Difficulty <b class="mono">${num2(x.p)}</b> ${esc(PM.diffLabel(x.p))}</span><span>D.F. <b class="mono">${num2(x.df)}</b></span>${x.blank ? `<span>Blank ${x.blank}</span>` : ''}${iaSuggest(it, x)}${it.tag ? `<span class="pill">${esc(it.tag)}</span>` : ''}</div></article>`;
  }).join('');
  return backBtn('Back') + `<h1>Item analysis</h1>
  <p class="hint">${esc(ex.title)} · ${st.n} paper${st.n === 1 ? '' : 's'}. Green is the correct choice, red bars are wrong choices students picked.</p>
  <details class="how"><summary>How to read this</summary>
    <p class="hint"><b>Difficulty index</b> is the share of students who got the item right: 0.20 or less very difficult, up to 0.40 difficult, up to 0.60 moderate, up to 0.80 easy, above that very easy.</p>
    <p class="hint"><b>D.F.</b> is the correlation between getting the item right and the total score, from −1 to 1, the same measure ZipGrade shows. Above 0.20 is good. A negative value means strong students missed it more than weak ones, so check the key. The labels beside each item are only a guide.</p>
    ${st.n < 30 ? '<p class="note warn">With fewer than about 30 papers these numbers are rough.</p>' : ''}</details>
  <div class="ialist">${items}</div>`;
}
function tagGroups(ex) {
  const g = {};
  ex.items.forEach((it, i) => { const t = String(it.tag || '').trim(); if (t) { (g[t] = g[t] || []).push(i); } });
  return Object.keys(g).map(t => ({ tag: t, idx: g[t] }));
}
function tagsHTML() {
  const ex = getExam(T.menu);
  if (!ex) { T.menu = null; T.sub = ''; return examsHTML(); }
  const rows = rowsFor(ex), groups = tagGroups(ex);
  const body = groups.map(g => {
    const sub = { items: g.idx.map(i => ex.items[i]) };
    const st = rows.length ? PM.analyze(sub, rows.map(x => g.idx.map(i => x.ans[i]))) : null;
    return `<tr><td>${esc(g.tag)}</td><td>${esc(rangeText(g.idx.map(i => i + 1)))}</td><td class="num">${st ? num1(st.mps) + '%' : '–'}</td><td>${st ? esc(PM.mastery(st.mps)) : ''}</td></tr>`;
  }).join('');
  return backBtn('Back') + `<h1>Tag report</h1>
  <p class="hint">${esc(ex.title)}. MPS for each topic or skill you tagged, with the DepEd mastery level.</p>
  ${groups.length ? `<div class="tablewrap"><table><thead><tr><th>Tag</th><th>Items</th><th class="num">MPS</th><th>Mastery</th></tr></thead><tbody>${body}</tbody></table></div>${rows.length ? '' : '<p class="muted">MPS appears after you scan sheets or import codes.</p>'}` : '<p class="muted">No items are tagged yet. Tag items below, or open one in the editor and fill in its Tag.</p>'}
  <section class="blk"><h2>Tag a range of items</h2>
    <div class="grid3"><label class="f">From item<input type="number" id="tg-from" min="1" max="${ex.items.length}" value="1"></label>
    <label class="f">To item<input type="number" id="tg-to" min="1" max="${ex.items.length}" value="${Math.min(5, ex.items.length)}"></label>
    <label class="f">Tag<input id="tg-name" maxlength="30" placeholder="Plate tectonics"></label></div>
    <div class="row"><button class="btn primary" data-act="tag-apply">Apply tag</button><span class="hint">Leave the tag empty to clear it from those items.</span></div></section>`;
}
function settingsHTML() {
  const c = cfg(), dep = c.scale === 'deped';
  return `<h1>Settings</h1>
  <section class="blk"><h2>Class list</h2>
    <p class="hint">One student per line: ID, name, section. When a scanned ID matches, the name fills in.</p>
    <textarea data-s="roster" rows="8" class="mono" placeholder="000123, Maria Santos, 11-Rizal">${esc(c.roster)}</textarea></section>
  <section class="blk"><h2>Grades</h2>
    <div class="grid2"><label class="f">Show grades as<select data-s="scale"><option value="pct"${!dep ? ' selected' : ''}>Percent of points</option><option value="deped"${dep ? ' selected' : ''}>DepEd transmuted grade</option></select></label>
    <label class="f">Passing mark<input type="number" min="0" max="100" step="1" data-s="pass" value="${esc(c.pass === '' ? passMark() : c.pass)}"></label></div>
    <p class="hint">${dep ? 'Percent is converted with the standard DepEd transmutation table: 60% becomes 75 and 100% stays 100. Check it against your own school\'s table.' : 'Students at or above the passing mark show as Passed.'}</p></section>
  <section class="blk"><h2>Student link</h2>
    <p class="hint">Open this page's Share menu, allow anyone with the link, copy the link, and paste it here once. Each exam's student link is built from it.</p>
    <input data-s="base" value="${esc(c.base)}" placeholder="https://claude.ai/artifact/…" inputmode="url"></section>
  <section class="blk"><h2>Answer sheet</h2>
    <div class="grid2"><label class="f">Paper<select data-s="paper"><option value="a4"${c.paper === 'a4' ? ' selected' : ''}>A4</option><option value="letter"${c.paper === 'letter' ? ' selected' : ''}>Letter</option></select></label>
    <label class="f">Student ID digits<select data-s="idLen">${[4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => `<option${n === c.idLen ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
    <p class="hint">Sheets already printed keep working only if you scan them with the same ID digits.</p></section>
  <section class="blk"><h2>Scanning</h2>
    <label class="f">Mark sensitivity: ${Number(c.thr).toFixed(2)}<input type="range" min="0.10" max="0.35" step="0.01" data-s="thr" value="${c.thr}"></label>
    <p class="hint">Lower reads lighter pencil marks but may pick up smudges. The default suits dark pencil and pen.</p></section>
  <section class="blk"><h2>Backup</h2>
    <p class="hint">${Object.keys(T.S.exams).length} exams and ${Object.keys(T.S.results).length} results are kept here and in your account when you are signed in. A backup file also holds your answer keys, so keep it private.</p>
    <div class="row"><button class="btn" data-act="backup"${DL ? '' : ' disabled'}>Download backup</button><button class="btn" data-act="restore">Restore from backup</button></div>
    <input type="file" id="in-restore" accept=".json,application/json" hidden>
    <p class="hint" id="bk-msg">${esc(T.restoreMsg)}</p></section>`;
}

function render() {
  if (T.mode === 'checking') return;
  if (T.mode === 'gate') { gate(); return; }
  if (!$('#view')) shellHTML();
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === T.tab)));
  const v = $('#view');
  v.innerHTML = T.tab === 'exams' ? (T.editing ? editorHTML() : (T.menu && getExam(T.menu) ? (T.sub === 'ia' ? iaHTML() : T.sub === 'tags' ? tagsHTML() : menuHTML()) : examsHTML()))
    : T.tab === 'scan' ? scanHTML() : T.tab === 'results' ? resultsHTML() : settingsHTML();
  if (T.tab === 'scan') T.scans.forEach(s => { if (s.state === 'ready') drawReview(s); });
  syncChip();
}
function gate() {
  $('#app').innerHTML = `<div class="stu"><h1>SnapGrade</h1>
    <p>This is the teacher workspace for building exams and scanning answer sheets. If you are taking an exam, open the exam link your teacher sent you. It ends in <span class="mono">#q</span> followed by letters and numbers.</p>
    <div><button class="btn" data-act="local">I am the teacher, work on this device</button></div></div>`;
}

/* ---------- editing ---------- */
function setCount(ex, n) {
  n = Math.max(1, Math.min(60, n | 0));
  const cur = ex.items.length;
  if (n < cur) {
    const lost = ex.items.slice(n).some(it => it.q || it.a || it.c.some(Boolean));
    if (lost && T.shrink !== n) {
      T.shrink = n; T.warn = `Going down to ${n} items removes items ${n + 1} to ${cur}, which have content. Choose ${n} again to confirm.`;
      render(); return;
    }
  }
  T.shrink = 0; T.warn = '';
  while (ex.items.length < n) ex.items.push(blankItem(ex.choices));
  ex.items.length = n; ex.nItems = n;
  touch(ex); render();
}
function setChoices(ex, k) {
  ex.choices = k;
  ex.items.forEach(it => { while (it.c.length < k) it.c.push(''); if (it.a && LET.indexOf(it.a) >= k) it.a = ''; });
  touch(ex); render();
}
function parseQuestions(text) {
  const out = []; let cur = null, lastC = -1, keyLine = '';
  text.replace(/\r/g, '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (!cur || out.length) { const kl = line.replace(/\s+/g, '').toUpperCase(); if (/^[A-E]{2,60}$/.test(kl) && out.length) { keyLine = kl; cur = null; return; } }
    let m = line.match(/^\(?([A-Ea-e])[.):]\s*(.*)$/);
    if (m && cur) { lastC = m[1].toUpperCase().charCodeAt(0) - 65; cur.c[lastC] = m[2]; return; }
    m = line.match(/^(?:answer|ans|key)\s*[:=-]?\s*\(?([A-Ea-e])\)?/i);
    if (m && cur) { cur.a = m[1].toUpperCase(); return; }
    m = line.match(/^(?:Q\s*)?(\d{1,3})[.):]\s*(.*)$/i);
    if (m) { cur = { q: m[2], c: [], a: '', pts: 1 }; lastC = -1; out.push(cur); return; }
    if (cur) { if (lastC >= 0) cur.c[lastC] = (cur.c[lastC] || '') + ' ' + line; else cur.q += ' ' + line; }
  });
  out.key = keyLine;
  return out;
}
// Merge a fresh import into the current exam. Answer keys, tags, points and credit-to-all survive a re-import when the file does not give them.
function mergeImport(prev, parsed, k) {
  const keyStr = parsed.key || '';
  let kept = 0, fromFile = 0;
  const items = parsed.map((it, i) => {
    const o = prev[i] || {};
    if (keyStr[i] && LET.indexOf(keyStr[i]) >= 0 && LET.indexOf(keyStr[i]) < k) { it.a = keyStr[i]; fromFile++; }
    else if (it.a) fromFile++;
    else if (o.a && LET.indexOf(o.a) >= 0 && LET.indexOf(o.a) < k) { it.a = o.a; kept++; }
    if (!it.tag && o.tag) it.tag = o.tag;
    if (!it.bonus && o.bonus) it.bonus = true;
    if ((!it.pts || it.pts === 1) && o.pts > 0) it.pts = o.pts;
    return it;
  });
  const missing = items.filter(it => !it.a && !it.bonus).length;
  return { items, kept, fromFile, missing };
}
function importPasted(ex) {
  const parsed = parseQuestions($('#e-paste').value).slice(0, 60);
  if (!parsed.length) { $('#paste-msg').textContent = 'No numbered questions found.'; return; }
  const k = Math.max(2, Math.min(5, Math.max.apply(null, parsed.map(it => it.c.length))));
  parsed.forEach(it => { for (let j = 0; j < k; j++) it.c[j] = it.c[j] || ''; it.c.length = Math.max(k, it.c.length); if (LET.indexOf(it.a) >= k) it.a = ''; });
  const m = mergeImport(ex.items, parsed, k);
  const hadKeys = ex.items.some(it => it.a);
  ex.items = m.items; ex.nItems = m.items.length; ex.choices = k; T.open = {};
  touch(ex); render();
  const bits = [`Imported ${m.items.length} questions.`];
  if (m.kept) bits.push(`Kept ${m.kept} answer key${m.kept === 1 ? '' : 's'} from before.`);
  if (m.missing) bits.push(`${m.missing} still need${m.missing === 1 ? 's' : ''} an answer.`);
  if (hadKeys && !m.kept && !m.fromFile) bits.push('The old keys did not carry over. Check the list.');
  $('#paste-msg').textContent = bits.join(' ');
}
function validateOnline(ex) {
  for (let i = 0; i < ex.items.length; i++) {
    const it = ex.items[i], filled = it.c.slice(0, ex.choices).filter(s => String(s).trim()).length;
    if (!it.q.trim() || filled < 2) return `Item ${i + 1} needs question text and at least two choices before it can go online.`;
    if (!it.a && !it.bonus) return `Item ${i + 1} has no answer key.`;
  }
  return '';
}
async function publish(ex) {
  const err = validateOnline(ex);
  if (err) { toast(err); return; }
  if (!ASSETS) { toast('Publishing needs you signed in to Claude as the owner of this page.'); return; }
  try {
    const res = await ASSETS.upload(new Blob([JSON.stringify(studentPayload(ex))], { type: 'application/json' }), { type: 'application/json' });
    const old = ex.pub && ex.pub.assetId;
    ex.pub = { assetId: res.id, at: Date.now(), sig: sigOf(ex) };
    touch(ex); put('exams', ex.id, ex);
    if (old) { try { await ASSETS.delete(old); } catch (e) { /* old link may linger */ } }
    render(); toast('Student link published.');
  } catch (e) { toast('Could not publish (' + ((e && e.code) || 'error') + '). Check your connection and try again.'); }
}
async function unpublish(ex) {
  const old = ex.pub && ex.pub.assetId;
  ex.pub = null; touch(ex); put('exams', ex.id, ex);
  if (old && ASSETS) { try { await ASSETS.delete(old); } catch (e) { /* ignore */ } }
  render(); toast('Student link closed.');
}

/* ---------- answer sheet PDF ---------- */

async function sheetPDF(ex) {
  if (!DL) { toast('Downloads are not available in this view.'); return; }
  const c = cfg(), lay = PM.layout(ex.nItems, ex.choices, c.idLen);
  const bytes = PM.sheetPDF(lay, { paper: c.paper, title: ex.title, footer: 'SnapGrade · ' + ex.title + ' · ' + ex.nItems + ' items' });
  try {
    await DL.save({ filename: slug(ex.title) + '-answer-sheet.pdf', data: bytes });
    toast('Answer sheet ready. Print at 100% scale, not "fit to page".');
  } catch (e) { if (!e || e.code !== 'declined') toast('Could not save the PDF.'); }
}

/* ---------- scanning ---------- */
async function fileToGray(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const sc = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = (d[4 * i] * 77 + d[4 * i + 1] * 151 + d[4 * i + 2] * 28) >> 8;
    return { gray: g, w, h };
  } finally { URL.revokeObjectURL(url); }
}
async function onFiles(files) {
  const ex = getExam(T.scanExam);
  if (!ex) { toast('Choose an exam first.'); return; }
  const lay = PM.layout(ex.nItems, ex.choices, cfg().idLen);
  for (const f of Array.prototype.slice.call(files)) {
    const s = { id: uid(), file: f.name || 'Photo', examId: ex.id, state: 'reading' };
    T.scans.unshift(s); T.scans = T.scans.slice(0, 12);
    render(); await tick();
    try {
      const im = await fileToGray(f), res = PM.scan(im.gray, im.w, im.h, lay, { thr: cfg().thr });
      if (!res.ok) {
        s.state = 'fail';
        s.err = 'Could not find the four black corner squares. Lay the sheet flat, keep every corner in the frame, and avoid shadows across the page. Then try again.';
      } else {
        const full = res.idStr.indexOf('_') < 0 && res.idStr.indexOf('*') < 0;
        s.state = 'ready'; s.res = res; s.ans = res.answers.slice();
        s.sid = full ? res.idStr : ''; s.idHint = full ? '' : 'Read as ' + res.idStr.replace(/\*/g, '?').replace(/_/g, '-');
        s.name = rosterName(s.sid);
        s.warnTxt = res.marked < Math.max(1, Math.floor(ex.nItems * 0.3)) ? 'Very few answers were detected. Check that the photo is sharp and the bubbles are filled darkly.' : '';
      }
    } catch (e) { s.state = 'fail'; s.err = 'This photo could not be opened. Try taking it again.'; }
    render(); await tick();
  }
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function drawReview(s) {
  const cv = $('[data-cv="' + s.id + '"]');
  if (!cv || !s.res) return;
  const ex = getExam(s.examId), lay = PM.layout(ex.nItems, ex.choices, cfg().idLen), wp = s.res.warp;
  cv.width = wp.w; cv.height = wp.h;
  const cx = cv.getContext('2d'), img = cx.createImageData(wp.w, wp.h);
  for (let i = 0; i < wp.data.length; i++) { const v = wp.data[i]; img.data[4 * i] = v; img.data[4 * i + 1] = v; img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255; }
  cx.putImageData(img, 0, 0);
  const good = cssVar('--good') || '#1f7a4d', bad = cssVar('--bad') || '#b8322e', warn = cssVar('--warn') || '#8f5b00';
  const P = v => (v + PM.PAD) * PM.S;
  lay.qs.forEach(q => {
    const a = s.ans[q.i], it = ex.items[q.i], okk = PM.right(it, a);
    q.b.forEach(b => {
      const x = P(b.x), y = P(b.y), r = PM.R * PM.S;
      if (a === b.c) { cx.globalAlpha = 0.55; cx.fillStyle = okk ? good : bad; cx.beginPath(); cx.arc(x, y, r * 0.95, 0, 7); cx.fill(); cx.globalAlpha = 1; }
      if (a === '*') { cx.strokeStyle = warn; cx.lineWidth = 3; cx.beginPath(); cx.arc(x, y, r * 1.15, 0, 7); cx.stroke(); }
      if (!okk && it.a === b.c) { cx.strokeStyle = good; cx.lineWidth = 3.5; cx.beginPath(); cx.arc(x, y, r * 1.25, 0, 7); cx.stroke(); }
    });
    const lb = q.b[q.b.length - 1];
    cx.fillStyle = okk ? good : bad; cx.font = 'bold 15px sans-serif';
    cx.fillText(okk ? '✓' : '✗', P(lb.x + 6.5), P(q.y + 1.2));
  });
}
function tapReview(e) {
  const cv = e.target.closest('canvas[data-cv]');
  if (!cv) return;
  const s = T.scans.find(x => x.id === cv.dataset.cv);
  if (!s || s.state !== 'ready') return;
  const rect = cv.getBoundingClientRect();
  const tx = (e.clientX - rect.left) / rect.width * cv.width / PM.S - PM.PAD, ty = (e.clientY - rect.top) / rect.height * cv.height / PM.S - PM.PAD;
  const ex = getExam(s.examId), lay = PM.layout(ex.nItems, ex.choices, cfg().idLen);
  let best = null, bd = 4;
  lay.qs.forEach(q => q.b.forEach(b => { const d = Math.hypot(b.x - tx, b.y - ty); if (d < bd) { bd = d; best = { q: q.i, c: b.c }; } }));
  if (!best) return;
  s.ans[best.q] = s.ans[best.q] === best.c ? '' : best.c;
  drawReview(s);
  const g = PM.grade(ex, s.ans), pill = $('#sc-' + s.id), fl = $('#fl-' + s.id);
  if (pill) pill.textContent = g.earned + ' / ' + g.total;
  if (fl) fl.innerHTML = flagHTML(s);
}
function saveScan(s, quiet) {
  const ex = getExam(s.examId), dup = findDup(s), id = dup ? dup.id : uid();
  const rec = { id, examId: ex.id, source: 'scan', sid: s.sid.trim(), name: s.name.trim(), section: '', answers: s.ans.map(a => a || '-').join(''), ts: Date.now() };
  put('results', id, rec);
  const g = PM.grade(ex, s.ans);
  s.state = 'saved'; s.res = null;
  s.label = (rec.name || rec.sid || 'Student') + ' · ' + g.earned + ' of ' + g.total;
  if (!quiet) { render(); toast('Saved: ' + s.label); }
}
function saveAllReady() {
  let saved = 0, skipped = 0;
  T.scans.filter(s => s.state === 'ready').forEach(s => {
    if (s.sid && s.sid.trim() && s.ans.indexOf('*') < 0) { saveScan(s, true); saved++; } else skipped++;
  });
  render();
  toast(`Saved ${saved} sheet${saved === 1 ? '' : 's'}${skipped ? `, ${skipped} need a look` : ''}.`);
}

/* ---------- results ---------- */
function importCodes(text) {
  const found = text.match(/PM1\.[A-Za-z0-9_-]+\.[a-z0-9]+/g) || [];
  let ok = 0, dup = 0, bad = 0, other = 0;
  found.forEach(code => {
    const parts = code.split('.'), b = parts[1], cs = parts[2];
    if (crc(b) !== cs) { bad++; return; }
    let p;
    try { p = JSON.parse(b64d(b)); } catch (e) { bad++; return; }
    const ex = p && typeof p.x === 'string' ? getExam(p.x) : null;
    if (!ex) { other++; return; }
    const rid = 'o' + cs + b.length.toString(36);
    if (has(T.S.results, rid)) { dup++; return; }
    const w = Array.isArray(p.w) ? p.w.slice(0, 40).filter(e => Array.isArray(e)).map(e => [e[0] | 0, e[1] | 0, e[2] === 'h' || e[2] === 'r' ? e[2] : 'b']) : [];
    put('results', rid, {
      id: rid, examId: ex.id, source: 'online', sid: String(p.i || '').slice(0, 20), name: String(p.n || '').slice(0, 80), section: String(p.s || '').slice(0, 30),
      answers: String(p.a || '').replace(/[^A-E*-]/g, '').slice(0, 60), ts: +p.ts || Date.now(), secs: +p.t | 0, reason: String(p.r || '').slice(0, 8), cp: p.cp | 0,
      away: { n: w.length, secs: w.reduce((t, e) => t + e[1], 0), ev: w }
    });
    ok++;
  });
  if (!found.length) return 'No codes found in that text.';
  return `Imported ${ok}${dup ? `, ${dup} already imported` : ''}${bad ? `, ${bad} damaged (ask for a resend)` : ''}${other ? `, ${other} for exams not in this account` : ''}.`;
}
async function exportCSV(ex) {
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = rowsFor(ex).sort((a, b) => String(a.r.name || a.r.sid).localeCompare(String(b.r.name || b.r.sid)));
  const head = ['Name', 'Student ID', 'Section', 'Source', 'Score', 'Total', 'Percent', cfg().scale === 'deped' ? 'DepEd grade' : 'Grade', 'Result', 'Times away', 'Seconds away'].concat(ex.items.map((_, i) => 'Q' + (i + 1)));
  const lines = [head.map(q).join(',')];
  lines.push(['ANSWER KEY'].concat(new Array(10).fill('')).concat(ex.items.map(it => (it.bonus ? 'ALL' : it.a))).map(q).join(','));
  rows.forEach(x => {
    const r = x.r;
    lines.push([r.name, r.sid, r.section, r.source === 'online' ? 'Online' : 'Paper', x.g.earned, x.g.total, x.pct, x.gr, x.pass ? 'Passed' : 'Not passed', r.away ? r.away.n : '', r.away ? r.away.secs : ''].concat(x.ans.slice(0, ex.items.length).map(a => a || '')).map(q).join(','));
  });
  try { await DL.save({ filename: slug(ex.title) + '-results.csv', data: '﻿' + lines.join('\r\n') }); toast('Results exported.'); }
  catch (e) { if (!e || e.code !== 'declined') toast('Could not save the file.'); }
}

/* ---------- offline exam file ---------- */
function standaloneHTML(ex) {
  const css = ($('#pm-css') || {}).textContent, omr = ($('#pm-omr') || {}).textContent, app = ($('#pm-app') || {}).textContent;
  if (!css || !omr || !app) return '';
  const data = JSON.stringify(Object.assign(studentPayload(ex), { sig: sigOf(ex) })).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(ex.title) + '</title>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;600&display=swap">'
    + '<style>' + css + '</style></head><body><div class="wrap"><div id="app"></div></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>'
    + '<script>window.__PM_EXAM=' + data + ';<\/script><script>' + omr + '<\/script><script>' + app + '<\/script></body></html>';
}
async function examFile(ex) {
  const err = validateOnline(ex);
  if (err) { toast(err); return; }
  const html = standaloneHTML(ex);
  if (!html) { toast('Could not build the exam file from this view.'); return; }
  if (!DL) {
    const ok = await copyText(html, null);
    if (ok) { toast('Exam file copied. Paste it into Notepad and save as .html.'); }
    else { T.srcText = html; render(); const box = $('#src-box'); if (box) { box.focus(); box.select(); } toast('Copy the text in the box below.'); }
    return;
  }
  try { await DL.save({ filename: slug(ex.title) + '-exam.html', data: html }); toast('Exam file ready. Send it to students.'); }
  catch (e) { if (!e || e.code !== 'declined') toast('Could not save the exam file.'); }
}

/* ---------- backup and restore ---------- */
async function backup() {
  if (!DL) { toast('Downloads are not available in this view.'); return; }
  const d = new Date(), stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  try {
    await DL.save({ filename: 'snapgrade-backup-' + stamp + '.json', data: JSON.stringify({ app: 'snapgrade', v: 1, at: Date.now(), exams: T.S.exams, results: T.S.results, settings: T.S.settings }) });
    toast('Backup saved.');
  } catch (e) { if (!e || e.code !== 'declined') toast('Could not save the backup.'); }
}
function cleanExam(id, e) {
  const k = Math.max(2, Math.min(5, (e.choices | 0) || 4));
  const items = e.items.slice(0, 60).map(it => {
    it = it || {};
    const c = (Array.isArray(it.c) ? it.c : []).slice(0, 5).map(x => String(x == null ? '' : x).slice(0, 500));
    while (c.length < k) c.push('');
    return { q: String(it.q || '').slice(0, 2000), c, a: typeof it.a === 'string' && it.a.length === 1 && LET.indexOf(it.a) >= 0 && LET.indexOf(it.a) < k ? it.a : '', pts: it.pts > 0 ? Math.min(20, +it.pts) : 1, bonus: !!it.bonus, tag: String(it.tag || '').trim().slice(0, 30) };
  });
  const pa = e.pub && typeof e.pub.assetId === 'string' && /^[0-9a-f]{32}$/.test(e.pub.assetId) ? e.pub : null;
  return {
    id, title: String(e.title || 'Untitled exam').slice(0, 80), subject: String(e.subject || '').slice(0, 60), choices: k, nItems: items.length, items,
    minutes: Math.max(0, Math.min(300, e.minutes | 0)), shuffleQ: !!e.shuffleQ, shuffleC: !!e.shuffleC, maxAway: Math.max(0, Math.min(20, e.maxAway | 0)),
    instructions: String(e.instructions || '').slice(0, 1000), createdAt: +e.createdAt || Date.now(), updatedAt: +e.updatedAt || Date.now(),
    pub: pa ? { assetId: pa.assetId, at: +pa.at || 0, sig: String(pa.sig || '').slice(0, 20) } : null
  };
}
function cleanResult(id, r) {
  const out = {
    id, examId: r.examId, source: r.source === 'online' ? 'online' : 'scan', sid: String(r.sid || '').slice(0, 20), name: String(r.name || '').slice(0, 80),
    section: String(r.section || '').slice(0, 30), answers: String(r.answers || '').replace(/[^A-E*-]/g, '').slice(0, 60), ts: +r.ts || Date.now(),
    secs: +r.secs | 0, reason: String(r.reason || '').slice(0, 8), cp: r.cp | 0
  };
  if (r.away && typeof r.away === 'object') {
    out.away = { n: r.away.n | 0, secs: r.away.secs | 0, ev: Array.isArray(r.away.ev) ? r.away.ev.slice(0, 40).filter(Array.isArray).map(e => [e[0] | 0, e[1] | 0, e[2] === 'h' || e[2] === 'r' ? e[2] : 'b']) : [] };
  }
  return out;
}
async function restoreBackup(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch (e) { return 'That file is not a SnapGrade backup.'; }
  if (!d || d.app !== 'snapgrade' || !d.exams || typeof d.exams !== 'object' || !d.results || typeof d.results !== 'object') return 'That file is not a SnapGrade backup.';
  let ne = 0, nr = 0, skipped = 0;
  Object.keys(d.exams).forEach(id => {
    const e = d.exams[id];
    if (!okId(id) || !e || e.id !== id || !Array.isArray(e.items)) { skipped++; return; }
    const cur = getExam(id);
    if (!cur || (+e.updatedAt || 0) > (cur.updatedAt || 0)) { put('exams', id, cleanExam(id, e)); ne++; }
  });
  Object.keys(d.results).forEach(id => {
    const r = d.results[id];
    if (!okId(id) || !r || r.id !== id || typeof r.examId !== 'string') { skipped++; return; }
    if (!has(T.S.results, id)) { put('results', id, cleanResult(id, r)); nr++; }
  });
  const a = d.settings && d.settings.app;
  if (a && typeof a === 'object' && !T.S.settings.app) {
    put('settings', 'app', {
      paper: a.paper === 'letter' ? 'letter' : 'a4', idLen: Math.max(4, Math.min(12, a.idLen | 0 || 6)), thr: Math.max(0.1, Math.min(0.35, +a.thr || 0.18)),
      roster: String(a.roster || '').slice(0, 30000), base: String(a.base || '').slice(0, 300), scale: a.scale === 'deped' ? 'deped' : 'pct', pass: a.pass === '' || a.pass == null ? '' : String(parseFloat(a.pass) || '')
    });
  }
  return `Restored ${ne} exam${ne === 1 ? '' : 's'} and ${nr} result${nr === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`;
}

/* ---------- events ---------- */
let armedKey = '';
function arm(key, btn, label) {
  if (armedKey === key) { armedKey = ''; return true; }
  armedKey = key; btn.textContent = label;
  setTimeout(() => { if (armedKey === key) armedKey = ''; }, 3500);
  return false;
}
function onClick(e) {
  const a = e.target.closest('[data-act]');
  if (!a) { tapReview(e); return; }
  const act = a.dataset.act, ex = T.editing ? getExam(T.editing) : null;
  switch (act) {
    case 'tab': T.tab = a.dataset.t; if (T.tab !== 'exams') T.editing = null; render(); break;
    case 'local': T.mode = 'local'; shellHTML(); render(); break;
    case 'new-exam': { const n = +a.dataset.n || 20, e2 = newExam(n); put('exams', e2.id, e2); T.editing = e2.id; T.menu = e2.id; T.sub = ''; T.open = {}; T.tab = 'exams'; render(); break; }
    case 'open-exam': T.menu = a.dataset.id; T.sub = ''; T.mtab = 'details'; render(); break;
    case 'menu-back': if (T.sub) T.sub = ''; else T.menu = null; render(); window.scrollTo(0, 0); break;
    case 'mtab': T.mtab = a.dataset.t; render(); break;
    case 'edit-key': if (T.menu && getExam(T.menu)) { T.editing = T.menu; T.open = {}; T.warn = ''; render(); window.scrollTo(0, 0); } break;
    case 'go-scan': T.scanExam = T.menu; T.tab = 'scan'; render(); break;
    case 'go-review': T.resExam = T.menu; T.rowOpen = ''; T.importMsg = ''; T.tab = 'results'; render(); break;
    case 'open-ia': T.menu = a.dataset.id || T.menu; T.sub = 'ia'; T.tab = 'exams'; T.editing = null; render(); window.scrollTo(0, 0); break;
    case 'open-tags': T.sub = 'tags'; render(); window.scrollTo(0, 0); break;
    case 'tag-apply': {
      const m = getExam(T.menu); if (!m) break;
      const n = m.items.length, fr = Math.max(1, Math.min(n, +$('#tg-from').value || 1)), to = Math.max(1, Math.min(n, +$('#tg-to').value || fr)), name = $('#tg-name').value.trim().slice(0, 30);
      for (let i = Math.min(fr, to) - 1; i < Math.max(fr, to); i++) m.items[i].tag = name;
      touch(m); render(); toast(name ? `Tagged items ${Math.min(fr, to)} to ${Math.max(fr, to)}.` : 'Tags cleared.'); break;
    }
    case 'edit-exam': T.editing = a.dataset.id; T.menu = a.dataset.id; T.open = {}; T.warn = ''; render(); break;
    case 'close-editor': clearTimeout(saveTimer); if (ex) put('exams', ex.id, ex); T.editing = null; render(); window.scrollTo(0, 0); break;
    case 'set-n': if (ex) setCount(ex, +a.dataset.n); break;
    case 'set-k': if (ex) setChoices(ex, +a.dataset.k); break;
    case 'key': if (ex) { const it = ex.items[+a.dataset.i]; it.a = it.a === a.dataset.l ? '' : a.dataset.l; touch(ex); $('#items').innerHTML = itemsHTML(ex); } break;
    case 'open-item': T.open[a.dataset.i] = !T.open[a.dataset.i]; if (ex) $('#items').innerHTML = itemsHTML(ex); break;
    case 'apply-quick': if (ex) {
      const s = $('#e-quick').value.toUpperCase().replace(/[^A-E]/g, '');
      if (!s) { toast('Type letters like ABCD, one per item.'); break; }
      for (let i = 0; i < ex.items.length && i < s.length; i++) ex.items[i].a = LET.indexOf(s[i]) < ex.choices ? s[i] : '';
      touch(ex); $('#items').innerHTML = itemsHTML(ex);
      toast(s.length === ex.items.length ? 'Key applied.' : `Key applied to ${Math.min(s.length, ex.items.length)} of ${ex.items.length} items.`);
    } break;
    case 'parse-paste': if (ex) importPasted(ex); break;
    case 'pick-qfile': $('#in-qfile').click(); break;
    case 'sheet-pdf': if (ex) sheetPDF(ex); break;
    case 'publish': if (ex) publish(ex); break;
    case 'unpublish': if (ex && arm('unpub', a, 'Tap again to close the link')) unpublish(ex); break;
    case 'copy-link': copyText($('#plink').value, $('#plink')).then(ok => toast(ok ? 'Link copied.' : 'Select the link and copy it.')); break;
    case 'del-exam': if (ex && arm('delex', a, 'Tap again to delete exam and its results')) {
      resultsOf(ex.id).forEach(r => put('results', r.id, null));
      const old = ex.pub && ex.pub.assetId; if (old && ASSETS) ASSETS.delete(old).catch(() => {});
      put('exams', ex.id, null); T.editing = null; T.menu = null; T.sub = ''; render();
    } break;
    case 'pick-cam': $('#in-cam').click(); break;
    case 'pick-file': $('#in-file').click(); break;
    case 'scan-save': { const s = T.scans.find(x => x.id === a.dataset.sid); if (s) saveScan(s); break; }
    case 'scan-drop': T.scans = T.scans.filter(x => x.id !== a.dataset.sid); render(); break;
    case 'row': T.rowOpen = T.rowOpen === a.dataset.id ? '' : a.dataset.id; render(); break;
    case 'del-result': if (arm('delr' + a.dataset.id, a, 'Tap again to delete')) { put('results', a.dataset.id, null); T.rowOpen = ''; render(); } break;
    case 'import': { T.importMsg = importCodes($('#imp').value); render(); break; }
    case 'export-csv': { const e2 = getExam(T.resExam); if (e2) exportCSV(e2); break; }
    case 'exam-file': if (ex) examFile(ex); break;
    case 'hide-src': T.srcText = ''; render(); break;
    case 'backup': backup(); break;
    case 'restore': $('#in-restore').click(); break;
    case 'scan-all': saveAllReady(); break;
    default: break;
  }
}
function onInput(e) {
  const t = e.target, ex = T.editing ? getExam(T.editing) : null;
  if (t.dataset.f && ex) {
    const f = t.dataset.f;
    if (t.type === 'checkbox') ex[f] = t.checked;
    else if (f === 'minutes' || f === 'maxAway') ex[f] = Math.max(0, Math.min(f === 'minutes' ? 300 : 20, +t.value || 0));
    else ex[f] = t.value;
    touch(ex);
    if (ex.pub && $('#pub')) $('#pub').innerHTML = pubHTML(ex);
  } else if (t.dataset.k && ex) {
    const it = ex.items[+t.dataset.i], k = t.dataset.k;
    if (k === 'q') it.q = t.value;
    else if (k === 'pts') { const v = parseFloat(t.value); it.pts = v > 0 ? Math.min(20, v) : 1; }
    else if (k === 'bonus') it.bonus = !!t.checked;
    else if (k === 'tag') it.tag = t.value.slice(0, 30);
    touch(ex);
    if (k === 'bonus') $('#items').innerHTML = itemsHTML(ex);
  }
  else if (t.dataset.c !== undefined && ex) { ex.items[+t.dataset.i].c[+t.dataset.c] = t.value; touch(ex); }
  else if (t.dataset.s) {
    const k = t.dataset.s;
    onInput.t = onInput.t || {};
    clearTimeout(onInput.t[k]);
    const val = k === 'thr' || k === 'idLen' ? +t.value : k === 'base' ? t.value.trim() : t.value;
    onInput.t[k] = setTimeout(() => setCfg({ [k]: val }), 400);
    if (k === 'thr') t.closest('label').firstChild.textContent = 'Mark sensitivity: ' + (+t.value).toFixed(2);
  } else if (t.dataset.sf) {
    const s = T.scans.find(x => x.id === t.dataset.sid);
    if (s) s[t.dataset.sf] = t.value;
  } else if (t.id === 'f-n' && ex) {
    const n = +t.value;
    if (n >= 1 && n <= 60) { clearTimeout(onInput.n); onInput.n = setTimeout(() => setCount(ex, n), 700); }
  }
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'in-cam' || t.id === 'in-file') { const files = t.files; if (files && files.length) onFiles(files).then(() => { t.value = ''; }); return; }
  if (t.id === 'in-qfile') {
    const f = t.files && t.files[0], ex = T.editing ? getExam(T.editing) : null;
    if (f && ex) f.text().then(txt => { $('#e-paste').value = txt; importPasted(ex); $('#paste-msg').textContent = 'From ' + f.name + ': ' + $('#paste-msg').textContent; }).catch(() => { $('#paste-msg').textContent = 'Could not read that file.'; }).finally(() => { t.value = ''; });
    return;
  }
  if (t.id === 'in-restore') { const f = t.files && t.files[0]; if (f) restoreBackup(f).then(m => { T.restoreMsg = m; t.value = ''; render(); }); return; }
  if (t.dataset.k === 'pts') { const ex = T.editing ? getExam(T.editing) : null; if (ex && $('#items')) $('#items').innerHTML = itemsHTML(ex); return; }
  if (t.dataset.s === 'scale') { setCfg({ scale: t.value, pass: '' }); render(); return; }
  if (t.dataset.act === 'pick-exam') { T.scanExam = t.value; render(); return; }
  if (t.dataset.act === 'pick-res') { T.resExam = t.value; T.rowOpen = ''; T.importMsg = ''; render(); return; }
  if (t.dataset.act === 'sort') { T.sort = t.value; render(); return; }
  if (t.dataset.sf === 'sid') {
    const s = T.scans.find(x => x.id === t.dataset.sid);
    if (s) { const nm = rosterName(s.sid.trim()); if (nm && !s.name) { s.name = nm; const inp = $('[data-sf="name"][data-sid="' + s.id + '"]'); if (inp) inp.value = nm; } render(); }
  }
}

async function teacher() {
  document.body.classList.add('is-teacher');
  const cached = LS.get(CACHE_KEY, null);
  if (cached && typeof cached === 'object') T.S = { exams: cached.exams || {}, results: cached.results || {}, settings: cached.settings || {} };
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('online', () => { syncChip(); flush(); });
  window.addEventListener('offline', syncChip);
  document.addEventListener('visibilitychange', () => { if (document.hidden && T.editing) { const ex = getExam(T.editing); if (ex) { clearTimeout(saveTimer); put('exams', ex.id, ex); } } });
  shellHTML();
  $('#view').innerHTML = '<p class="muted pad">Opening…</p>';
  const use = n => (window.claude && window.claude.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
  const r = await Promise.all([use('user'), use('db'), use('assets'), use('downloads')]);
  let can = false;
  try { can = !!(r[0] && ((await r[0].canEdit()) || (await r[0].isOwner()))); } catch (e) { can = false; }
  DL = r[3]; ASSETS = r[2];
  if (can) { T.mode = 'owner'; db = r[1]; if (db) { subscribe(); flush(); } }
  else T.mode = 'gate';
  render();
}

/*__TEST_HOOK__*/
(function main() {
  const h = location.hash.slice(1);
  if (window.__PM_EXAM) student('');
  else if (/^q[0-9a-f]{32}$/.test(h)) student(h);
  else teacher();
  window.addEventListener('hashchange', () => location.reload());
})();
