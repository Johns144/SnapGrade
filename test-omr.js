const fs = require('fs');
const zlib = require('zlib');
const PM = require('./omr-core.js');

// Minimal decoder for 8-bit greyscale, non-interlaced PNG (what PIL writes for mode "L").
function readPNG(buf) {
  let p = 8, w = 0, h = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), body = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); if (body[8] !== 8 || body[9] !== 0 || body[12] !== 0) throw new Error('need 8-bit grey PNG'); }
    if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (w + 1)], row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x ? out[y * w + x - 1] : 0, b = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0;
      let v = row[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[y * w + x] = v & 255;
    }
  }
  return { w, h, g: out };
}

const lay = JSON.parse(fs.readFileSync(__dirname + '/layout.json'));
const truth = JSON.parse(fs.readFileSync(__dirname + '/truth.json'));
let allOk = true;
for (const f of ['case1.png', 'case2.png', 'case3.png']) {
  const im = readPNG(fs.readFileSync(__dirname + '/' + f));
  const t0 = Date.now();
  const res = PM.scan(im.g, im.w, im.h, lay, { thr: 0.18 });
  const ms = Date.now() - t0;
  if (!res.ok) { console.log(f, 'FAILED', JSON.stringify(res)); allOk = false; continue; }
  const wrong = [];
  res.answers.forEach((a, i) => { if (a !== truth.answers[i]) wrong.push([i + 1, truth.answers[i], a, res.fills[i].map(v => v.toFixed(2)).join('/')]); });
  const idOk = res.idStr === truth.sid;
  console.log(f, ms + 'ms', 'wrong:', wrong.length + '/' + truth.answers.length, 'id', res.idStr, idOk ? 'OK' : 'expected ' + truth.sid);
  wrong.forEach(w => console.log('   q' + w[0], 'truth', JSON.stringify(w[1]), 'got', JSON.stringify(w[2]), w[3]));
  if (wrong.length || !idOk) allOk = false;
}
console.log(allOk ? 'ALL OK' : 'SOME MISMATCHES');
