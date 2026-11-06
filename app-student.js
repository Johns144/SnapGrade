/* ---------- student exam page ---------- */
async function student(token) {
  const app = $('#app');
  document.body.classList.add('is-student');
  app.innerHTML = '<div class="stu"><p class="muted">Loading exam…</p></div>';
  let ex;
  try {
    if (window.__PM_EXAM) ex = window.__PM_EXAM;
    else {
      const r = await fetch('/_blob/' + token.slice(1), { cache: 'no-store' });
      if (!r.ok) throw new Error('http');
      ex = await r.json();
    }
    if (!ex || !Array.isArray(ex.items) || !ex.items.length) throw new Error('bad');
  } catch (e) {
    app.innerHTML = '<div class="stu"><h1>This exam link is not working</h1><p class="muted">It may be closed, or the link was copied incompletely. Ask your teacher to send it again.</p></div>';
    return;
  }
  const N = ex.items.length, KEY = 'pm-attempt-' + (token || ('f' + ex.id + (ex.sig || '')));
  let A = LS.get(KEY, null);
  let awayAt = null, awayWhy = '', timerId = null, running = false;
  const save = () => LS.set(KEY, A);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const answered = () => A.ans.filter(v => v >= 0).length;
  const flagged = () => A.order.map((o, p) => (A.fl[o] ? p + 1 : 0)).filter(Boolean);

  function intro() {
    const mins = ex.minutes | 0;
    app.innerHTML = `<div class="stu">
      <div><h1>${esc(ex.title)}</h1>${ex.subject ? `<p class="muted">${esc(ex.subject)}</p>` : ''}</div>
      ${ex.instructions ? `<p>${esc(ex.instructions)}</p>` : ''}
      <ul class="rules">
        <li>${N} question${N === 1 ? '' : 's'}${mins ? `, ${mins} minute${mins === 1 ? '' : 's'}. The exam submits itself when time runs out.` : ', no time limit.'}</li>
        <li>Stay on this page. Opening another tab, window or app is recorded and your teacher can see it.</li>
        ${ex.maxAway > 0 ? `<li>After ${ex.maxAway} time${ex.maxAway === 1 ? '' : 's'} away, the exam submits itself.</li>` : ''}
        <li>Your score is not shown here. At the end you get a code to send to your teacher.</li>
      </ul>
      <div class="sheethead"><span class="cap">Fill in before you start</span>
      <label class="f">Full name<input id="s-name" autocomplete="name" maxlength="80"></label>
      <div class="grid2">
        <label class="f">Student ID <span class="opt">optional</span><input id="s-id" inputmode="numeric" maxlength="20"></label>
        <label class="f">Section <span class="opt">optional</span><input id="s-sec" maxlength="30"></label>
      </div></div>
      <div><button class="btn primary" id="s-go" disabled>Start exam</button></div>
    </div>`;
    const name = $('#s-name'), go = $('#s-go');
    name.addEventListener('input', () => { go.disabled = name.value.trim().length < 2; });
    go.addEventListener('click', () => begin(name.value.trim(), $('#s-id').value.trim(), $('#s-sec').value.trim()));
    name.focus();
  }

  function begin(name, sid, section) {
    const order = ex.items.map((_, i) => i);
    if (ex.shuffleQ) shuffle(order);
    const corder = ex.items.map(it => { const p = it.c.map((_, j) => j); return ex.shuffleC ? shuffle(p) : p; });
    A = { v: 1, name, sid, section, order, corder, ans: new Array(N).fill(-1), fl: new Array(N).fill(false), start: Date.now(), ev: [], cp: 0, cur: 0 };
    save(); run();
  }

  function run() {
    if (!Array.isArray(A.fl)) A.fl = new Array(N).fill(false);
    running = true;
    shell();
    renderQ();
    tickTimer();
    timerId = setInterval(tickTimer, 1000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onBack);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('contextmenu', blockMenu);
    document.addEventListener('copy', onCopy);
  }

  function stop() {
    running = false;
    clearInterval(timerId);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onBack);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('contextmenu', blockMenu);
    document.removeEventListener('copy', onCopy);
    const o = $('#awayov'); if (o) o.remove();
  }

  /* Away detection: one event per stretch where the page is hidden or loses focus. */
  function leave(why) {
    if (!running) return;
    if (!awayAt) { awayAt = Date.now(); awayWhy = why; }
    else if (why === 'h') awayWhy = 'h';
  }
  function onVis() { if (document.hidden) leave('h'); else onBack(); }
  function onBlur() { leave('b'); }
  function onHide() { leave('h'); }
  function onBack() {
    if (!running || !awayAt) return;
    if (document.hidden || (document.hasFocus && !document.hasFocus())) return;
    const dur = Date.now() - awayAt, why = awayWhy, at = awayAt;
    awayAt = null; awayWhy = '';
    if (why === 'b' && dur < 1500) return;          // a quick click outside the page is not a tab switch
    A.ev.push([Math.round((at - A.start) / 1000), Math.round(dur / 1000), why]);
    save();
    updateAwayBadge();
    if (ex.maxAway > 0 && A.ev.length >= ex.maxAway) { finish('away'); return; }
    showAway();
  }
  function blockMenu(e) { e.preventDefault(); }
  function onCopy(e) { e.preventDefault(); A.cp++; save(); }

  function showAway() {
    let o = $('#awayov');
    if (!o) { o = document.createElement('div'); o.id = 'awayov'; o.className = 'awayov'; document.body.appendChild(o); }
    const n = A.ev.length, left = ex.maxAway > 0 ? ex.maxAway - n : 0;
    o.innerHTML = `<div class="awaybox" role="alertdialog" aria-label="You left the exam page">
      <h2>You left the exam page</h2>
      <p>This was recorded (${n} so far) and your teacher will see it.${left > 0 ? ` <b>${left} more and the exam submits automatically.</b>` : ''}</p>
      <button class="btn primary" id="away-ok">Back to the exam</button></div>`;
    o.hidden = false;
    $('#away-ok').addEventListener('click', () => { o.remove(); });
  }

  function shell() {
    app.innerHTML = `<div class="stu">
      <div class="sbar"><div><b>${esc(ex.title)}</b><div class="muted" style="font-size:13px">${esc(A.name)}</div></div><div class="timer" id="timer"></div></div>
      <div class="prog" aria-hidden="true"><i id="prog"></i></div>
      <div id="qa"></div>
      <div class="qmap" id="qmap" role="group" aria-label="Question map"></div>
      <div class="srow"><div class="row"><button class="btn" id="prev">Back</button><button class="btn" id="next">Next</button></div>
        <button class="btn primary" id="submit">Review and submit</button></div>
      <div id="away-n" class="hint"></div>
    </div>`;
    $('#prev').addEventListener('click', () => go(A.cur - 1));
    $('#next').addEventListener('click', () => go(A.cur + 1));
    $('#submit').addEventListener('click', confirmSubmit);
    $('#qa').addEventListener('click', e => {
      const oi = A.order[A.cur];
      if (e.target.closest('[data-flag]')) { A.fl[oi] = !A.fl[oi]; save(); renderQ(); return; }
      const b = e.target.closest('[data-j]');
      if (!b) return;
      const orig = A.corder[oi][+b.dataset.j];
      A.ans[oi] = A.ans[oi] === orig ? -1 : orig;
      save(); renderQ();
    });
    $('#qmap').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) go(+b.dataset.q); });
    updateAwayBadge();
  }

  function go(i) { A.cur = Math.max(0, Math.min(N - 1, i)); save(); renderQ(); }

  function renderQ() {
    const oi = A.order[A.cur], it = ex.items[oi], perm = A.corder[oi], fl = !!A.fl[oi];
    $('#qa').innerHTML = `<div class="qh">Question ${A.cur + 1} of ${N}</div>
      <p class="qtext">${esc(it.q)}</p>
      <div class="choices">${perm.map((orig, j) => `<button class="choice" data-j="${j}" aria-pressed="${A.ans[oi] === orig}"><span class="bub sm" aria-hidden="true">${LET[j]}</span><span>${esc(it.c[orig])}</span></button>`).join('')}</div>
      <div><button class="btn ghost" data-flag="1" aria-pressed="${fl}">${fl ? 'Marked for later. Tap to unmark' : 'Mark for later'}</button></div>`;
    $('#qmap').innerHTML = A.order.map((o, p) => `<button class="qm${A.ans[o] >= 0 ? ' done' : ''}${A.fl[o] ? ' fl' : ''}${p === A.cur ? ' cur' : ''}" data-q="${p}" aria-label="Question ${p + 1}${A.ans[o] >= 0 ? ', answered' : ''}${A.fl[o] ? ', marked for later' : ''}">${p + 1}</button>`).join('');
    $('#prog').style.width = Math.round(100 * answered() / N) + '%';
    $('#prev').disabled = A.cur === 0;
    $('#next').disabled = A.cur === N - 1;
  }

  function updateAwayBadge() {
    const el = $('#away-n');
    if (el) el.textContent = A.ev.length ? `Times you left this page: ${A.ev.length}` : '';
  }

  function tickTimer() {
    const t = $('#timer');
    if (!t) return;
    if (!(ex.minutes > 0)) { t.textContent = ''; return; }
    const left = Math.round((A.start + ex.minutes * 60000 - Date.now()) / 1000);
    t.textContent = fmtTime(left);
    t.classList.toggle('low', left <= 60);
    if (left <= 0) finish('time');
  }

  function confirmSubmit() {
    const un = N - answered(), fl = flagged();
    $('#qa').innerHTML = `<h2>Ready to submit?</h2>
      <p>${un ? `You have ${un} unanswered question${un === 1 ? '' : 's'}. Tap a number below to go back.` : 'You answered every question.'}</p>
      ${fl.length ? `<p class="note warn">You marked ${fl.length === 1 ? 'question' : 'questions'} ${fl.join(', ')} for later.</p>` : ''}
      <div class="row"><button class="btn primary" id="yes">Submit exam</button><button class="btn" id="no">Keep working</button></div>`;
    $('#yes').addEventListener('click', () => finish('done'));
    $('#no').addEventListener('click', renderQ);
  }

  function finish(reason) {
    if (A.code) return;
    stop();
    const payload = {
      v: 1, x: ex.id, n: A.name, i: A.sid, s: A.section,
      a: A.ans.map(v => v < 0 ? '-' : LET[v]).join(''),
      w: A.ev, cp: A.cp, t: Math.round((Date.now() - A.start) / 1000), ts: Date.now(), r: reason
    };
    const b = b64e(JSON.stringify(payload));
    A.code = 'PM1.' + b + '.' + crc(b); A.reason = reason;
    save(); done();
  }

  function done() {
    const why = { time: 'Time ran out, so your exam was submitted.', away: 'Your exam was submitted because you left the page too many times.', done: 'Your answers are saved.' }[A.reason] || 'Your answers are saved.';
    app.innerHTML = `<div class="stu">
      <h1>Exam finished</h1>
      <p>${why} Send the code below to your teacher exactly as it appears. Taking a screenshot of this screen is a good backup.</p>
      <textarea class="code" id="code" readonly rows="5" aria-label="Your submission code">${esc(A.code)}</textarea>
      <div class="row"><button class="btn primary" id="copy">Copy code</button><span class="hint" id="copied"></span></div>
      <p class="hint">${esc(A.name)}${A.ev.length ? ` · left the page ${A.ev.length} time${A.ev.length === 1 ? '' : 's'}` : ''}</p>
    </div>`;
    $('#copy').addEventListener('click', async () => {
      const ok = await copyText(A.code, $('#code'));
      $('#copied').textContent = ok ? 'Copied.' : 'Select the code above and copy it.';
    });
  }

  if (A && A.code) { done(); return; }
  if (A && A.ans && A.ans.length === N) {
    A.ev.push([Math.round((Date.now() - A.start) / 1000), 0, 'r']);   // page was reloaded mid-exam
    save();
    if (ex.maxAway > 0 && A.ev.length >= ex.maxAway) { finish('away'); return; }
    run();
    if (ex.minutes > 0) tickTimer();
    return;
  }
  intro();
}
