const fs = require('fs'), zlib = require('zlib'), cp = require('child_process');
const PM = require('./omr-core.js');
function readPNG(buf) {
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), body = buf.slice(p + 8, p + 8 + len); if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); } if (type === 'IDAT') idat.push(body); p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const ft = raw[y * (w + 1)], row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)); for (let x = 0; x < w; x++) { const a = x ? out[y * w + x - 1] : 0, b = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0; let v = row[x]; if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1; else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); } out[y * w + x] = v & 255; } }
  return { w, h, g: out };
}
console.log('HW table length', PM.HW.length, PM.HW.length === 95 ? 'OK' : 'WRONG');
let allOk = PM.HW.length === 95;
const cases = [[15, 5, 6, 'a4'], [20, 4, 8, 'letter'], [30, 4, 6, 'a4'], [60, 5, 10, 'a4'], [45, 3, 4, 'letter']];
cases.forEach(([n, k, idLen, paper], idx) => {
  const lay = PM.layout(n, k, idLen), tag = `t${n}`;
  fs.writeFileSync(`${tag}-layout.json`, JSON.stringify(lay));
  fs.writeFileSync(`${tag}.pdf`, Buffer.from(PM.sheetPDF(lay, { paper, title: 'Ñandú Quiz (Q1) \\ test', footer: 'SnapGrade · test · ' + n + ' items' })));
  cp.execFileSync('python3', ['render_pdf.py', `${tag}.pdf`, tag, String(20 + idx), paper], { stdio: 'pipe' });
  const truth = JSON.parse(fs.readFileSync(`${tag}-truth.json`));
  ['p1', 'p2', 'p3'].forEach(v => {
    const im = readPNG(fs.readFileSync(`${tag}-${v}.png`));
    const res = PM.scan(im.g, im.w, im.h, lay, { thr: 0.18 });
    if (!res.ok) { console.log(`${n} items ${paper} ${v}: SCAN FAILED`); allOk = false; return; }
    const wrong = res.answers.map((a, i) => (a === truth.answers[i] ? null : `q${i + 1} want ${JSON.stringify(truth.answers[i])} got ${JSON.stringify(a)}`)).filter(Boolean);
    const idOk = res.idStr === truth.sid;
    console.log(`${n} items, ${k} choices, ${idLen}-digit ID, ${paper} ${v}: wrong ${wrong.length}/${n}, ID ${idOk ? 'OK' : 'got ' + res.idStr + ' want ' + truth.sid}`);
    wrong.slice(0, 5).forEach(w => console.log('   ' + w));
    if (wrong.length || !idOk) allOk = false;
  });
});
console.log(allOk ? 'PDF END-TO-END: ALL OK' : 'PDF END-TO-END: PROBLEMS');
