/**
 * photogram.js — عکسِ گوشیِ فریم → مدل سه‌بعدیِ میلی‌متری (بدون Blender)
 *
 * مسیرِ کار:
 *  ۱) جداسازی فریم از هر پس‌زمینه‌ای (آلفا، یا پرکردنِ از لبه‌ها با آستانهٔ رنگی)
 *  ۲) ترازکردنِ عکس (چرخشِ جزئیِ عکسِ گوشی و آینه‌ای‌بودن با یک کلید)
 *  ۳) یافتنِ «حفرهٔ عدسی‌ها» به‌صورت ناحیه‌های بسته — robust‌تر از اسکنِ سطری
 *  ۴) اندازه‌گیریِ میلی‌متری: عرض/ارتفاع عدسی، DBL، ضخامت رینگ، پهنای کل
 *  ۵) حدسِ جنس، فینیش، رنگ و نوع عدسی از خودِ پیکسل‌ها
 *  ۶) (اختیاری) عکسِ دومِ نمای جانبی ⇒ طول دسته
 *
 * همه‌چیز روی همان imageData خام کار می‌کند تا در Node هم تست‌شدنی باشد.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export const BG_DIST = 44; // فاصلهٔ رنگی تا پس‌زمینه برای «جوهر» بودن

/** RGB → ماسک جوهر (اگر آلفا باشد، از همان استفاده می‌کنیم) */
export function inkMask(width, height, rgba) {
  const mask = new Uint8Array(width * height);
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i] < 250) {
      hasAlpha = true;
      break;
    }
  if (hasAlpha) {
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) mask[i] = rgba[p + 3] > 24 ? 1 : 0;
    return mask;
  }
  // رنگ پس‌زمینه از حاشیه‌ها
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const edge = (x, y) => {
    const p = (y * width + x) * 4;
    r += rgba[p];
    g += rgba[p + 1];
    b += rgba[p + 2];
    n++;
  };
  for (let x = 0; x < width; x += 2) {
    edge(x, 0);
    edge(x, 1);
    edge(x, height - 2);
    edge(x, height - 1);
  }
  for (let y = 0; y < height; y += 2) {
    edge(0, y);
    edge(1, y);
    edge(width - 2, y);
    edge(width - 1, y);
  }
  r /= n;
  g /= n;
  b /= n;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const d = Math.abs(rgba[p] - r) + Math.abs(rgba[p + 1] - g) + Math.abs(rgba[p + 2] - b);
    mask[i] = d > BG_DIST * 3 ? 1 : 0;
  }
  return mask;
}

export function bboxOf(mask, w, h) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۱) جداسازی پس‌زمینه — کارِ عکسِ گوشی با هر پس‌زمینه‌ای
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * ناحیه‌های «اصلی» تصویر: هر part که به لبهٔ تصویر نچسبیده باشد.
 * پس‌زمینه هیچ‌وقت partِ اصلی نیست (از لبه شروع شده)، پس فریمِ وسطِ عکس
 * انتخاب می‌شود، نه هر لکه‌ای که بزرگ‌تر باشد.
 */
export function mainParts(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const parts = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const pixels = [];
    let touches = false;
    while (sp) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % w,
        y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[sp++] = i - 1);
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[sp++] = i + 1);
      if (y > 0 && mask[i - w] && !seen[i - w]) (seen[i - w] = 1), (stack[sp++] = i - w);
      if (y < h - 1 && mask[i + w] && !seen[i + w]) (seen[i + w] = 1), (stack[sp++] = i + w);
    }
    parts.push({ pixels, touches, area: pixels.length });
  }
  const inner = parts.filter((p) => !p.touches).sort((a, b) => b.area - a.area);
  const pool = inner.length ? inner : parts.slice().sort((a, b) => b.area - a.area);
  if (!pool.length) return { mask: new Uint8Array(w * h), area: 0, parts: [] };
  const keep = Math.max(24, Math.round(pool[0].area * 0.25));
  const out = new Uint8Array(w * h);
  for (const part of pool) {
    if (part.area < keep) break;
    for (const i of part.pixels) out[i] = 1;
  }
  return { mask: out, area: pool[0].area, parts: pool.length };
}

/**
 * بستنِ ریز‌سوراخ‌های ماسک (dilate سپس erode).
 * عکسِ گوشی لبه‌های ضدلبه دارد؛ یک پیکسل افتادن در آستانه، حلقهٔ فریم را
 * می‌شکند و «حفرهٔ عدسی» دیگر بسته نمی‌ماند. اگر بستن، سطح را خیلی کم کند
 * (یعنی حلقه نازک‌تر از ۲ پیکسل بوده) برگردانده می‌شود.
 */
export function closeMask(mask, w, h, r = 1) {
  const count = (m) => {
    let n = 0;
    for (let i = 0; i < m.length; i++) n += m[i];
    return n;
  };
  const before = count(mask);
  const dil = new Uint8Array(w * h);
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1;
      }
      dil[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let k = -r; k <= r && v; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w || !dil[y * w + xx]) v = 0;
      }
      tmp[y * w + x] = v;
    }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      let v = 1;
      for (let k = -r; k <= r && v; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h || !tmp[yy * w + x]) v = 0;
      }
      mask[y * w + x] = v;
    }
  return count(mask) >= before * 0.72;
}

/** آستانهٔ اُتسو روی یک نقشهٔ فاصله (تفکیکِ دو خوشه) */
function otsuThreshold(values) {
  const bins = new Float64Array(256);
  let max = 0;
  for (let i = 0; i < values.length; i += 3) if (values[i] > max) max = values[i];
  if (!(max > 1)) return max;
  let total = 0,
    sum = 0;
  for (let i = 0; i < values.length; i++) {
    const b = Math.min(255, Math.round((values[i] / max) * 255));
    bins[b] += 1;
    total += 1;
    sum += b;
  }
  let sumB = 0,
    wB = 0,
    best = 0,
    thr = max * 0.5;
  for (let i = 0; i < 256; i++) {
    wB += bins[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * bins[i];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = ((i + 1) / 255) * max;
    }
  }
  return thr;
}

/** فاصلهٔ رنگیِ وزن‌دار (به‌جای RGB خام، چشمِ انسان به سبز حساس‌تر است) */
function colorDist(d, i, r, g, b) {
  const p = i * 4;
  return 0.3 * Math.abs(d[p] - r) + 0.59 * Math.abs(d[p + 1] - g) + 0.11 * Math.abs(d[p + 2] - b);
}

/**
 * ناحیه‌های پیوستهٔ مهم: بزرگ‌ترین + هر part که دست‌کم ۲۵٪ آن باشد.
 * یک عکسِ کم‌رزولوشت یا تولیدشده ممکن است فریم را دو حلقهٔ جدا نشان دهد؛
 * با «فقطِ بزرگ‌ترین» نیمی از عینک گم می‌شد.
 */
export function largestComponent(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const parts = [];
  let best = null;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const pixels = [];
    while (sp) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % w,
        y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[sp++] = i - 1);
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[sp++] = i + 1);
      if (y > 0 && mask[i - w] && !seen[i - w]) (seen[i - w] = 1), (stack[sp++] = i - w);
      if (y < h - 1 && mask[i + w] && !seen[i + w]) (seen[i + w] = 1), (stack[sp++] = i + w);
    }
    parts.push(pixels);
    if (!best || pixels.length > best.length) best = pixels;
  }
  const out = new Uint8Array(w * h);
  if (best) for (const i of best) out[i] = 1;
  const keep = best ? Math.max(24, Math.round(best.length * 0.25)) : 0;
  for (const part of parts) {
    if (part === best || part.length < keep) continue;
    for (const i of part) out[i] = 1;
  }
  return { mask: out, area: best ? best.length : 0 };
}

/**
 * ماسکِ فریم از هر عکسی: اول آلفا (PNG بریده)، وگرنه پرکردنِ پس‌زمینه از لبه‌ها.
 * آستانه دو بار سخت‌گیرانه‌تر می‌شود تا سایهٔ نرمِ روی میز هم پاک شود.
 * @returns {{mask:Uint8Array, mode:string, bg:number[], coverage:number, holes:number}}
 */
export function foregroundMask(w, h, data) {
  // ۱) آلفای واقعی دارد؟
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;
  if (transparent > data.length / 4 * 0.004) {
    const mask = new Uint8Array(w * h);
    let ink = 0;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      mask[i] = data[p + 3] > 24 ? 1 : 0;
      ink += mask[i];
    }
    const { mask: big, area, parts } = mainParts(mask, w, h);
    return { mask: big, mode: "alpha", bg: [255, 255, 255], coverage: area / (w * h), parts, holes: enclosedHoles(big, w, h).length };
  }

  // ۲) امتیازِ «چقدر شبیه پس‌زمینه است» برای هر پیکسل، بعد آستانهٔ اُتسو.
  //    مرجع، رنگِ لبه‌های همان سطر است (میزِ چوبی/سایهٔ نرم هم درست جدا می‌شود)
  const ch3 = (i, k) => data[i * 4 + k];
  let gr = 0,
    gg = 0,
    gb = 0,
    gn = 0;
  for (let x = 0; x < w; x += 2)
    for (const y of [0, 1, h - 2, h - 1]) {
      gr += ch3(y * w + x, 0);
      gg += ch3(y * w + x, 1);
      gb += ch3(y * w + x, 2);
      gn++;
    }
  for (let y = 0; y < h; y += 2)
    for (const x of [0, 1, w - 2, w - 1]) {
      gr += ch3(y * w + x, 0);
      gg += ch3(y * w + x, 1);
      gb += ch3(y * w + x, 2);
      gn++;
    }
  const mean = [gr / gn, gg / gn, gb / gn];
  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    // مرجعِ سطر: میانهٔ ۳ پیکسلِ اول و آخر
    const pick = (k) => {
      const v = [];
      for (let i = 0; i < 3; i++) {
        v.push(ch3(y * w + i, k));
        v.push(ch3(y * w + (w - 1 - i), k));
      }
      v.sort((a, b) => a - b);
      return v[v.length >> 1];
    };
    const ref = [pick(0), pick(1), pick(2)];
    const far = 0.3 * Math.abs(ref[0] - mean[0]) + 0.59 * Math.abs(ref[1] - mean[1]) + 0.11 * Math.abs(ref[2] - mean[2]);
    const use = far > 42 ? mean : ref; // اگر فریم تا لبه رسیده، مرجعِ کلی را بردار
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dr = 0.3 * Math.abs(ch3(i, 0) - use[0]) + 0.59 * Math.abs(ch3(i, 1) - use[1]) + 0.11 * Math.abs(ch3(i, 2) - use[2]);
      const dg = 0.3 * Math.abs(ch3(i, 0) - mean[0]) + 0.59 * Math.abs(ch3(i, 1) - mean[1]) + 0.11 * Math.abs(ch3(i, 2) - mean[2]);
      dist[i] = Math.min(dr, dg);
    }
  }
  const thr = Math.max(14, otsuThreshold(dist));
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = dist[i] > thr ? 1 : 0;
  const bg = mean.map((v) => Math.round(v));
  closeMask(raw, w, h, 1); // لبه‌های ضدلبهٔ عکس نباید حلقهٔ فریم را بشکنند
  const { mask: big, area, parts } = mainParts(raw, w, h);
  const coverage = area / (w * h);
  if (coverage > 0.94 || coverage < 0.0008) {
    // تفکیک ممکن نبود (پس‌زمینهٔ شلوغ یا فریمِ کم‌کنتراست) ⇒ فاصلهٔ رنگیِ کلاسیک
    const fallback = mainParts(inkMask(w, h, data), w, h);
    return { mask: fallback.mask, mode: "color", bg, coverage: fallback.area / (w * h), holes: enclosedHoles(fallback.mask, w, h).length };
  }
  return { mask: big, mode: "otsu", bg, coverage, parts, holes: enclosedHoles(big, w, h).length };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۲) حفرهٔ عدسی‌ها (ناحیه‌های بسته) و دنبالیِ لبهٔ پیکسلی
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * نواحیِ پس‌زمینه که به لبهٔ تصویر وصل نیستند = سوراخ‌های عدسی.
 * برخلاف اسکنِ سطری، با فریمِ کج، دستهٔ افتاده روی عدسی و عدسیِ نیمه‌پر هم درست کار می‌کند.
 */
export function enclosedHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const pixels = [];
    let touches = false;
    while (sp) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % w,
        y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x > 0 && !mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[sp++] = i - 1);
      if (x < w - 1 && !mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[sp++] = i + 1);
      if (y > 0 && !mask[i - w] && !seen[i - w]) (seen[i - w] = 1), (stack[sp++] = i - w);
      if (y < h - 1 && !mask[i + w] && !seen[i + w]) (seen[i + w] = 1), (stack[sp++] = i + w);
    }
    if (!touches && pixels.length > 24) out.push(pixels);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/** دنبالیِ لبهٔ پیکسلی (روی ترکِ شبکه ⇒ بدون پله، برای فریمِ کج هم صاف) */
export function traceContour(mask, w, h, seedIndex) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  // یال‌های مرزی: برای هر پیکسلِ پر، هر ضلعی که همسایه‌اش پس‌زمینه است
  const edges = new Map();
  const key = (x, y) => y * (w + 1) + x;
  const addEdge = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    const list = edges.get(k);
    if (list) list.push([x1, y1]);
    else edges.set(k, [[x1, y1]]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!at(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!at(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  // نقطهٔ شروع: یالِ چپ‌بالاییِ اولین پیکسلِ پر (روی لبهٔ بیرونی)
  let start = null;
  const from = seedIndex ?? firstInk(mask, w, h);
  if (from == null) return [];
  {
    const sx = from % w,
      sy = (from / w) | 0;
    if (at(sx, sy - 1) && edges.has(key(sx, sy))) start = [sx, sy];
    else if (at(sx - 1, sy) && edges.has(key(sx, sy + 1))) start = [sx, sy + 1];
    else if (at(sx, sy + 1) && edges.has(key(sx + 1, sy + 1))) start = [sx + 1, sy + 1];
    else start = [sx + 1, sy];
  }
  const pts = [];
  let [cx, cy] = start;
  const startKey = key(cx, cy);
  let guard = w * h * 4;
  do {
    pts.push({ x: cx, y: cy });
    const list = edges.get(key(cx, cy));
    if (!list || !list.length) break;
    const [nx, ny] = list.shift();
    cx = nx;
    cy = ny;
  } while (key(cx, cy) !== startKey && guard-- > 0);
  if (pts.length > 2) {
    // جهتِ پادساعتگرد در فضای y-رو-به-پایین ⇒ برای مسیرِ لنز لازم است
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    if (a < 0) pts.reverse();
  }
  return pts;
}

function firstInk(mask, w, h) {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return i;
  void w;
  void h;
  return null;
}

/** کوچک‌ترین ناحیه‌ای از پس‌زمینه که همسایهٔ جوبر است (نقطهٔ شروعِ امن برای دنبالی) */
function boundarySeed(pixels, mask, w, h) {
  for (const i of pixels) {
    const x = i % w,
      y = (i / w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || mask[ny * w + nx]) return i;
    }
  }
  return pixels[0];
}

/** ستونِ کم‌جمعیت نزدیک مرکز → خطِ برش بین دو لنز */
export function bridgeSplit(mask, w, h, box) {
  const col = new Int32Array(w);
  for (let y = box.y0; y <= box.y1; y++) for (let x = 0; x < w; x++) col[x] += mask[y * w + x];
  let best = box.cx,
    bestV = Infinity;
  const lo = Math.max(box.x0 + 3, box.cx - box.w * 0.14),
    hi = Math.min(box.x1 - 3, box.cx + box.w * 0.14);
  for (let x = Math.ceil(lo); x <= Math.floor(hi); x++) {
    const v = col[x] + Math.abs(x - box.cx) * 0.08;
    if (v < bestV) {
      bestV = v;
      best = x;
    }
  }
  return Math.round(best);
}

/**
 * بیرون‌کاوی عدسی در یک ناحیه (مسیرِ قدیمیِ سطری — به‌عنوان پشتیبانِ الگوریتمِ نو).
 * اولین پیکسل جوهر = لبهٔ داخلی فریم؛ آخرین پیکسل = لبهٔ بیرونی ⇒ ضخامت رینگ.
 */
export function traceLens(mask, w, h, x0, y0, x1, y1, samples = 180) {
  x0 = Math.max(0, x0);
  x1 = Math.min(w - 1, x1);
  y0 = Math.max(0, y0);
  y1 = Math.min(h - 1, y1);
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    let lo = -1,
      hi = -1;
    for (let x = x0; x <= x1; x++) {
      if (mask[y * w + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    if (lo < 0) continue;
    let a = -1,
      b = -2,
      run = -1;
    for (let x = lo; x <= hi; x++) {
      if (!mask[y * w + x]) {
        if (run < 0) run = x;
      } else if (run >= 0) {
        if (x - 1 - run > b - a) {
          a = run;
          b = x - 1;
        }
        run = -1;
      }
    }
    if (run >= 0 && hi - run > b - a) {
      a = run;
      b = hi;
    }
    if (a < 0 || b - a < 5) continue;
    rows.push({ y, a, b, lo, hi });
  }
  if (rows.length < 10) return null;
  const widths = rows.map((r) => r.b - r.a).sort((m, n) => m - n);
  const med = widths[widths.length >> 1];
  const band = rows.filter((r) => r.b - r.a > med * 0.5 && r.b - r.a < med * 2.1);
  if (band.length < 10) return null;
  const yA = band[0].y,
    yB = band[band.length - 1].y;
  const holeL = Math.min(...band.map((r) => r.a)),
    holeR = Math.max(...band.map((r) => r.b));
  const out = band.map((r) => Math.max(r.hi - r.b, r.a - r.lo)).sort((m, n) => m - n);
  const rimPx = Math.max(1.2, out[out.length >> 1]);
  const cx = (holeL + holeR) / 2,
    cy = (yA + yB) / 2;
  const inner = resample(uniform(band), samples);
  const outer = inner.map((pt) => {
    const dx = pt.x - cx,
      dy = pt.y - cy;
    const L = Math.hypot(dx, dy) || 1;
    return { x: pt.x + (dx / L) * rimPx, y: pt.y + (dy / L) * rimPx };
  });
  return {
    inner,
    outer,
    cx,
    cy,
    rimPx,
    samples: band.length,
    coverage: band.length / Math.max(1, yB - yA + 1),
    rows: rows.length,
    hole: { x0: holeL, x1: holeR, y0: yA, y1: yB, w: holeR - holeL, h: yB - yA },
  };
}

/** لبه‌های چپ/راستِ حفره در سطرهای یکنواخت تا خط نرم بماند */
function uniform(band) {
  const step = Math.max(1, Math.floor(band.length / 64));
  const pts = [];
  for (let i = 0; i < band.length; i += step) pts.push({ x: band[i].b, y: band[i].y });
  for (let i = band.length - 1; i >= 0; i -= step) pts.push({ x: band[i].a, y: band[i].y });
  return pts;
}

/** بازتوزیع یکنواخت روی محیط (برای حذف فشردگیِ گوشه‌ها) */
function resample(pts, n) {
  if (pts.length < 3) return pts;
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(d);
    total += d;
  }
  const out = [];
  let i = 0,
    acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (i < seg.length - 1 && acc + seg[i] < target) {
      acc += seg[i];
      i++;
    }
    const t = seg[i] ? (target - acc) / seg[i] : 0;
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** هموارسازیِ ساده (سه‌نمونه‌ای، چند گذر) */
function smooth(pts, passes = 2) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length;
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n],
        b = cur[i],
        c = cur[(i + 1) % n];
      next[i] = { x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 };
    }
    cur = next;
  }
  return cur;
}

/** جهتِ چندضلعی را پادساعتگرد می‌کند (m m-space، y رو به بالا) */
function orientCCW(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? pts.slice().reverse() : pts;
}

function boxOf(pts) {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { w: (x1 - x0) / 2, h: y1 - y0, x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۳) ترازکردنِ عکس (چرخشِ جزئیِ عکسِ گوشی) و آینه
 * ───────────────────────────────────────────────────────────────────────── */

/** چرخشِ دوخطیِ imageData حول مرکز (برای صاف‌کردنِ عکسِ کجِ گوشی) */
export function rotateImageData(src, angleDeg, fill = [255, 255, 255, 255]) {
  if (!angleDeg || Math.abs(angleDeg) < 0.05) return { data: src, width: src.width, height: src.height };
  const w = src.width,
    h = src.height;
  const out = new Uint8ClampedArray(w * h * 4);
  const a = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  const cx = w / 2,
    cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx,
        dy = y - cy;
      const sx = Math.round(cos * dx - sin * dy + cx);
      const sy = Math.round(sin * dx + cos * dy + cy);
      const o = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
        out[o] = fill[0];
        out[o + 1] = fill[1];
        out[o + 2] = fill[2];
        out[o + 3] = fill[3];
        continue;
      }
      const s = (sy * w + sx) * 4;
      out[o] = src.data[s];
      out[o + 1] = src.data[s + 1];
      out[o + 2] = src.data[s + 2];
      out[o + 3] = src.data[s + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/** آینهٔ افقی (عکسی که از پشتِ عینک گرفته شده) */
export function mirrorImageData(src) {
  const w = src.width,
    h = src.height;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + (w - 1 - x)) * 4,
        o = (y * w + x) * 4;
      out[o] = src.data[s];
      out[o + 1] = src.data[s + 1];
      out[o + 2] = src.data[s + 2];
      out[o + 3] = src.data[s + 3];
    }
  return { data: out, width: w, height: h };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۴) اندازه‌گیری
 * ───────────────────────────────────────────────────────────────────────── */

/** ضخامتِ رینگ: پرتابِ پرتو از هر نقطهٔ خطِ عدسی به بیرون تا آخرین پیکسلِ جوهر */
export function rimBand(mask, w, h, contour, cx, cy) {
  const widths = [];
  let top = 0,
    topN = 0,
    bottom = 0,
    bottomN = 0;
  for (const p of contour) {
    let dx = p.x - cx,
      dy = p.y - cy;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    let d = 0;
    for (let step = 1; step < 60; step++) {
      const x = Math.round(p.x + dx * step),
        y = Math.round(p.y + dy * step);
      if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) break;
      d = step;
    }
    if (d <= 0) continue;
    widths.push(d);
    if (p.y < cy) {
      top += d;
      topN++;
    } else {
      bottom += d;
      bottomN++;
    }
  }
  if (!widths.length) return { median: 0, top: 0, bottom: 0, p25: 0, p75: 0, n: 0 };
  const s = widths.sort((a, b) => a - b);
  return {
    median: median(s),
    p25: s[Math.floor(s.length * 0.25)],
    p75: s[Math.floor(s.length * 0.75)],
    top: topN ? top / topN : 0,
    bottom: bottomN ? bottom / bottomN : 0,
    n: widths.length,
  };
}

/** کمترین فاصلهٔ دو خط (DBL واقعی، حتی اگر فریم کج باشد) */
export function contourGap(a, b) {
  let best = Infinity,
    pa = null,
    pb = null;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    for (let j = 0; j < b.length; j += 1) {
      const q = b[j];
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best) {
        best = d;
        pa = p;
        pb = q;
      }
    }
  }
  return { dist: Math.sqrt(best), a: pa, b: pb };
}

/** مرکزِ جرم و مساحتِ یک خطِ بسته */
function contourStats(pts) {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) return { area: 0, cx: mean(pts.map((p) => p.x)), cy: mean(pts.map((p) => p.y)) };
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

/**
 * پرکردنِ سوراخ به روشِ «بازهٔ هر سطر» (رو‌به‌رو، مثل نوارِ اسکن).
 * اگر دسته روی عدسی افتاده باشد هم درست کار می‌کند، چون کلِ بازهٔ سطر پر می‌شود.
 */
function fillHole(mask, w, h, pixels) {
  const rows = new Map();
  for (const i of pixels) {
    const x = i % w,
      y = (i / w) | 0;
    const r = rows.get(y);
    if (r) {
      if (x < r[0]) r[0] = x;
      if (x > r[1]) r[1] = x;
    } else rows.set(y, [x, x]);
  }
  let n = 0;
  for (const [y, [x0, x1]] of rows) {
    for (let x = x0; x <= x1; x++)
      if (!mask[y * w + x]) {
        mask[y * w + x] = 1;
        n++;
      }
  }
  void h;
  return n;
}

/**
 * «داخلِ» یک کادر: پیکسل‌های پس‌زمینه‌ای که از لبهٔ کادر قابل دسترس نیستند.
 * برخلاف «حفرهٔ بسته در کلِ تصویر»، به نشتِ پل (پلِ نازک، عکسِ کم‌رزولوشت یا
 * تولیدشده با AI) حساس نیست و راهروی بینِ دو عدسی را هم درست بیرون می‌گذارد.
 * بافرها محلی‌اند تا روی عکسِ ۱۰۰۰×۱۰۰۰ هم فوری جواب بدهد.
 */
function interiorOf(mask, w, h, x0, y0, x1, y1) {
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(w - 1, x1);
  y1 = Math.min(h - 1, y1);
  const cw = x1 - x0 + 1,
    ch = y1 - y0 + 1;
  if (cw < 8 || ch < 8) return null;
  const seen = new Uint8Array(cw * ch);
  const stack = new Int32Array(cw * ch);
  const at = (x, y) => mask[y * w + x];
  const push = (x, y) => {
    const i = (y - y0) * cw + (x - x0);
    if (seen[i] || at(x, y)) return;
    seen[i] = 1;
    stack[sp++] = i;
  };
  let sp = 0;
  for (let x = x0; x <= x1; x++) {
    push(x, y0);
    push(x, y1);
  }
  for (let y = y0; y <= y1; y++) {
    push(x0, y);
    push(x1, y);
  }
  while (sp) {
    const i = stack[--sp];
    const x = x0 + (i % cw),
      y = y0 + ((i / cw) | 0);
    if (x > x0) push(x - 1, y);
    if (x < x1) push(x + 1, y);
    if (y > y0) push(x, y - 1);
    if (y < y1) push(x, y + 1);
  }
  let best = null;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const s0 = (y - y0) * cw + (x - x0);
      if (seen[s0] || at(x, y)) continue;
      const pixels = [];
      sp = 0;
      stack[sp++] = s0;
      seen[s0] = 1;
      while (sp) {
        const i = stack[--sp];
        const cx = x0 + (i % cw),
          cy = y0 + ((i / cw) | 0);
        pixels.push(cy * w + cx);
        if (cx > x0) push(cx - 1, cy);
        if (cx < x1) push(cx + 1, cy);
        if (cy > y0) push(cx, cy - 1);
        if (cy < y1) push(cx, cy + 1);
      }
      if (!best || pixels.length > best.length) best = pixels;
    }
  return best && best.length > Math.max(24, cw * ch * 0.004) ? best : null;
}

/**
 * خطِ برشِ دو عدسی از «کمرِ» فریم: در ستونِ پل، جوهر فقط به اندازهٔ ارتفاعِ پل
 * بالا می‌آید، نه تا پایینِ عدسی ⇒ کمترین بازهٔ عمودی، همان پل است.
 * (شمارشِ پیکسلِ جوهر برای پل‌های چاق اشتباه می‌کند.)
 */
export function waistSplit(mask, w, h, box) {
  const lo = Math.max(box.x0 + 2, Math.ceil(box.cx - box.w * 0.16));
  const hi = Math.min(box.x1 - 2, Math.floor(box.cx + box.w * 0.16));
  let best = Math.round(box.cx),
    bestV = Infinity;
  for (let x = lo; x <= hi; x++) {
    let y0 = -1,
      y1 = -1;
    for (let y = box.y0; y <= box.y1; y++)
      if (mask[y * w + x]) {
        if (y0 < 0) y0 = y;
        y1 = y;
      }
    if (y0 < 0) continue;
    const span = y1 - y0;
    // پل کم‌ارتفاع است؛ کفِ کادر هم کم‌ارتفاع است، پس فقط ستون‌های *پُر* را می‌سنجیم
    if (span < box.h * 0.18) continue;
    const v = span + Math.abs(x - box.cx) * box.h * 0.01;
    if (v < bestV) {
      bestV = v;
      best = x;
    }
  }
  return best;
}

/**
 * مسیرِ عدسیِ چپ/راست را از ماسک بیرون می‌کشد.
 * ترتیبِ اعتماد: حفرهٔ بسته → «داخلِ کادرِ هر نیمه» → اسکنِ سطریِ قدیمی →
 * سایه‌ی بیرونی، برای عدسیِ تیره/آینه‌ای که اصلاً سوراخی ندارد.
 */
function lensContours(mask, w, h, box) {
  const frameArea = Math.max(1, box.w * box.h);
  const shape = (pixels) => {
    const work = new Uint8Array(w * h);
    fillHole(work, w, h, pixels);
    return smooth(resample(traceContour(work, w, h, boundarySeed(pixels, work, w, h)), 128), 2);
  };
  const pair = (a, b, source) => {
    if (!a.length || !b.length || a.length < 20 || b.length < 20) return null;
    const cA = contourStats(a),
      cB = contourStats(b);
    const kR = Math.max(cA.w, cB.w, 1) / Math.max(1, Math.min(cA.w, cB.w));
    if (kR > 1.9) return null; // یکی از دو تا «لکه» است، نه عدسی
    return cA.cx > cB.cx
      ? { right: a, left: b, source, angle: tiltBetween(cB, cA) }
      : { right: b, left: a, source, angle: tiltBetween(cA, cB) };
  };
  const holes = enclosedHoles(mask, w, h).filter((pixels) => pixels.length > frameArea * 0.006);
  if (holes.length >= 2) {
    const cxs = holes.map((pixels) => centroidOf(pixels, w));
    let bi = 0,
      bj = 1,
      best = -1;
    for (let i = 0; i < Math.min(holes.length, 4); i++)
      for (let j = i + 1; j < Math.min(holes.length, 4); j++) {
        const d = Math.abs(cxs[i].x - cxs[j].x);
        if (d > best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    const order = [bi, bj].sort((i, j) => cxs[i].x - cxs[j].x);
    const out = pair(shape(holes[order[0]]), shape(holes[order[1]]), "holes");
    if (out) return { ...out, holes: holes.length };
  }
  // مسیرِ دوم: نیمه‌کردنِ کادر و گرفتنِ «داخلِ» هر نیمه
  const split = waistSplit(mask, w, h, box);
  const right = interiorOf(mask, w, h, split, box.y0, box.x1, box.y1);
  const left = interiorOf(mask, w, h, box.x0, box.y0, split, box.y1);
  if (right && left) {
    const out = pair(shape(left), shape(right), "interior");
    if (out) return { ...out, holes: holes.length };
  }
  return null;
}

/** زاویهٔ کجیِ خطِ دو مرکزِ عدسی (درجه، مثبت = سمتِ راست پایین‌تر) */
function tiltBetween(a, b) {
  return (Math.atan2(b.cy - a.cy, b.cx - a.cx) * 180) / Math.PI;
}

function centroidOf(pixels, w) {
  let sx = 0,
    sy = 0;
  for (const i of pixels) {
    sx += i % w;
    sy += (i / w) | 0;
  }
  return { x: sx / pixels.length, y: sy / pixels.length };
}

/** ضخامتِ رینگ از روی خطِ وسطِ عدسی: طولِ نوارِ جوهرِ بیرونی */
export function estimateRimPx(mask, w, h, box, split) {
  const ys = [box.cy, box.cy - box.h * 0.18, box.cy + box.h * 0.18].map((v) => Math.round(v));
  const runs = [];
  for (const y of ys) {
    if (y < 0 || y >= h) continue;
    let run = 0;
    for (let x = box.x0; x <= Math.min(w - 1, split); x++) {
      if (mask[y * w + x]) run++;
      else {
        if (run) runs.push(run);
        run = 0;
      }
    }
    if (run) runs.push(run);
    run = 0;
    for (let x = Math.max(0, split); x <= box.x1; x++) {
      if (mask[y * w + x]) run++;
      else {
        if (run) runs.push(run);
        run = 0;
      }
    }
    if (run) runs.push(run);
  }
  // نوارِ رینگ، کوتاه‌ترین بخشِ جوهرِ هر سطر است (نه تودهٔ عدسیِ تیره)
  runs.sort((a, b) => a - b);
  const short = runs[Math.floor(runs.length * 0.2)] || runs[0] || 3;
  return clamp(short, 2, Math.max(3, box.h * 0.22));
}

/** وقتی عدسی تیره/آینه‌ای است: هر نیمهٔ سایه‌ی بیرونی جدا و به اندازهٔ رینگ جمع می‌شود */
function silhouetteContours(mask, w, h, box, split, rimGuessPx) {
  const work = new Uint8Array(mask);
  for (const pixels of enclosedHoles(work, w, h)) fillHole(work, w, h, pixels);
  const outer = smooth(resample(traceContour(work, w, h, firstInk(work, w, h)), 240), 1);
  // دستهٔ عکس بیرونِ عدسی است؛ برای اینکه «سایهٔ بیرونیِ» دسته جزوِ عدسی نشود،
  // نقاطی که از مرکزِ فریم بیش از ۴۴٪ عرضِ کل دور شده‌اند کنار می‌گذاریم
  const reach = box.w * 0.44;
  const cxBox = box.cx;
  const lensOnly = outer.filter((p) => Math.abs(p.x - cxBox) <= reach);
  const trimmed = lensOnly.length >= 40 ? lensOnly : outer;
  // بلندترین بازهٔ پیوستهٔ نقاطِ یک سوی خطِ برش
  const side = (p) => (p.x > split ? 1 : -1);
  const run = (s) => {
    const n = trimmed.length;
    let bestStart = -1,
      bestLen = 0;
    // خط را از هر نقطه شروع کن و تا تغییر سو ادامه بده (چرخشی)
    for (let i = 0; i < n; i++) {
      if (side(trimmed[i]) !== s) continue;
      let len = 0;
      while (len < n && side(trimmed[(i + len) % n]) === s) len++;
      if (len > bestLen) {
        bestLen = len;
        bestStart = i;
      }
    }
    if (bestLen < 24) return null;
    return Array.from({ length: bestLen }, (_, k) => trimmed[(bestStart + k) % n]);
  };
  const inset = (pts) => {
    const st = contourStats(pts);
    return resample(
      pts.map((p) => {
        const dx = p.x - st.cx,
          dy = p.y - st.cy;
        const L = Math.hypot(dx, dy) || 1;
        return { x: p.x - (dx / L) * rimGuessPx, y: p.y - (dy / L) * rimGuessPx };
      }),
      128,
    );
  };
  const right = run(1),
    left = run(-1);
  if (!right || !left) return null;
  return { right: inset(right), left: inset(left), source: "silhouette", holes: 0 };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۵) حدسِ جنس/فینیش/رنگ/عدسی از پیکسل‌ها
 * ───────────────────────────────────────────────────────────────────────── */

const luma = (d, i) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

/** نمونه‌برداری از نوارِ رینگ (بین لبهٔ عدسی و لبهٔ بیرونیِ فریم) */
function rimPixels(data, w, h, mask, contour, cx, cy) {
  const out = [];
  for (const p of contour) {
    let dx = p.x - cx,
      dy = p.y - cy;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    for (let s = 1; s <= 24; s++) {
      const x = Math.round(p.x + dx * s),
        y = Math.round(p.y + dy * s);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (!mask[y * w + x]) break;
      out.push((y * w + x) * 4);
    }
  }
  return out;
}

/**
 * از روی عکس: رنگِ بدنه، فلزی یا استات، براق یا مات، و نوعِ عدسی.
 * @param {ImageData|{width,height,data}} imageData تصویرِ اصلی (قبل از چرخش اگر دادی)
 * @param {object} measured خروجیِ frameFromImage (برای جای حفره‌ها)
 */
export function estimateAppearance(imageData, measured) {
  const { width: w, height: h, data } = imageData;
  const out = { confidence: 0 };
  if (!measured?.ok) return out;
  const { mask, contour, cx, cy, lensContour } = measured;
  const rim = rimPixels(data, w, h, mask, contour, cx, cy);
  if (rim.length < 30) return out;
  const ch = (k) => {
    const v = rim.map((i) => data[i + k]).sort((a, b) => a - b);
    // میانهٔ ۶۰٪ روشن: سایهٔ محیط را حذف می‌کند ولی رنگِ واقعی را نگه می‌دارد
    return v[Math.floor(v.length * 0.55)];
  };
  const r = ch(0),
    g = ch(1),
    b = ch(2);
  const hex = "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const maxc = Math.max(r, g, b),
    minc = Math.min(r, g, b);
  const sat = maxc ? (maxc - minc) / maxc : 0;
  // پراکندگیِ روشنایی در نوارِ رینگ: فلز بازتابِ تیز دارد، استات پخشِ نرم
  const ls = rim.map((i) => luma(data, i));
  const lm = median(ls);
  const sortedL = [...ls].sort((x, y) => x - y);
  const p95 = sortedL[Math.floor(sortedL.length * 0.95)] || 0;
  const p05 = sortedL[Math.floor(sortedL.length * 0.05)] || 0;
  const contrast = p95 - p05;
  const peak = lm > 0.02 ? p95 / lm : 1;

  out.color = hex;
  out.luma = +lum.toFixed(3);
  out.saturation = +sat.toFixed(3);
  out.contrast = +contrast.toFixed(3);
  const rimMm = measured.rimW || 0;
  const metalLike = (rimMm > 0 && rimMm <= 2.8) || (contrast > 0.34 && sat < 0.24);
  out.material = metalLike ? "metal" : "acetate";
  out.finish = peak < 1.45 ? "matte" : peak > 2.1 && contrast < 0.5 ? "polished" : "satin";
  out.polish = +peak.toFixed(2);
  // شیشهٔ شفاف/رنگی: روشناییِ داخل حفره در برابر پس‌زمینه
  const inner = [];
  const lb = lensContour?.length ? boxOf(lensContour) : null;
  if (lb) {
    for (let y = Math.max(0, Math.round(lb.cy - lb.h * 0.3)); y <= Math.min(h - 1, Math.round(lb.cy + lb.h * 0.3)); y++)
      for (let x = Math.max(0, Math.round(lb.cx - lb.w * 0.3)); x <= Math.min(w - 1, Math.round(lb.cx + lb.w * 0.3)); x++)
        if (!mask[y * w + x]) inner.push((y * w + x) * 4);
  }
  if (inner.length > 20) {
    const lmIn = median(inner.map((i) => luma(data, i)));
    const satIn = satOf(data, inner);
    out.lensLuma = +lmIn.toFixed(3);
    if (lmIn < 0.16) out.lens = "photo";
    else if (lmIn < 0.42 && satIn > 0.18) out.lens = "mirror";
    else out.lens = "clear";
  } else if (lensContour?.length) {
    // عدسی تیره/آینه‌ای: داخلِ عدسی «جوهر» است، پس روشناییِ خودِ عدسی را می‌سنجیم
    const solid = [];
    for (let y = Math.round(lb.cy - lb.h * 0.3); y <= Math.round(lb.cy + lb.h * 0.3); y++)
      for (let x = Math.round(lb.cx - lb.w * 0.3); x <= Math.round(lb.cx + lb.w * 0.3); x++)
        if (y >= 0 && y < h && x >= 0 && x < w && mask[y * w + x]) solid.push((y * w + x) * 4);
    if (solid.length > 20) {
      const lmIn = median(solid.map((i) => luma(data, i)));
      out.lensLuma = +lmIn.toFixed(3);
      const satIn = satOf(data, solid);
      out.lens = lmIn < 0.22 ? "photo" : satIn < 0.16 ? "mirror" : "photo";
    } else out.lens = "clear";
  } else out.lens = "clear";
  out.confidence = Math.round(clamp(40 + contrast * 90 + (measured.match || 60) * 0.3, 35, 96));
  return out;
}

function satOf(data, idxs) {
  let s = 0;
  for (const i of idxs) {
    const maxc = Math.max(data[i], data[i + 1], data[i + 2]),
      minc = Math.min(data[i], data[i + 1], data[i + 2]);
    s += maxc ? (maxc - minc) / maxc : 0;
  }
  return s / Math.max(1, idxs.length);
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۶) عکسِ دوم: نمای جانبی ⇒ طول دسته
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * طول دسته از عکسِ نمای جانبی: نسبتِ طولِ دسته به ارتفاعِ عدسی در عکس جلو اندازه‌گیری می‌شود
 * (ارتفاعِ عدسی از سایزِ چاپی معلوم است) ⇒ خطای معمول ±۴ میلی‌متر.
 */
export function templeFromSidePhoto(imageData, { lensH = 42, mirror = false } = {}) {
  const w = imageData.width,
    h = imageData.height;
  let src = imageData;
  if (mirror) src = mirrorImageData(imageData);
  const { mask } = foregroundMask(w, h, src.data);
  const box = bboxOf(mask, w, h);
  if (!box || Math.max(box.w, box.h) < 20) return { ok: false, reason: "empty" };
  const work = new Uint8Array(mask);
  for (const pixels of enclosedHoles(work, w, h)) fillHole(work, w, h, pixels);
  const contour = smooth(resample(traceContour(work, w, h, firstInk(work, w, h)), 200), 1);
  const st = contourStats(contour);
  // در نمای جانبی، بازوی دسته بلندترین ضلع است و ارتفاعِ لنز ارتفاعِ تصویر
  const horizontal = box.w >= box.h;
  const armPx = horizontal ? box.w : box.h;
  const refPx = horizontal ? box.h : box.w;
  const aspect = armPx / Math.max(1, refPx);
  const templeLen = Math.round(clamp(aspect * lensH, 95, 160));
  // عکسِ درست، نسبتِ حدود ۲٫۸ تا ۴٫۲ دارد؛ خارج از آن یعنی عکسِ تاشده/چرخیده
  const plausible = aspect > 2.4 && aspect < 4.6 ? 30 : 0;
  return {
    ok: true,
    templeLen,
    armPx,
    refPx,
    aspect: +aspect.toFixed(2),
    centre: { x: st.cx, y: st.cy },
    confidence: Math.round(clamp(40 + plausible + Math.min(22, Math.max(box.w, box.h) / 8), 30, 92)),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  API اصلی
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * عکس → پارامترهای فریم (میلی‌متری).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @param {{lensW?:number,dbn?:number,templeLen?:number,rimW?:number,samples?:number,deskew?:boolean,mirror?:boolean,material?:string,finish?:string}} opts
 *        lensW/dbn را از چاپ روی دستهٔ عینک وارد کنید (مثلاً ۵۲□۱۸)؛ بدون آن ۵۲ فرض می‌شود.
 */
export function frameFromImage(imageData, opts = {}) {
  const w = imageData.width,
    h = imageData.height;
  const samples = opts.samples || 150;
  const lensWmm = opts.lensW || 52;

  // ۱) جداسازیِ فریم از پس‌زمینه
  const measure = (src) => {
    const seg = foregroundMask(src.width, src.height, src.data);
    const box = bboxOf(seg.mask, src.width, src.height);
    if (!box || box.w < 12 || box.h < 6) return null;
    return { seg, box, contours: lensContours(seg.mask, src.width, src.height, box) };
  };
  let src = imageData;
  let first = measure(src);
  if (!first) return { ok: false, reason: "empty" };

  // ۲) ترازکردن: زاویهٔ خطِ دو مرکزِ عدسی (عکسِ گوشی همیشه چند درجه کج است)
  let angle = 0;
  if (opts.deskew !== false && first.contours?.angle != null) {
    const a = first.contours.angle;
    if (Math.abs(a) < 25) angle = a;
  }
  if (Math.abs(angle) > 0.4) {
    const rotated = rotateImageData(src, angle, [...first.seg.bg, 255]);
    const again = measure(rotated);
    if (again?.contours) {
      src = rotated;
      first = again;
    }
  }
  if (opts.mirror) {
    const flipped = mirrorImageData(src);
    const again = measure(flipped);
    if (again) {
      src = flipped;
      first = again;
    }
  }
  const { seg, box } = first;
  const mask = seg.mask;
  const w2 = src.width,
    h2 = src.height;

  // ۳) حفرهٔ عدسی‌ها
  const split = bridgeSplit(mask, w2, h2, box);
  let found = first.contours;
  let right = found?.right,
    left = found?.left,
    source = found?.source || "rows";
  if (!right || !left) {
    // عدسیِ تیره/آینه‌ای: سوراخی در عکس نیست ⇒ از سایه‌ی بیرونی و ضخامتِ رینگ
    const sil = silhouetteContours(mask, w2, h2, box, split, estimateRimPx(mask, w2, h2, box, split));
    if (sil) {
      right = sil.right;
      left = sil.left;
      source = "silhouette";
    } else {
      // آخرین تلاش: اسکنِ سطری (همان الگوریتمِ نسخهٔ قبل)
      const R = traceLens(mask, w2, h2, split + 1, box.y0, box.x1, box.y1, samples);
      const L = traceLens(mask, w2, h2, box.x0, box.y0, split - 1, box.y1, samples);
      if (!R || !L) return { ok: false, reason: "lens-not-found" };
      right = resample(smooth(R.inner, 1), 128);
      left = resample(smooth(L.inner, 1), 128);
      source = "rows";
    }
  }
  const stR = contourStats(right),
    stL = contourStats(left);
  const bwR = boxOf(right),
    bwL = boxOf(left);
  // مقیاس: عرضِ چاپیِ عدسی مبنا است (میانگینِ دو عدسی تا خطای چرخش کم شود)
  const lensWPx = Math.max(4, (bwR.w * 2 + bwL.w * 2) / 2);
  let mmPerPx = lensWmm / lensWPx;
  let dbnMm = opts.dbn || 0;
  const gap = contourGap(right, left);
  const gapPx = Math.max(0.5, gap.dist);
  if (!dbnMm) dbnMm = +clamp(gapPx * mmPerPx, 9, 26).toFixed(1);
  else {
    // اگر DBL را می‌دانیم، از آن هم مقیاس می‌گیریم و دو تخمین را میانگین می‌کنیم
    const k2 = dbnMm / gapPx;
    if (k2 > 0.2 && k2 < 2) mmPerPx = (mmPerPx + k2) / 2;
  }

  const toMm = (pts, origin) =>
    orientCCW(
      smooth(resample(pts, Math.min(samples, 160)), 1).map((p) => ({
        x: +((p.x - origin.cx) * mmPerPx).toFixed(2),
        y: +((origin.cy - p.y) * mmPerPx).toFixed(2),
      })),
    );
  const pathR = toMm(right, stR);
  const pathL = toMm(left, stL);
  const sizeR = boxOf(pathR);
  const lensH = +sizeR.h.toFixed(1);

  // ۴) ضخامتِ رینگ از نوارِ واقعی (نه از حدس)
  const bandR = rimBand(mask, w2, h2, right, stR.cx, stR.cy);
  const rimW = +(opts.rimW || Math.max(1.6, Math.min(8.5, bandR.median * mmPerPx))).toFixed(1);
  const rimTopMm = +(bandR.top * mmPerPx).toFixed(1);
  const rimBottomMm = +(bandR.bottom * mmPerPx).toFixed(1);

  const totalWidth = +((box.x1 - box.x0 + 1) * mmPerPx).toFixed(1);
  // نامتقارنیِ دو عدسی (در پیکسل) ⇒ عکس از زاویه گرفته شده یا خطای جداسازی
  const asym = Math.abs(bwR.w - bwL.w) / Math.max(0.001, (bwR.w + bwL.w) / 2);
  const match = Math.round(
    clamp(
      100 -
        (seg.holes ? 0 : 14) -
        (source === "silhouette" ? 26 : source === "rows" ? 10 : 0) -
        asym * 60 -
        Math.abs(angle) * 0.8 -
        (1 - clamp((seg.coverage - 0.04) / 0.16, 0, 1)) * 6,
      12,
      99,
    ),
  );

  const result = {
    ok: true,
    lensPath: pathR,
    lensPathR: pathR,
    lensPathL: pathL,
    lensW: +(sizeR.w * 2).toFixed(1),
    lensH,
    dbn: dbnMm,
    rimW,
    rimTopMm,
    rimBottomMm,
    templeLen: opts.templeLen || 145,
    material: opts.material || "acetate",
    shape: "custom",
    totalWidth,
    match,
    deskewDeg: +angle.toFixed(2),
    mirrored: !!opts.mirror,
    source,
    symmetry: +(1 - asym).toFixed(3),
    notes: {
      mmPerPx: +mmPerPx.toFixed(3),
      mode: seg.mode,
      coverage: +seg.coverage.toFixed(3),
      holes: seg.holes,
      gapPx: +gapPx.toFixed(1),
      bridge: gap.a ? { x: +gap.a.x.toFixed(1), y: +gap.a.y.toFixed(1) } : null,
      box,
    },
  };
  // داده‌های داخلی برای estimateAppearance (به خروجی عمومی نشت نمی‌کنند)
  Object.defineProperty(result, "_pixels", {
    value: {
      imageData: src,
      mask,
      w: w2,
      h: h2,
      contour: right,
      lensContour: right,
      leftContour: left,
      cx: stR.cx,
      cy: stR.cy,
      box,
      split,
    },
    enumerable: false,
    configurable: true,
  });
  return result;
}

/** داده‌های ترسیم برای پیش‌نمایشِ استودیو: عکسِ پردازش‌شده + خطِ دو عدسی بر حسب پیکسل */
export function traceOverlay(result) {
  const p = result && result._pixels;
  if (!p || !p.lensContour) return null;
  return { imageData: p.imageData, right: p.lensContour, left: p.leftContour, box: p.box, split: p.split };
}

/** حدسِ شکلِ پایه از روی خطِ دنبالی‌شده (برای انتخاب preset اولیهٔ استودیو) */
export function guessShape(path) {
  const b = boxOf(path);
  const ar = b.h / Math.max(0.001, b.w * 2);
  let top = 0,
    bottom = 0,
    topW = 0,
    botW = 0,
    right = 0,
    left = 0;
  for (const p of path) {
    if (p.y < 0) {
      top++;
      topW = Math.max(topW, Math.abs(p.x));
    } else {
      bottom++;
      botW = Math.max(botW, Math.abs(p.x));
    }
    if (p.x > 0) right = Math.max(right, p.x);
    else left = Math.max(left, -p.x);
  }
  const asym = right / Math.max(0.001, left);
  if (ar > 0.98 && asym < 1.02) return "round";
  if (asym > 1.09) return ar > 0.95 ? "aviator" : "cateye";
  if (ar < 0.72) return "rectangle";
  if (ar > 0.92 && asym > 1.04) return "butterfly";
  const squareness = (top + bottom) / path.length;
  return ar > 0.86 ? (squareness > 0.999 ? "square" : "panto") : botW > topW * 1.06 ? "panto" : "square";
}

/** رنگِ خامِ نمونه‌شده از عکس، به‌علاوهٔ فینیش/متریالِ پیشنهادی */
export function appearanceOf(result) {
  const px = result && result._pixels;
  if (!px) return { confidence: 0 };
  return estimateAppearance({ width: px.w, height: px.h, data: px.imageData.data }, { ...result, ...px, contour: px.contour });
}
