/**
 * photogram.js — عکس محصول → خطِ لنز (جایگزین Blender)
 *
 * ورودی: ماسک «جوهر» تصویر (پیکسل‌هایی که پس‌زمینه نیستند).
 * روش: از مرکزِ هر ناحیهٔ لنز، در هر زاویه به بیرون حرکت می‌کنیم؛
 *  اولین پیکسل جوهر = لبهٔ داخلی فریم (پس خط واقعی عدسی)،
 *  آخرین پیکسل = لبهٔ بیرونی → ضخامت فریم (rimW) به‌دست می‌آید.
 * خروجی: lensPath (میلی‌متر) + lensW/lensH/dbn که مستقیم به موتور هندسه می‌رود.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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

/** ستونِ کم‌جمعیت نزدیک مرکز → خطِ برش بین دو لنز */
export function bridgeSplit(mask, w, h, box) {
  const col = new Int32Array(w);
  for (let y = box.y0; y <= box.y1; y++) for (let x = 0; x < w; x++) col[x] += mask[y * w + x];
  let best = box.cx,
    bestV = Infinity;
  const lo = Math.max(box.x0 + 3, box.cx - box.w * 0.14),
    hi = Math.min(box.x1 - 3, box.cx + box.w * 0.14);
  for (let x = lo; x <= hi; x++) {
    const v = col[x] + Math.abs(x - box.cx) * 0.08;
    if (v < bestV) {
      bestV = v;
      best = x;
    }
  }
  return Math.round(best);
}

/**
 * بیرون‌کاوی عدسی در یک ناحیه: برای هر سطر، ابتدا و انتهای «جوهر» و
 * طولانی‌ترین شکافِ خالیِ داخلش (حفرهٔ عدسی) را پیدا می‌کند. خطِ عدسی از
 * خودِ حفره ساخته می‌شود — پس کجی قاب، سایه و پل، مرکز را جابه‌جا نمی‌کند.
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
  // سطرهای غیرمتعارف (پل، سایه، لولا) با میانهٔ عرض حذف می‌شوند
  const widths = rows.map((r) => r.b - r.a).sort((m, n) => m - n);
  const med = widths[widths.length >> 1];
  const band = rows.filter((r) => r.b - r.a > med * 0.5 && r.b - r.a < med * 2.1);
  if (band.length < 10) return null;
  const yA = band[0].y,
    yB = band[band.length - 1].y;
  const holeL = Math.min(...band.map((r) => r.a)),
    holeR = Math.max(...band.map((r) => r.b));
  // ضخامت رینگ: فاصلهٔ لبهٔ عدسی تا لبهٔ بیرونی جوهر (سمت شقیقه معتبر است)
  const out = band
    .map((r) => Math.max(r.hi - r.b, r.a - r.lo))
    .sort((m, n) => m - n);
  const rimPx = Math.max(1.2, out[out.length >> 1]);
  const cx = (holeL + holeR) / 2,
    cy = (yA + yB) / 2;
  // خطِ بسته: لبهٔ راست از بالا به پایین، لبهٔ چپ از پایین به بالا
  const path = [];
  for (const r of band) path.push({ x: r.b, y: r.y });
  for (let i = band.length - 1; i >= 0; i--) path.push({ x: band[i].a, y: band[i].y });
  const inner = resample(uniform(band, cx), samples);
  const outer = inner.map((pt) => {
    const dx = pt.x - cx,
      dy = pt.y - cy;
    const L = Math.hypot(dx, dy) || 1;
    return { x: pt.x + (dx / L) * rimPx, y: pt.y + (dy / L) * rimPx };
  });
  void path;
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

/** لبه‌های چپ/راستِ حفره در سطرهای یکنواخت (هر ۱/۳ سطر) تا خط نرم بماند */
function uniform(band, cx) {
  const step = Math.max(1, Math.floor(band.length / 64));
  const pts = [];
  for (let i = 0; i < band.length; i += step) {
    const r = band[i];
    pts.push({ x: r.b, y: r.y });
  }
  for (let i = band.length - 1; i >= 0; i -= step) {
    const r = band[i];
    pts.push({ x: r.a, y: r.y });
  }
  void cx;
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

/** جهت چندضلعی را پادساعتگرد می‌کند (m m-space، y رو به بالا) */
function orientCCW(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? pts.slice().reverse() : pts;
}

/** هموارسازی خط و نرمال‌سازی جهت (پادساعتگرد) */
function tidy(pts, up = 1) {
  const n = pts.length;
  const sm = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n],
      b = pts[i],
      c = pts[(i + 1) % n];
    sm.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
  }
  let area = 0;
  for (let i = 0; i < sm.length; i++) {
    const a = sm[i],
      b = sm[(i + 1) % sm.length];
    area += a.x * b.y - b.x * a.y;
  }
  const out = area < 0 ? sm.slice().reverse() : sm;
  return out.map((p) => ({ x: p.x, y: up * (p.y) }));
}

/**
 * عکس → پارامترهای فریم.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @param {{lensW?:number,dbn?:number,templeLen?:number,rimW?:number,samples?:number}} opts
 *        lensW/… را از چاپ روی دستهٔ عینک وارد کنید (مثلاً 54□17)؛ اگر ندهید ۵۲ فرض می‌شود.
 */
export function frameFromImage(imageData, opts = {}) {
  const w = imageData.width,
    h = imageData.height;
  const data = imageData.data;
  const mask = inkMask(w, h, data);
  const box = bboxOf(mask, w, h);
  if (!box) return { ok: false, reason: "empty" };
  if (box.w < 8 || box.h < 4) return { ok: false, reason: "too-small" };
  const split = bridgeSplit(mask, w, h, box);
  const samples = opts.samples || 150;
  const R = traceLens(mask, w, h, split + 1, box.y0, box.x1, box.y1, samples);
  const L = traceLens(mask, w, h, box.x0, box.y0, split - 1, box.y1, samples);
  if (!R || !L) return { ok: false, reason: "lens-not-found" };
  // عدد چاپی روی دسته (۵۲□۱۸) = عرضِ خودِ عدسی، پس مقیاس از حفره گرفته می‌شود
  const lensWPx = (R.hole.w + L.hole.w) / 2;
  const lensWmm = opts.lensW || 52;
  const mmPerPx = lensWmm / Math.max(4, lensWPx);
  const gapPx = Math.max(2, R.hole.x0 - L.hole.x1); // فاصلهٔ لبه تا لبهٔ عدسی‌ها = عدد وسطِ چاپی
  const dbnMm = opts.dbn || +clamp(gapPx * mmPerPx, 10, 30).toFixed(1);
  // پیکسل (y رو به پایین) → میلی‌متر (y رو به بالا) و جهت پادساعتگرد
  const toMm = (pts, origin) =>
    orientCCW(
      tidy(pts, 1).map((p) => ({
        x: +((p.x - origin.cx) * mmPerPx).toFixed(2),
        y: +((origin.cy - p.y) * mmPerPx).toFixed(2),
      })),
    );
  const pathR = toMm(R.inner, R),
    pathL = toMm(L.inner, L);
  const sizeR = boxOf(pathR);
  const lensH = +sizeR.h.toFixed(1);
  const rimW = +(opts.rimW || Math.max(2.6, Math.min(7.4, R.rimPx * mmPerPx))).toFixed(1);
  return {
    ok: true,
    lensPath: pathR,
    lensPathR: pathR,
    lensPathL: pathL,
    lensW: +(sizeR.w * 2).toFixed(1),
    lensH,
    dbn: dbnMm,
    rimW,
    templeLen: opts.templeLen || 145,
    material: opts.material || "acetate",
    shape: "custom",
    totalWidth: +((box.x1 - box.x0 + 1) * mmPerPx).toFixed(1),
    match: Math.round(Math.min(R.coverage, L.coverage) * 100),
    notes: {
      mmPerPx: +mmPerPx.toFixed(3),
      rimPx: +R.rimPx.toFixed(1),
      holeW: +R.hole.w.toFixed(1),
      holeH: +R.hole.h.toFixed(1),
      split,
      box,
    },
  };
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
  return { w: (x1 - x0) / 2, h: y1 - y0, x0, x1, y0, y1 };
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
