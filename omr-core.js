/* SnapGrade sheet geometry and scanner. Pure functions, no DOM, so it can be tested in Node. */
var PM = (function () {
  'use strict';
  // Template units are millimetres. Origin is the centre of the big top-left corner square.
  var W = 180, H = 250;      // distance between corner square centres
  var PAD = 8, S = 4;        // warped image: margin in mm, pixels per mm
  var R = 2.6, RID = 1.9;    // answer bubble and ID bubble radius
  var BIG = 12, SMALL = 8;   // corner square sizes
  var Q0 = 84, QP = 7, CP = 54, BX0 = 12, BDX = 8;
  var ID_RIGHT = 172, ID_PX = 5.8, ID_Y0 = 22, ID_PY = 4.8;
  var LET = 'ABCDE';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function formatFor(n) { return n <= 15 ? 15 : n <= 20 ? 20 : n <= 30 ? 30 : 60; }

  function layout(n, k, idLen) {
    n = clamp(n | 0, 1, 60); k = clamp(k | 0, 2, 5); idLen = clamp(idLen | 0, 4, 12);
    var fmt = formatFor(n);
    var cols = fmt <= 20 ? 1 : fmt === 30 ? 2 : 3;
    var rows = fmt === 15 ? 15 : fmt === 20 ? 20 : fmt === 30 ? 15 : 20;
    var startX = (W - ((cols - 1) * CP + 47)) / 2;
    var qs = [], letters = [], idCols = [], i, c, d, col, r, x0, y, bs;
    for (i = 0; i < n; i++) {
      col = Math.floor(i / rows); r = i % rows;
      x0 = startX + col * CP; y = Q0 + r * QP; bs = [];
      for (c = 0; c < k; c++) bs.push({ c: LET[c], x: x0 + BX0 + c * BDX, y: y });
      qs.push({ i: i, n: i + 1, numX: x0 + 6, y: y, b: bs });
    }
    for (col = 0; col < cols; col++) {
      x0 = startX + col * CP;
      for (c = 0; c < k; c++) letters.push({ t: LET[c], x: x0 + BX0 + c * BDX, y: Q0 - 7 });
    }
    for (i = 0; i < idLen; i++) {
      var x = ID_RIGHT - (idLen - i - 0.5) * ID_PX, ds = [];
      for (d = 0; d < 10; d++) ds.push({ d: d, x: x, y: ID_Y0 + d * ID_PY });
      idCols.push({ x: x, b: ds });
    }
    return {
      n: n, k: k, idLen: idLen, fmt: fmt, cols: cols, rows: rows, W: W, H: H, R: R, RID: RID,
      qs: qs, letters: letters, idCols: idCols, idPx: ID_PX, idLeft: ID_RIGHT - idLen * ID_PX,
      markers: [
        { id: 'TL', x: 0, y: 0, s: BIG }, { id: 'TR', x: W, y: 0, s: SMALL },
        { id: 'BR', x: W, y: H, s: SMALL }, { id: 'BL', x: 0, y: H, s: SMALL }
      ]
    };
  }

  // Darkness 0..255 relative to the local paper level, so shadows and gradients do not matter.
  function flatten(g, w, h, rad) {
    var W1 = w + 1, I = new Float64Array(W1 * (h + 1)), x, y, row;
    for (y = 0; y < h; y++) {
      row = 0;
      for (x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; }
    }
    var out = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
        var sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
        var bg = sum / ((x1 - x0) * (y1 - y0));
        var v = bg > 1 ? 255 * (1 - g[y * w + x] / bg) : 0;
        out[y * w + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    return out;
  }

  function components(bin, w, h, minArea) {
    var lab = new Uint8Array(w * h), stack = new Int32Array(w * h), out = [];
    var i, p, sp, area, minx, maxx, miny, maxy, sx, sy, x, y;
    for (i = 0; i < w * h; i++) {
      if (!bin[i] || lab[i]) continue;
      sp = 0; stack[sp++] = i; lab[i] = 1;
      area = 0; minx = w; maxx = 0; miny = h; maxy = 0; sx = 0; sy = 0;
      while (sp) {
        p = stack[--sp]; x = p % w; y = (p - x) / w;
        area++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && bin[p - w] && !lab[p - w]) { lab[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && bin[p + w] && !lab[p + w]) { lab[p + w] = 1; stack[sp++] = p + w; }
      }
      if (area >= minArea) out.push({ area: area, minx: minx, maxx: maxx, miny: miny, maxy: maxy, cx: sx / area, cy: sy / area });
    }
    return out;
  }

  function dist(p, q) { return Math.hypot(p.cx - q.cx, p.cy - q.cy); }

  // s is sorted by area, largest first. The largest is the big top-left square.
  function quad(s) {
    var L = s[0], O = [s[1], s[2], s[3]];
    if (L.area < 1.2 * O[0].area) return null;
    if (O[2].area < 0.45 * O[0].area) return null;
    var mx = (s[0].cx + s[1].cx + s[2].cx + s[3].cx) / 4, my = (s[0].cy + s[1].cy + s[2].cy + s[3].cy) / 4;
    var TAU = 2 * Math.PI, aL = Math.atan2(L.cy - my, L.cx - mx);
    function off(c) { return (Math.atan2(c.cy - my, c.cx - mx) - aL + 2 * TAU) % TAU; }
    var rest = O.slice().sort(function (p, q) { return off(p) - off(q); });
    var P = [L, rest[0], rest[1], rest[2]], k;
    for (k = 0; k < 4; k++) {
      var p0 = P[k], p1 = P[(k + 1) % 4], p2 = P[(k + 2) % 4];
      if ((p1.cx - p0.cx) * (p2.cy - p1.cy) - (p1.cy - p0.cy) * (p2.cx - p1.cx) <= 0) return null;
    }
    var a1 = dist(P[0], P[1]), b1 = dist(P[1], P[2]), c1 = dist(P[2], P[3]), d1 = dist(P[3], P[0]);
    var ratio = (a1 + c1) / (b1 + d1);
    if (ratio < 0.45 || ratio > 1.1) return null;
    var rw = Math.min(a1, c1) / Math.max(a1, c1), rh = Math.min(b1, d1) / Math.max(b1, d1);
    if (rw < 0.55 || rh < 0.55) return null;
    return {
      pts: P.map(function (c) { return [c.cx, c.cy]; }),
      score: (L.area + O[0].area + O[1].area + O[2].area) * rw * rh
    };
  }

  function findMarkers(g, w, h) {
    var side = Math.max(w, h), i;
    var dk = flatten(g, w, h, Math.round(side / 22));
    var bin = new Uint8Array(w * h);
    for (i = 0; i < bin.length; i++) bin[i] = dk[i] > 140 ? 1 : 0;
    var minS = side * 0.010, maxS = side * 0.16;
    var cs = components(bin, w, h, minS * minS * 0.4).filter(function (c) {
      var bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      if (bw < minS || bh < minS || bw > maxS || bh > maxS) return false;
      if (c.minx < 1 || c.miny < 1 || c.maxx > w - 2 || c.maxy > h - 2) return false;
      var asp = bw / bh;
      if (asp < 0.5 || asp > 2) return false;
      return c.area / (bw * bh) > 0.45;
    });
    cs.sort(function (a, b) { return b.area - a.area; });
    cs = cs.slice(0, 8);
    var best = null, a, b, c, d;
    for (a = 0; a < cs.length; a++) for (b = a + 1; b < cs.length; b++) for (c = b + 1; c < cs.length; c++) for (d = c + 1; d < cs.length; d++) {
      var q = quad([cs[a], cs[b], cs[c], cs[d]]);
      if (q && (!best || q.score > best.score)) best = q;
    }
    if (!best) return { ok: false, err: 'markers', found: cs.length };
    return { ok: true, pts: best.pts };
  }

  // Solve for the 3x3 matrix (h8 = 1) taking four src points to four dst points.
  function homography(src, dst) {
    var A = [], b = [], i, r, c, k, f;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (c = 0; c < 8; c++) {
      var piv = c, t;
      for (r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      t = A[c]; A[c] = A[piv]; A[piv] = t; t = b[c]; b[c] = b[piv]; b[piv] = t;
      for (r = c + 1; r < 8; r++) {
        f = A[r][c] / A[c][c];
        for (k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    var hm = new Array(8);
    for (r = 7; r >= 0; r--) {
      var s = b[r];
      for (k = r + 1; k < 8; k++) s -= A[r][k] * hm[k];
      hm[r] = s / A[r][r];
    }
    return hm;
  }

  // Resample the photo into flat template space.
  function warp(g, w, h, hm) {
    var ow = Math.round((W + 2 * PAD) * S), oh = Math.round((H + 2 * PAD) * S);
    var out = new Uint8Array(ow * oh), u, v;
    for (v = 0; v < oh; v++) {
      var ty = v / S - PAD;
      for (u = 0; u < ow; u++) {
        var tx = u / S - PAD, den = hm[6] * tx + hm[7] * ty + 1;
        var x = (hm[0] * tx + hm[1] * ty + hm[2]) / den, y = (hm[3] * tx + hm[4] * ty + hm[5]) / den;
        if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) { out[v * ow + u] = 255; continue; }
        var xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, p = yi * w + xi;
        out[v * ow + u] = g[p] * (1 - fx) * (1 - fy) + g[p + 1] * fx * (1 - fy) + g[p + w] * (1 - fx) * fy + g[p + w + 1] * fx * fy;
      }
    }
    return { data: out, w: ow, h: oh };
  }

  function diskMean(d, w, h, cx, cy, rad) {
    var x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
    var y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
    var s = 0, n = 0, r2 = rad * rad, x, y;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      var dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) { s += d[y * w + x]; n++; }
    }
    return n ? s / (n * 255) : 0;
  }

  // m: index of the single marked option, '' for blank, '*' for several or everything filled.
  function decide(sc, thr) {
    var mn = Math.min.apply(null, sc), mx = 0, i, adj = [];
    for (i = 0; i < sc.length; i++) { adj.push(sc[i] - mn); if (adj[i] > mx) mx = adj[i]; }
    if (mn > 0.30) return { m: '*', adj: adj };
    if (mx < thr) return { m: '', adj: adj };
    var cut = Math.max(thr, 0.6 * mx), hits = [];
    for (i = 0; i < adj.length; i++) if (adj[i] >= cut) hits.push(i);
    return hits.length === 1 ? { m: hits[0], adj: adj } : { m: '*', adj: adj };
  }

  function scan(g, w, h, lay, opts) {
    var thr = (opts && opts.thr) || 0.18;
    var f = findMarkers(g, w, h);
    if (!f.ok) return f;
    var hm = homography([[0, 0], [W, 0], [W, H], [0, H]], f.pts);
    var wp = warp(g, w, h, hm);
    var dk = flatten(wp.data, wp.w, wp.h, 48);
    function sample(b, r) { return diskMean(dk, wp.w, wp.h, (b.x + PAD) * S, (b.y + PAD) * S, r * S * 0.6); }
    var answers = [], fills = [], marked = 0, i, dres;
    for (i = 0; i < lay.qs.length; i++) {
      dres = decide(lay.qs[i].b.map(function (b) { return sample(b, R); }), thr);
      fills.push(dres.adj);
      answers.push(dres.m === '*' ? '*' : dres.m === '' ? '' : LET[dres.m]);
      if (dres.m !== '') marked++;
    }
    var idStr = '';
    for (i = 0; i < lay.idCols.length; i++) {
      dres = decide(lay.idCols[i].b.map(function (b) { return sample(b, RID); }), Math.max(thr, 0.15));
      idStr += dres.m === '*' ? '*' : dres.m === '' ? '_' : String(dres.m);
    }
    return { ok: true, warp: wp, pts: f.pts, answers: answers, fills: fills, idStr: idStr, marked: marked };
  }

  function right(it, a) { return !!it.bonus || (!!a && a !== '*' && a === it.a); }

  // ans: array of '', '*' or a letter per item. Items may carry pts and bonus (credit to everyone).
  function grade(exam, ans) {
    var earned = 0, total = 0, correct = 0, i;
    for (i = 0; i < exam.items.length; i++) {
      var it = exam.items[i], p = it.pts > 0 ? +it.pts : 1;
      total += p;
      if (right(it, ans[i])) { earned += p; correct++; }
    }
    return { earned: Math.round(earned * 100) / 100, total: Math.round(total * 100) / 100, correct: correct, n: exam.items.length };
  }

  // DepEd K-12 transmutation: 60 to 100 maps to 75 to 100 in steps of 1.60, below 60 maps to 60 to 74 in steps of 4.
  function transmute(pct) {
    var v = Math.round(clamp(+pct || 0, 0, 100) * 100);
    if (v >= 10000) return 100;
    if (v >= 6000) return 75 + Math.floor((v - 6000) / 160);
    return 60 + Math.floor(v / 400);
  }

  function mean(a) { var t = 0, i; for (i = 0; i < a.length; i++) t += a[i]; return a.length ? t / a.length : 0; }
  function median(a) {
    var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1;
    return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : 0;
  }
  function sdev(a) {   // sample standard deviation
    if (a.length < 2) return null;
    var m = mean(a), t = 0, i;
    for (i = 0; i < a.length; i++) t += (a[i] - m) * (a[i] - m);
    return Math.sqrt(t / (a.length - 1));
  }
  function summary(a) { return a.length ? { min: Math.min.apply(null, a), max: Math.max.apply(null, a), avg: mean(a), med: median(a), sd: sdev(a) } : null; }
  function pearson(x, y) {
    var n = x.length, mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0, i;
    if (n < 2) return null;
    for (i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
    if (!sxx || !syy) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  // Statistics and item analysis for a set of papers. answers: one array of '', '*' or letters per paper.
  // p is the difficulty index (share who got the item right). df is the D.F.: the Pearson correlation between
  // getting the item right and the total score, the same measure ZipGrade reports.
  function analyze(exam, answers) {
    var n = answers.length, scores = [], pcts = [], total = grade(exam, []).total, j;
    for (j = 0; j < n; j++) { var g = grade(exam, answers[j]); scores.push(g.earned); pcts.push(total ? 100 * g.earned / total : 0); }
    var items = exam.items.map(function (it, i) {
      var counts = {}, blank = 0, hit = 0, x = [], k;
      for (k = 0; k < n; k++) {
        var a = answers[k][i];
        if (!a || a === '*') blank++; else counts[a] = (counts[a] || 0) + 1;
        if (right(it, a)) { hit++; x.push(1); } else x.push(0);
      }
      return { i: i, n: i + 1, right: hit, blank: blank, counts: counts, p: n ? hit / n : 0, df: pearson(x, scores) };
    });
    return { n: n, total: total, score: summary(scores), pct: summary(pcts), mps: n ? mean(pcts) : null, items: items };
  }

  function diffLabel(p) { return p <= 0.20 ? 'Very difficult' : p <= 0.40 ? 'Difficult' : p <= 0.60 ? 'Moderate' : p <= 0.80 ? 'Easy' : 'Very easy'; }
  // DepEd mastery levels for a mean percentage score.
  function mastery(m) {
    return m >= 96 ? 'Mastered' : m >= 86 ? 'Closely approximating mastery' : m >= 66 ? 'Moving towards mastery' : m >= 35 ? 'Average mastery' : m >= 15 ? 'Low mastery' : m >= 5 ? 'Very low mastery' : 'Absolutely no mastery';
  }

  // Helvetica character widths for ASCII 32..126, per 1000 units. Used to centre and right-align text.
  var HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  function tw(s) {
    var t = 0, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); t += (c >= 32 && c <= 126 ? HW[c - 32] : 556); }
    return t / 1000;
  }
  function pdfEnc(s) {
    var o = '', i, c;
    s = String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      o += ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) ? s.charAt(i) : (c < 32 ? ' ' : '?');
    }
    return o;
  }

  // One-page PDF of the answer sheet, written by hand so it works offline. Returns a Uint8Array.
  function sheetPDF(lay, o) {
    o = o || {};
    var K = 72 / 25.4, pw = o.paper === 'letter' ? 612 : 595.276, ph = o.paper === 'letter' ? 792 : 841.89;
    var ox = pw / 2 - lay.W * K / 2, ot = ph / 2 - lay.H * K / 2, out = [];
    function f(n) { return String(Math.round(n * 100) / 100); }
    function X(x) { return ox + x * K; }
    function Y(y) { return ph - (ot + y * K); }
    function gray(v) { out.push(f(v / 255) + ' g ' + f(v / 255) + ' G'); }
    function lw(mm) { out.push(f(mm * K) + ' w'); }
    function rect(x, y, w, h, fill) { out.push(f(X(x)) + ' ' + f(Y(y + h)) + ' ' + f(w * K) + ' ' + f(h * K) + ' re ' + (fill ? 'f' : 'S')); }
    function line(x1, y1, x2, y2) { out.push(f(X(x1)) + ' ' + f(Y(y1)) + ' m ' + f(X(x2)) + ' ' + f(Y(y2)) + ' l S'); }
    function circle(cx, cy, r) {
      var x = X(cx), y = Y(cy), rr = r * K, c = 0.5523 * rr;
      out.push([f(x + rr), f(y), 'm', f(x + rr), f(y + c), f(x + c), f(y + rr), f(x), f(y + rr), 'c',
        f(x - c), f(y + rr), f(x - rr), f(y + c), f(x - rr), f(y), 'c',
        f(x - rr), f(y - c), f(x - c), f(y - rr), f(x), f(y - rr), 'c',
        f(x + c), f(y - rr), f(x + rr), f(y - c), f(x + rr), f(y), 'c S'].join(' '));
    }
    function text(s, x, y, size, opt) {
      opt = opt || {};
      s = pdfEnc(s);
      var w = tw(s) * size, dx = opt.align === 'right' ? w : opt.align === 'center' ? w / 2 : 0;
      out.push('BT /' + (opt.bold ? 'F2' : 'F1') + ' ' + f(size) + ' Tf ' + f(X(x) - dx) + ' ' + f(Y(y)) + ' Td (' + s.replace(/[\\()]/g, '\\$&') + ') Tj ET');
    }

    gray(0);
    lay.markers.forEach(function (m) { rect(m.x - m.s / 2, m.y - m.s / 2, m.s, m.s, true); });
    gray(20); text(String(o.title || 'Answer sheet').slice(0, 46), 12, 10, 12, { bold: true });
    [['Name', 21], ['Section', 31], ['Date', 41]].forEach(function (r) {
      gray(20); text(r[0], 12, r[1], 9);
      gray(60); lw(0.25); line(28, r[1] + 0.8, Math.min(94, lay.idLeft - 6), r[1] + 0.8);
    });
    gray(110);
    ['Use a dark pen or soft pencil.', 'Fill each bubble completely.', 'Erase fully to change an answer.', 'Keep the black corner squares clean.', 'Do not fold or crumple this sheet.']
      .forEach(function (t, i) { text(t, 12, 52 + i * 3.1, 7.5); });
    gray(60); text('STUDENT ID', lay.idLeft + 1, 12, 7, { bold: true });
    lay.idCols.forEach(function (col) {
      gray(60); lw(0.25); rect(col.x - lay.idPx / 2 + 0.3, 13.4, lay.idPx - 0.6, 5, false);
      col.b.forEach(function (b) {
        gray(40); lw(0.25); circle(b.x, b.y, lay.RID);
        gray(150); text(String(b.d), b.x, b.y + 0.7, 5, { align: 'center' });
      });
    });
    gray(60); text('ANSWERS', 12, 69.5, 8, { bold: true });
    gray(80); lw(0.3); line(10, 72, 170, 72);
    gray(110);
    lay.letters.forEach(function (l) { text(l.t, l.x, l.y + 0.8, 7, { align: 'center' }); });
    lay.qs.forEach(function (q) {
      gray(30); text(String(q.n), q.numX, q.y + 1, 8, { bold: true, align: 'right' });
      q.b.forEach(function (b) {
        gray(40); lw(0.3); circle(b.x, b.y, lay.R);
        gray(150); text(b.c, b.x, b.y + 0.9, 6.5, { align: 'center' });
      });
    });
    gray(130); text(o.footer || '', 12, 240, 6.5);

    var content = out.join('\n');
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pw) + ' ' + f(ph) + '] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    ];
    var pdf = '%PDF-1.4\n', offs = [], i;
    objs.forEach(function (b, k) { offs.push(pdf.length); pdf += (k + 1) + ' 0 obj\n' + b + '\nendobj\n'; });
    var xr = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (n) { pdf += ('0000000000' + n).slice(-10) + ' 00000 n \n'; });
    pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n';
    var u8 = new Uint8Array(pdf.length);
    for (i = 0; i < pdf.length; i++) u8[i] = pdf.charCodeAt(i) & 255;
    return u8;
  }

  return {
    W: W, H: H, PAD: PAD, S: S, R: R, RID: RID, LET: LET,
    layout: layout, formatFor: formatFor, scan: scan, grade: grade, right: right, transmute: transmute, analyze: analyze, diffLabel: diffLabel, mastery: mastery, sheetPDF: sheetPDF, HW: HW,
    flatten: flatten, findMarkers: findMarkers, homography: homography
  };
})();
if (typeof module !== 'undefined') module.exports = PM;
