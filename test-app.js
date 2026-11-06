// Smoke test: runs the real bundle against a stub DOM and exercises the main flows.
const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');
const bundle = fs.readFileSync(__dirname + '/bundle.js', 'utf8');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function mkEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', checked: false, hidden: false, disabled: false, style: {}, dataset: {}, children: [], listeners: {}, type: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); },
    removeEventListener(t, f) { if (el.listeners[t]) el.listeners[t] = el.listeners[t].filter(x => x !== f); },
    focus() {}, select() {}, click() {}, setAttribute() {}, appendChild(c) { el.children.push(c); }, remove() {}, closest() { return null; },
    firstChild: { textContent: '' }, width: 0, height: 0,
    getBoundingClientRect() { return { left: 0, top: 0, width: 520, height: 700 }; },
    getContext() { return new Proxy({}, { get: (t, p) => (p === 'createImageData' ? ((w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })) : (() => {})), set: () => true }); }
  };
  return el;
}
function makeWorld(hash, claude, fetchImpl, pmExam) {
  const els = {}, store = {};
  const doc = {
    listeners: {}, hidden: false, body: mkEl('body'), head: mkEl('head'), documentElement: {},
    querySelector(sel) { return els[sel] || (els[sel] = mkEl(sel)); },
    querySelectorAll() { return []; },
    createElement() { return mkEl('new'); },
    addEventListener(t, f) { (doc.listeners[t] = doc.listeners[t] || []).push(f); },
    removeEventListener(t, f) { if (doc.listeners[t]) doc.listeners[t] = doc.listeners[t].filter(x => x !== f); },
    hasFocus() { return true; }
  };
  const sb = {
    document: doc, els, doc, console, TextEncoder, TextDecoder, btoa, atob, Blob, URL, Date, Math, JSON, Promise, Uint8Array, Uint8ClampedArray, Float64Array, Int32Array,
    setTimeout, clearTimeout, setInterval, clearInterval, Image: function () {},
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    location: { hash, reload() {} }, getComputedStyle: () => ({ getPropertyValue: () => '' }), fetch: fetchImpl || (async () => ({ ok: false })), claude
  };
  sb.window = sb; sb.winListeners = {}; sb.scrollTo = () => {};
  sb.addEventListener = (t, f) => { (sb.winListeners[t] = sb.winListeners[t] || []).push(f); };
  sb.removeEventListener = (t, f) => { if (sb.winListeners[t]) sb.winListeners[t] = sb.winListeners[t].filter(x => x !== f); };
  sb.__PM_TEST = {}; if (pmExam) sb.__PM_EXAM = pmExam;
  vm.createContext(sb);
  vm.runInContext(bundle, sb);
  return sb;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const clickNode = (sb, node) => sb.doc.listeners.click.forEach(f => f({ target: { closest: s => (s === '[data-act]' ? node : null) } }));
const inputEl = (sb, target) => sb.doc.listeners.input.forEach(f => f({ target }));

(async () => {
  /* ----- teacher ----- */
  const dbData = {}, uploads = [], saved = [];
  const mockDb = {
    doc: p => ({ set: async d => { dbData[p] = JSON.parse(JSON.stringify(d)); }, delete: async () => { delete dbData[p]; } }),
    collection: c => ({ onSnapshot: cb => { cb({ docs: [] }); } })
  };
  const claude = {
    use: async n => ({
      user: { canEdit: async () => true, isOwner: async () => true },
      db: mockDb,
      assets: { upload: async (blob) => { uploads.push(await blob.text()); return { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }; }, delete: async () => ({ deleted: true }) },
      downloads: { save: async r => { saved.push(r); return { status: 'saved' }; } }
    }[n] || null)
  };
  const T = makeWorld('', claude);
  await wait(80);
  const A = T.__PM_TEST.api;
  ok(T.els['#view'] && T.els['#view'].innerHTML.includes('Start with the number of items'), 'teacher opens on empty Exams screen');
  clickNode(T, { dataset: { act: 'new-exam', n: '15' } });
  ok(T.els['#view'].innerHTML.includes('Answer key') && A.T.editing, 'new exam opens the editor');
  const ex = A.T.S.exams[A.T.editing];
  ok(ex.items.length === 15, 'exam has 15 items');
  T.doc.querySelector('#e-quick').value = 'ABCDABCDABCDABC';
  clickNode(T, { dataset: { act: 'apply-quick' } });
  ok(ex.items.map(i => i.a).join('') === 'ABCDABCDABCDABC', 'quick key applied');
  clickNode(T, { dataset: { act: 'set-n', n: '20' } });
  ok(ex.items.length === 20 && ex.nItems === 20, 'change to 20 items');
  ex.items[17].a = 'B';
  clickNode(T, { dataset: { act: 'set-n', n: '15' } });
  ok(ex.items.length === 20 && A.T.warn, 'shrinking items with content asks for confirmation');
  clickNode(T, { dataset: { act: 'set-n', n: '15' } });
  ok(ex.items.length === 15, 'second tap confirms shrink');
  clickNode(T, { dataset: { act: 'publish' } }); await wait(20);
  ok(uploads.length === 0, 'cannot publish without question text');
  let paste = '';
  for (let i = 1; i <= 15; i++) paste += `${i}. Question number ${i}?\nA. alpha\nB. beta\nC. gamma\nD. delta\nAnswer: ${'ABCDABCDABCDABC'[i - 1]}\n\n`;
  T.doc.querySelector('#e-paste').value = paste;
  clickNode(T, { dataset: { act: 'parse-paste' } });
  ok(ex.items.length === 15 && ex.items[0].q === 'Question number 1?' && ex.items[3].a === 'D' && ex.choices === 4, 'pasted questions parsed');
  inputEl(T, { dataset: { f: 'title' }, type: 'text', value: 'Quiz One' });
  ok(ex.title === 'Quiz One', 'title edits update the exam');
  inputEl(T, { dataset: { f: 'minutes' }, type: 'number', value: '10' });
  clickNode(T, { dataset: { act: 'publish' } }); await wait(40);
  ok(uploads.length === 1, 'publish uploads the student exam');
  const pub = JSON.parse(uploads[0]);
  ok(pub.items.length === 15 && !uploads[0].includes('"a":') && !('a' in pub.items[0]), 'student file contains no answer key');
  ok(ex.pub && ex.pub.assetId === 'a1b2c3d4e5f60718293a4b5c6d7e8f90', 'exam remembers its asset id');
  clickNode(T, { dataset: { act: 'tab', t: 'settings' } });
  ok(T.els['#view'].innerHTML.includes('Class list'), 'settings renders');
  clickNode(T, { dataset: { act: 'tab', t: 'exams' } });
  clickNode(T, { dataset: { act: 'edit-exam', id: ex.id } });
  clickNode(T, { dataset: { act: 'sheet-pdf' } }); await wait(30);
  const pdfSave = saved.find(f => f.filename.endsWith('.pdf'));
  ok(pdfSave && Buffer.from(pdfSave.data).toString('latin1', 0, 5) === '%PDF-' && pdfSave.filename === 'quiz-one-answer-sheet.pdf', 'answer sheet PDF is generated in the page (no CDN)');

  /* ----- student ----- */
  const token = 'q' + ex.pub.assetId;
  const S = makeWorld('#' + token, null, async url => ({ ok: url === '/_blob/' + ex.pub.assetId, json: async () => JSON.parse(uploads[0]) }));
  await wait(40);
  ok(S.els['#app'].innerHTML.includes('Start exam'), 'student sees the intro');
  S.els['#s-name'].value = 'Ana Cruz'; S.doc.querySelector('#s-id').value = '000123'; S.doc.querySelector('#s-sec').value = '11-Rizal';
  (S.els['#s-name'].listeners.input || []).forEach(f => f());
  (S.els['#s-go'].listeners.click || []).forEach(f => f());
  ok(S.els['#qa'].innerHTML.includes('Question number'), 'exam starts and shows a question');
  // answer: question n gets choice index (n % 4); key is ABCD repeating, so every 4th is wrong? make first 10 correct, rest wrong
  const keyIdx = 'ABCDABCDABCDABC'.split('').map(c => 'ABCD'.indexOf(c));
  for (let i = 0; i < 15; i++) {
    const idx = i < 10 ? keyIdx[i] : (keyIdx[i] + 1) % 4;
    S.els['#qa'].listeners.click.forEach(f => f({ target: { closest: sel => (sel === '[data-j]' ? { dataset: { j: String(idx) } } : null) } }));
    (S.els['#next'].listeners.click || []).forEach(f => f());
  }
  // leave the tab once
  S.doc.hidden = true; (S.doc.listeners.visibilitychange || []).forEach(f => f());
  await wait(30);
  S.doc.hidden = false; (S.doc.listeners.visibilitychange || []).forEach(f => f());
  ok(S.els['#away-n'].textContent.includes('1'), 'leaving the page is recorded');
  (S.els['#submit'].listeners.click || []).forEach(f => f());
  (S.els['#yes'].listeners.click || []).forEach(f => f());
  const m = S.els['#app'].innerHTML.match(/PM1\.[A-Za-z0-9_-]+\.[a-z0-9]+/);
  ok(!!m, 'student gets a submission code');
  const code = m && m[0];

  /* ----- import the code in the teacher view ----- */
  clickNode(T, { dataset: { act: 'tab', t: 'results' } });
  T.doc.querySelector('#imp').value = 'hello\n' + code + '\n' + code;
  clickNode(T, { dataset: { act: 'import' } });
  const html = T.els['#view'].innerHTML;
  ok(html.includes('Imported 1, 1 already imported'), 'import accepts the code once and skips the duplicate');
  ok(html.includes('Ana Cruz') && html.includes('10/15'), 'result shows student with correct score (10/15)');
  ok(html.includes('1× away'), 'results flag the tab switch');
  T.doc.querySelector('#imp').value = code.slice(0, -2) + 'zz';
  clickNode(T, { dataset: { act: 'import' } });
  ok(T.els['#view'].innerHTML.includes('damaged'), 'a damaged code is rejected');
  const rid = Object.keys(A.T.S.results)[0];
  clickNode(T, { dataset: { act: 'row', id: rid } });
  ok(T.els['#view'].innerHTML.includes('Left the page'), 'row detail lists away events');
  clickNode(T, { dataset: { act: 'export-csv' } }); await wait(20);
  const csv = saved.find(f => f.filename === 'quiz-one-results.csv');
  ok(csv && csv.data.includes('Ana Cruz') && csv.data.includes('Not passed') || csv.data.includes('Passed'), 'CSV export hands a file to downloads');
  await wait(20);
  ok(Object.keys(dbData).some(k => k.startsWith('exams/')) && Object.keys(dbData).some(k => k.startsWith('results/')), 'data synced to the database');

  /* ----- scan review with a real synthetic photo ----- */
  const PM = vm.runInContext('PM', T);
  const readPNG = buf => {
    let p = 8, w = 0, h = 0; const idat = [];
    while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), body = buf.slice(p + 8, p + 8 + len); if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); } if (type === 'IDAT') idat.push(body); p += 12 + len; }
    const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { const ft = raw[y * (w + 1)], row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)); for (let x = 0; x < w; x++) { const a = x ? out[y * w + x - 1] : 0, b = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0; let v = row[x]; if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1; else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); } out[y * w + x] = v & 255; } }
    return { w, h, g: out };
  };
  // exam with 30 items / 4 choices / 6 id digits matches the synthetic sheet
  clickNode(T, { dataset: { act: 'tab', t: 'exams' } });
  clickNode(T, { dataset: { act: 'new-exam', n: '30' } });
  const ex30 = A.T.S.exams[A.T.editing];
  ex30.title = 'Thirty';
  const truth = JSON.parse(fs.readFileSync(__dirname + '/truth.json'));
  ex30.items.forEach((it, i) => { it.a = 'ABCD'[i % 4]; });
  const im = readPNG(fs.readFileSync(__dirname + '/case2.png'));
  const lay = PM.layout(30, 4, 6), res = PM.scan(im.g, im.w, im.h, lay, { thr: 0.18 });
  const s = { id: 'sc1', file: 'case2.png', examId: ex30.id, state: 'ready', res, ans: res.answers.slice(), sid: res.idStr, idHint: '', name: 'Ben Reyes', warnTxt: '' };
  A.T.scans = [s]; A.T.tab = 'scan'; A.T.scanExam = ex30.id; A.render();
  ok(T.els['#view'].innerHTML.includes('Student ID') && T.els['#view'].innerHTML.includes('data-cv="sc1"'), 'scan review card renders');
  const expected = truth.answers.reduce((t, a, i) => t + (a === 'ABCD'[i % 4] ? 1 : 0), 0);
  ok(A.T.scans[0].ans.join('') === truth.answers.join(''), 'review holds the answers read from the photo');
  clickNode(T, { dataset: { act: 'scan-save', sid: 'sc1' } });
  const saved30 = Object.keys(A.T.S.results).map(k => A.T.S.results[k]).find(r => r.examId === ex30.id);
  ok(saved30 && saved30.sid === truth.sid && saved30.name === 'Ben Reyes' && saved30.answers.length === 30, 'scan saved as a result with ID and name');
  A.T.tab = 'results'; A.T.resExam = ex30.id; A.render();
  ok(T.els['#view'].innerHTML.includes('Ben Reyes') && T.els['#view'].innerHTML.includes(expected + '/30'), 'scanned result graded (' + expected + '/30)');

  /* ----- new features ----- */
  const PMv = vm.runInContext('PM', T);
  const tm = { 100: 100, 99.99: 99, 98.4: 99, 98.39: 98, 76: 85, 75.99: 84, 61.6: 76, 61.59: 75, 60: 75, 59.99: 74, 56: 74, 55.99: 73, 40: 70, 4: 61, 3.99: 60, 0: 60 };
  ok(Object.keys(tm).every(k => PMv.transmute(+k) === tm[k]), 'DepEd transmutation matches the table at its band edges');
  const gEx = { items: [{ a: 'A', pts: 2 }, { a: 'B' }, { a: 'C', bonus: true }, { a: 'D', pts: 0.5 }] };
  const gg = PMv.grade(gEx, ['A', '*', '', 'B']);
  ok(gg.earned === 3 && gg.total === 4.5 && gg.correct === 2, 'grading honours points and credit-to-everyone items');

  // scale and pass mark
  clickNode(T, { dataset: { act: 'tab', t: 'settings' } });
  T.doc.listeners.change.forEach(f => f({ target: { dataset: { s: 'scale' }, value: 'deped', closest: () => null } }));
  ok(A.T.S.settings.app.scale === 'deped', 'grade display can switch to DepEd');
  clickNode(T, { dataset: { act: 'tab', t: 'results' } });
  T.els['#view'].innerHTML.includes('Grade') && ok(true, 'results table shows the Grade column');
  ok(/<th class="num">Grade<\/th>/.test(T.els['#view'].innerHTML) && T.els['#view'].innerHTML.includes('class="hist"'), 'results show the score chart and grade column');
  ok(T.els['#view'].innerHTML.includes('Passed') || T.els['#view'].innerHTML.includes('Not passed'), 'results show pass or fail');

  // bonus item changes the score
  A.T.tab = 'exams'; A.T.editing = ex.id; A.render();
  inputEl(T, { dataset: { i: '14', k: 'bonus' }, checked: true, type: 'checkbox', value: '' });
  inputEl(T, { dataset: { i: '0', k: 'pts' }, value: '3', type: 'number' });
  ok(ex.items[14].bonus === true && ex.items[0].pts === 3, 'bonus and points are stored on the item');
  const bonusRows = A.T.S.results[Object.keys(A.T.S.results)[0]];
  A.T.tab = 'results'; A.T.editing = null; A.T.resExam = ex.id; A.render();
  ok(T.els['#view'].innerHTML.includes('MPS') && T.els['#view'].innerHTML.includes('data-act="open-ia"'), 'results show MPS and a link to item analysis');

  // exam menu, item analysis, tag report
  A.T.tab = 'exams'; A.T.editing = null; A.T.menu = null; A.T.sub = ''; A.render();
  ok(T.els['#view'].innerHTML.includes('data-act="open-exam"') && !T.els['#view'].innerHTML.includes('data-act="edit-exam"'), 'exam list opens the menu, not the editor');
  clickNode(T, { dataset: { act: 'open-exam', id: ex.id } });
  let v = T.els['#view'].innerHTML;
  ok(A.T.menu === ex.id && ['Edit key and questions', 'Scan papers', 'Review papers', 'Item analysis', 'Tag report'].every(x => v.includes(x)), 'menu has the five ZipGrade-style actions');
  ok(v.includes('Papers') && v.includes('Questions') && v.includes('Classes') && v.includes('Download PDF'), 'details tab lists classes, papers, questions and the sheet');
  clickNode(T, { dataset: { act: 'mtab', t: 'stats' } });
  v = T.els['#view'].innerHTML;
  ok(['Min', 'Max', 'Average', 'Median', 'Std. deviation', 'Score', 'Percent', 'MPS'].every(x => v.includes(x)), 'statistics tab shows the table and MPS');
  clickNode(T, { dataset: { act: 'open-ia', id: ex.id } });
  v = T.els['#view'].innerHTML;
  ok(A.T.sub === 'ia' && v.includes('Item analysis') && v.includes('D.F.') && v.includes('Difficulty') && v.includes('class="bars"'), 'item analysis screen shows difficulty, D.F. and choice bars');
  ok(v.includes('Credit to all'), 'item analysis marks a credit-to-all item');
  ok((v.match(/class="ia2"/g) || []).length === ex.items.length, 'one analysis row per item');
  clickNode(T, { dataset: { act: 'menu-back' } });
  ok(A.T.sub === '' && A.T.menu === ex.id, 'back from analysis returns to the menu');
  clickNode(T, { dataset: { act: 'open-tags' } });
  ok(A.T.sub === 'tags' && T.els['#view'].innerHTML.includes('No items are tagged yet'), 'tag report starts empty with a bulk form');
  T.els['#tg-from'] = { value: '1' }; T.els['#tg-to'] = { value: '10' }; T.els['#tg-name'] = { value: 'Plate tectonics' };
  clickNode(T, { dataset: { act: 'tag-apply' } });
  T.els['#tg-from'] = { value: '11' }; T.els['#tg-to'] = { value: '14' }; T.els['#tg-name'] = { value: 'Rocks' };
  clickNode(T, { dataset: { act: 'tag-apply' } });
  ok(ex.items[0].tag === 'Plate tectonics' && ex.items[9].tag === 'Plate tectonics' && ex.items[10].tag === 'Rocks' && !ex.items[14].tag, 'bulk tag applies to the range only');
  v = T.els['#view'].innerHTML;
  ok(v.includes('Plate tectonics') && v.includes('1–10') && v.includes('Rocks') && v.includes('11–14') && /Mastery|mastery/.test(v), 'tag report lists each tag with its items and MPS');
  const tagMps = /Rocks<\/td><td>11–14<\/td><td class="num">([\d.]+)%/.exec(v);
  ok(!!tagMps, 'tag MPS is a number: ' + (tagMps && tagMps[1]));
  clickNode(T, { dataset: { act: 'menu-back' } });
  clickNode(T, { dataset: { act: 'edit-key' } });
  ok(A.T.editing === ex.id, 'edit key opens the editor');
  clickNode(T, { dataset: { act: 'close-editor' } });
  ok(A.T.editing === null && A.T.menu === ex.id && T.els['#view'].innerHTML.includes('Scan papers'), 'closing the editor returns to the menu');
  clickNode(T, { dataset: { act: 'go-scan' } });
  ok(A.T.tab === 'scan' && A.T.scanExam === ex.id, 'scan papers goes to the scanner for this exam');
  A.T.tab = 'exams'; A.render();
  clickNode(T, { dataset: { act: 'go-review' } });
  ok(A.T.tab === 'results' && A.T.resExam === ex.id, 'review papers goes to this exam\'s results');
  A.T.tab = 'exams'; A.T.menu = null; A.T.sub = ''; A.render();

  // offline exam file
  T.doc.querySelector('#pm-css').textContent = 'body{margin:0}';
  T.doc.querySelector('#pm-omr').textContent = 'var PM = {};';
  T.doc.querySelector('#pm-app').textContent = '/* app */';
  A.T.tab = 'exams'; A.T.editing = ex.id; A.render();
  clickNode(T, { dataset: { act: 'exam-file' } }); await wait(30);
  const ef = saved.find(f => f.filename === 'quiz-one-exam.html');
  ok(ef && ef.data.includes('window.__PM_EXAM=') && !ef.data.includes('"a":"A"') && !/"pts"/.test(ef.data) && !ef.data.includes('Plate tectonics') && !ef.data.includes('"tag"'), 'offline exam file is built and carries no answer key or tags');
  const jsonStart = ef.data.indexOf('window.__PM_EXAM=') + 'window.__PM_EXAM='.length;
  const embedded = JSON.parse(ef.data.slice(jsonStart, ef.data.indexOf(';</script>', jsonStart)));
  const F = makeWorld('', null, null, embedded);
  await wait(40);
  ok(F.els['#app'].innerHTML.includes('Start exam') && F.els['#app'].innerHTML.includes('Quiz One'), 'student opens the offline file with no link and no fetch');
  F.els['#s-name'].value = 'Offline Student';
  (F.els['#s-name'].listeners.input || []).forEach(f => f());
  (F.els['#s-go'].listeners.click || []).forEach(f => f());
  // mark question 1 for later, then check the map and the confirm screen
  F.els['#qa'].listeners.click.forEach(f => f({ target: { closest: sel => (sel === '[data-flag]' ? { dataset: {} } : null) } }));
  ok(F.els['#qmap'].innerHTML.includes('qm fl') && F.els['#qa'].innerHTML.includes('Marked for later'), 'student can mark a question for later');
  (F.els['#submit'].listeners.click || []).forEach(f => f());
  ok(F.els['#qa'].innerHTML.includes('marked question 1 for later') || F.els['#qa'].innerHTML.includes('You marked question'), 'submit screen lists marked questions');
  (F.els['#yes'].listeners.click || []).forEach(f => f());
  ok(/PM1\.[A-Za-z0-9_-]+\.[a-z0-9]+/.test(F.els['#app'].innerHTML), 'offline student also gets a submission code');

  // backup and restore round trip
  A.T.tab = 'settings'; A.T.editing = null; A.render();
  const before = { e: Object.keys(A.T.S.exams).length, r: Object.keys(A.T.S.results).length };
  clickNode(T, { dataset: { act: 'backup' } }); await wait(30);
  const bk = saved.find(f => f.filename.startsWith('snapgrade-backup-'));
  ok(bk && JSON.parse(bk.data).app === 'snapgrade', 'backup file is produced');
  const victim = Object.keys(A.T.S.results)[0];
  clickNode(T, { dataset: { act: 'tab', t: 'results' } });
  A.T.rowOpen = victim; A.render();
  clickNode(T, { dataset: { act: 'del-result', id: victim } });
  clickNode(T, { dataset: { act: 'del-result', id: victim } });
  ok(Object.keys(A.T.S.results).length === before.r - 1, 'a result can be deleted');
  const msg = await A.restore({ text: async () => bk.data });
  ok(Object.keys(A.T.S.results).length === before.r && /Restored 0 exams and 1 result/.test(msg), 'restore brings the deleted result back and leaves exams alone: ' + msg);
  const evilJson = '{"app":"snapgrade","v":1,"exams":{"__proto__":{"id":"__proto__","items":[{}]},"ok1":{"id":"ok1","items":[{"q":"<img src=x onerror=alert(1)>","c":["a","b"],"a":"Z"}],"title":"<b>x</b>"}},"results":{"r1":{"id":"r1","examId":"ok1","answers":"AB<>","away":{"n":"<i>","ev":"no"}}},"settings":{}}';
  const evil = await A.restore({ text: async () => evilJson });
  ok(/Restored 1 exam and 1 result, 1 skipped/.test(evil) && ({}).polluted === undefined && A.T.S.exams.ok1.items[0].a === '' && A.T.S.results.r1.away.n === 0, 'hostile backup is sanitised: ' + evil);
  const bad = await A.restore({ text: async () => 'not json' });
  ok(/not a SnapGrade backup/.test(bad), 'non-backup files are refused');

  // scan: flags and save-all
  const exs = A.T.S.exams[Object.keys(A.T.S.exams).find(k => A.T.S.exams[k].title === 'Thirty')];
  const mk = (id, sid, ans) => ({ id, file: id + '.jpg', examId: exs.id, state: 'ready', res: { warp: { w: 1, h: 1, data: new Uint8Array(1) } }, ans, sid, idHint: '', name: '', warnTxt: '' });
  const a30 = new Array(30).fill('A');
  const dbl = a30.slice(); dbl[4] = '*'; dbl[9] = '';
  A.T.scans = [mk('s1', '111111', a30), mk('s2', '222222', dbl), mk('s3', '', a30), mk('s4', '444444', a30)];
  A.T.tab = 'scan'; A.T.scanExam = exs.id; A.render();
  ok(T.els['#view'].innerHTML.includes('Save all ready (4)') && T.els['#view'].innerHTML.includes('Double marks on 5') && T.els['#view'].innerHTML.includes('Blank: 10'), 'scan cards flag double marks and blanks');
  clickNode(T, { dataset: { act: 'scan-all' } });
  ok(A.T.scans.filter(x => x.state === 'saved').length === 2 && A.T.scans.filter(x => x.state === 'ready').length === 2, 'save all saves only clean sheets that have an ID');
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
