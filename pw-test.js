const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const REAL_FONTS = false;

// Stub of the Claude runtime so the teacher view opens as the owner.
const stub = `
window.__saved = []; window.__uploads = []; window.__dbdocs = JSON.parse(JSON.stringify(window.__SEED || {}));
(function () {
  const subs = {};
  const mkDb = () => ({
    doc: p => ({ set: async d => { window.__dbdocs[p] = JSON.parse(JSON.stringify(d)); const c = p.split('/')[0]; (subs[c] || []).forEach(f => f()); }, delete: async () => { delete window.__dbdocs[p]; const c = p.split('/')[0]; (subs[c] || []).forEach(f => f()); } }),
    collection: c => ({ onSnapshot: cb => {
      const emit = () => cb({ docs: Object.keys(window.__dbdocs).filter(k => k.startsWith(c + '/')).map(k => ({ id: k.split('/')[1], data: () => window.__dbdocs[k] })) });
      (subs[c] = subs[c] || []).push(emit); emit();
    } })
  });
  const db = mkDb();
  window.claude = { use: async n => ({
    user: { canEdit: async () => true, isOwner: async () => true },
    db,
    assets: { upload: async b => { const t = await b.text(); window.__uploads.push(t); return { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }; }, delete: async () => ({ deleted: true }) },
    downloads: { save: async r => { window.__saved.push({ filename: r.filename, size: r.data.length || r.data.size, head: typeof r.data === 'string' ? r.data.slice(0, 40) : Array.from(r.data.slice(0, 5)) }); return { status: 'saved' }; } }
  }[n] || null) };
})();`;

(async () => {
  const browser = await chromium.launch();
  const out = {};
  const errors = [];
  async function open(w, h, scheme, hash) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    await ctx.addInitScript(stub);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto('file://' + dir + '/pencilmark.html' + (hash || ''));
    await page.waitForTimeout(250);
    return { ctx, page };
  }
  const overflow = async (page, label) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 1) errors.push('horizontal overflow ' + o + 'px on ' + label); };

  /* ---------- teacher, phone, light ---------- */
  let { ctx, page } = await open(400, 860, 'light');
  await page.screenshot({ path: dir + '/s1-empty.png' });
  await overflow(page, 'empty exams');
  await page.click('[data-act="new-exam"][data-n="30"]');
  await page.fill('[data-f="title"]', 'Earth Science Quiz 1');
  await page.fill('#e-quick', 'ABCDABCDABCDABCDABCDABCDABCDAB');
  await page.click('[data-act="apply-quick"]');
  await page.click('[data-act="open-item"][data-i="2"]');
  await page.fill('[data-i="2"][data-k="q"]', 'Which layer of the Earth is liquid?');
  await page.click('[data-act="open-item"][data-i="4"]');
  await page.check('[data-i="4"][data-k="bonus"]');
  await page.screenshot({ path: dir + '/s2-editor.png', fullPage: false });
  await overflow(page, 'editor');

  // real scan of a synthetic photo through the browser code path (30 items, 4 choices, 6 digits)
  const truth = JSON.parse(fs.readFileSync(dir + '/truth.json'));
  await page.click('.tab[data-t="scan"]');
  await page.setInputFiles('#in-file', [dir + '/case1.png', dir + '/case2.png', dir + '/case3.png']);
  await page.waitForSelector('[data-cv]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-cv]').length === 3, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const scanned = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sf="sid"]')).map(i => i.value));
  out.scanIds = scanned;
  out.scanIdsOk = scanned.length === 3 && scanned.every(v => v === truth.sid);
  await page.screenshot({ path: dir + '/s3-scan.png', fullPage: true });
  await overflow(page, 'scan');
  await page.click('[data-act="scan-all"]');
  await page.waitForTimeout(200);
  out.savedCount = await page.evaluate(() => Object.keys(window.__dbdocs).filter(k => k.startsWith('results/')).length);
  await ctx.close();

  /* ---------- seeded views ---------- */
  const seed = fs.readFileSync(dir + '/seed.json', 'utf8'), seedExam = fs.readFileSync(dir + '/seed-exam.json', 'utf8');
  async function openSeeded(w, h, scheme, extra) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    await c.addInitScript('window.__SEED = ' + seed + ';');
    if (extra) await c.addInitScript(extra);
    await c.addInitScript(stub);
    await c.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const p = await c.newPage();
    p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
    await p.goto('file://' + dir + '/pencilmark.html');
    await p.waitForTimeout(300);
    return { c, p };
  }
  // results, phone, dark
  let r = await openSeeded(400, 860, 'dark');
  await r.p.click('.tab[data-t="results"]');
  await r.p.waitForSelector('.hist');
  await r.p.click('.rowbtn >> nth=0');
  await r.p.screenshot({ path: dir + '/s4-results-dark.png', fullPage: true });
  await overflow(r.p, 'results phone dark');
  out.rows = await r.p.evaluate(() => document.querySelectorAll('tbody tr').length);
  out.stats = await r.p.evaluate(() => document.querySelector('.stats').innerText.replace(/\n+/g, ' | '));
  await r.c.close();
  // results, desktop, light
  r = await openSeeded(1100, 900, 'light');
  await r.p.click('.tab[data-t="results"]');
  await r.p.waitForSelector('.hist');
  await r.p.screenshot({ path: dir + '/s5-results-desktop.png', fullPage: false });
  await overflow(r.p, 'results desktop');
  await r.p.click('.tab[data-t="settings"]');
  await r.p.screenshot({ path: dir + '/s6-settings-desktop.png', fullPage: false });
  await r.c.close();
  // student, phone, light, from the offline exam file path
  r = await openSeeded(400, 860, 'light', 'window.__PM_EXAM = ' + seedExam + ';');
  await r.p.screenshot({ path: dir + '/s7-student-intro.png', fullPage: true });
  await r.p.fill('#s-name', 'Test Student');
  await r.p.click('#s-go');
  await r.p.waitForSelector('.choice');
  await r.p.click('.choice >> nth=1');
  await r.p.click('[data-flag]');
  await r.p.click('#next');
  await r.p.click('.choice >> nth=2');
  await r.p.screenshot({ path: dir + '/s8-student-question.png', fullPage: false });
  await overflow(r.p, 'student question');
  // simulate leaving the page
  await r.p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await r.p.waitForTimeout(200);
  await r.p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await r.p.waitForTimeout(200);
  out.awayOverlay = await r.p.evaluate(() => !!document.querySelector('#awayov'));
  await r.p.screenshot({ path: dir + '/s9-student-away.png', fullPage: false });
  await r.p.click('#away-ok');
  await r.p.click('#submit');
  await r.p.click('#yes');
  await r.p.waitForSelector('#code');
  out.code = (await r.p.inputValue('#code')).slice(0, 30) + '…';
  await r.p.screenshot({ path: dir + '/s10-student-done.png', fullPage: false });
  await r.c.close();
  fs.writeFileSync(dir + '/pw-out.json', JSON.stringify({ out, errors }, null, 2));
  console.log(JSON.stringify({ out, errors }, null, 2));
  await browser.close();
})().catch(e => { console.error('PW CRASH', e); process.exit(2); });
