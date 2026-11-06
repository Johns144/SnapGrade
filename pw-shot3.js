const { chromium } = require('playwright'); const fs = require('fs'); const dir = __dirname;
(async () => {
  const b = await chromium.launch();
  const stubSrc = fs.readFileSync(dir + '/pw-test.js', 'utf8').match(/const stub = `([\s\S]*?)`;\n\n\(async/)[1];
  const out = {};
  for (const [name, scheme, w] of [['phone', 'light', 400], ['phonedk', 'dark', 400], ['desk', 'light', 1100]]) {
    // teacher
    let c = await b.newContext({ viewport: { width: w, height: 860 }, colorScheme: scheme });
    await c.addInitScript('window.__SEED = ' + fs.readFileSync(dir + '/seed.json', 'utf8') + ';'); await c.addInitScript(stubSrc);
    await c.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    let p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + dir + '/pencilmark.html'); await p.waitForTimeout(300);
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const o = [];
    o.push(await ov()); await p.screenshot({ path: `${dir}/r1-${name}-list.png` });
    await p.click('.item'); o.push(await ov()); await p.screenshot({ path: `${dir}/r2-${name}-menu.png`, fullPage: true });
    await p.click('[data-act="edit-key"]'); await p.waitForTimeout(100); o.push(await ov()); await p.screenshot({ path: `${dir}/r3-${name}-editor.png` });
    await c.close();
    // student
    c = await b.newContext({ viewport: { width: w, height: 860 }, colorScheme: scheme });
    await c.addInitScript('window.__PM_EXAM = ' + fs.readFileSync(dir + '/seed-exam.json', 'utf8') + ';');
    await c.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + dir + '/pencilmark.html'); await p.waitForTimeout(300);
    o.push(await ov()); await p.screenshot({ path: `${dir}/r4-${name}-start.png`, fullPage: true });
    await p.fill('#s-name', 'Ana Reyes'); await p.click('#s-go'); await p.waitForTimeout(150);
    await p.click('.choice[data-j="1"]'); await p.click('#next'); await p.waitForTimeout(80);
    o.push(await ov()); await p.screenshot({ path: `${dir}/r5-${name}-question.png` });
    await c.close();
    out[name] = { overflow: o, errs };
  }
  console.log(JSON.stringify(out)); await b.close();
})();
