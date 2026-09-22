/**
 * shapes.js — تولیدکنندهٔ هندسی دور لنز (lens outline)
 *
 * همه‌چیز بر حسب میلی‌متر و در صفحهٔ XY است، مرکز در (0,0).
 * یک منحنی پایهٔ ابربیضی (Lamé curve) داریم و با تغییر شکل‌دهنده‌ها
 * (cat-eye، تِردراپ، خط صاف بالا، برش بینی…) به شکل‌های واقعی عینک می‌رسیم.
 * همین پارامترها اسلایدرهای «استودیوی فریم» هستند؛ پس هر فریم جدید بدون
 * Blender فقط با چند عدد ساخته می‌شود.
 */

export const SHAPE_KEYS = [
  "round",
  "oval",
  "panto",
  "square",
  "rectangle",
  "cateye",
  "aviator",
  "browline",
  "geometric",
  "hexagon",
  "octagon",
  "shield",
  "butterfly",
  "triangle",
  "roundmetal",
  "oversize",
];

/** تنظیمات پایه برای هر شکل شناخته‌شده. */
export const SHAPE_PRESETS = {
  round: { exp: 2.0, depth: 0.97, corner: 0 },
  roundmetal: { exp: 2.0, depth: 0.99, corner: 0, nasalNotch: 0.12 },
  oval: { exp: 2.0, depth: 0.74, corner: 0 },
  panto: { exp: 2.6, depth: 0.95, topFlatten: 0.12, bottomShift: 0.05 },
  square: { exp: 5.0, depth: 0.9, corner: 0.16 },
  rectangle: { exp: 7.0, depth: 0.6, corner: 0.22 },
  cateye: {
    exp: 3.1,
    depth: 0.82,
    catAmp: 0.4,
    catWidth: 0.38,
    topFlatten: 0.08,
    corner: 0.1,
  },
  butterfly: {
    exp: 3.0,
    depth: 0.86,
    catAmp: 0.5,
    catWidth: 0.5,
    teardrop: 0.16,
    corner: 0.1,
  },
  aviator: {
    exp: 3.3,
    depth: 0.98,
    teardrop: 0.36,
    topWide: 1.12,
    bottomNarrow: 0.16,
    nasalNotch: 0.2,
    corner: 0.08,
  },
  browline: { exp: 3.4, depth: 0.88, topFlatten: 0.16, corner: 0.12, browLift: 0.06 },
  geometric: { exp: 4.2, depth: 0.86, corner: 0.05, topWide: 1.04, jawCut: 0.12 },
  hexagon: { exp: 9.0, depth: 0.92, corner: 0.0, hexBlend: 0.55 },
  octagon: { exp: 9.0, depth: 0.95, corner: 0.0, hexBlend: 0.34, hexSides: 8 },
  shield: { exp: 2.7, depth: 0.66, corner: 0.28, topWide: 1.05, bottomShift: -0.03 },
  triangle: { exp: 2.5, depth: 0.86, corner: 0.1, apex: 0.32, topFlatten: 0.1 },
  oversize: { exp: 2.9, depth: 0.99, corner: 0.14, topWide: 1.03 },
};

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** ابربیضی: n=2 بیضی، n بزرگ‌تر → مستطیل. */
function lame(theta, exp) {
  const c = Math.cos(theta),
    s = Math.sin(theta),
    p = 2 / exp;
  return [Math.sign(c) * Math.abs(c) ** p, Math.sign(s) * Math.abs(s) ** p];
}

/** چندضلعی منتظم با گوشهٔ نرم (برای شش‌ضلعی/هشت‌ضلعی). */
function polygon(theta, sides, corner) {
  const seg = TAU / sides;
  const a = ((theta % seg) + seg) % seg - seg / 2;
  const r = Math.cos(seg / 2) / Math.cos(a);
  const blend = clamp(corner, 0, 1);
  const rounded = (1 - blend) * r + blend * 1.0;
  return [Math.cos(theta) * rounded, Math.sin(theta) * rounded];
}

/**
 * خط دور لنز.
 * @param {object} spec  { shape, lensW, lensH, ...تغییر شکل‌دهنده‌ها }
 * @param {number} side  +1 = لنز راست (از دید بیننده)، -1 = چپ
 * @param {number} samples
 * @returns {Array<{x:number,y:number}>} نقاط بسته، در میلی‌متر
 */
export function lensOutline(spec, side = 1, samples = 220) {
  const p = { ...SHAPE_PRESETS[spec.shape || "square"], ...spec };
  const w = (p.lensW || 51) / 2;
  const h = (p.lensH || (p.lensW || 51) * (p.depth || 0.88)) / 2;
  const exp = clamp(p.exp || 3, 1.6, 14);
  const pts = new Array(samples);

  for (let i = 0; i < samples; i++) {
    // از نیم‌رخ سمت بیرونی شروع کن تا قرینگیِ عددی حفظ شود
    const th = (i / samples) * TAU;
    let [bx, by] = p.hexBlend ? polygon(th, p.hexSides || 6, 1 - p.hexBlend) : lame(th, exp);

    if (p.hexBlend) {
      const [ex, ey] = lame(th, 2.2);
      bx = bx * (1 - p.hexBlend) + ex * p.hexBlend;
      by = by * (1 - p.hexBlend) + ey * p.hexBlend;
    }

    let x = bx * w;
    let y = by * h;

    // x>0 = سمت شقیقه (بیرون)، x<0 = سمت بینی
    const out = clamp(x / w, -1, 1); // ۱ بیرون، ۱- داخل
    const up = clamp(y / h, -1, 1);

    if (p.topWide) x *= 1 + (p.topWide - 1) * 0; // placeholder, applied below on width
    if (p.topWide) y *= 1;

    // پهن‌تر بودن بالای فریم (خلبانی/گربه‌ای)
    if (p.topWide) {
      const k = smoothstep(-0.2, 1, up);
      x *= 1 + (p.topWide - 1) * k * 2;
    }

    // صاف کردن خط ابرو
    if (p.topFlatten && y > 0) y *= 1 - p.topFlatten * smoothstep(0.1, 1, up);
    if (p.browLift && y > 0) y += p.browLift * h * smoothstep(0.2, 1, up) * clamp(out, 0, 1);

    // شاخهٔ گربه‌ای: گوشهٔ بیرونی بالا کشیده می‌شود
    if (p.catAmp) {
      const cx = smoothstep(1 - (p.catWidth || 0.5), 1, out);
      const cy = smoothstep(0.15, 1, up);
      const k = cx * cy;
      y += p.catAmp * h * k;
      x += p.catAmp * 0.42 * w * k;
    }

    // تِردراپ / اشک خلبانی: پایین لنز باریک و کشیده می‌شود
    if (p.teardrop) {
      const down = smoothstep(-0.1, -1, up);
      x *= 1 - p.teardrop * down * 0.55 * clamp(out + 0.4, 0, 1);
      y *= 1 + p.teardrop * 0.35 * down;
    }

    // برش بینی: داخل و پایین لنز تو‌رفتگی دارد
    if (p.nasalNotch) {
      const inn = smoothstep(0.1, 1, -out);
      const low = smoothstep(0.1, 1, -up);
      const k = inn * low;
      x += p.nasalNotch * w * 0.42 * k;
      y += p.nasalNotch * h * 0.5 * k;
    }

    // باریک‌تر شدن پایین فریم (خلبانی/گربه‌ای)
    if (p.bottomNarrow) {
      const down = smoothstep(0.1, -1, up);
      x *= 1 - p.bottomNarrow * down * 0.6;
    }

    // فکِ بریده (هندسی)
    if (p.jawCut) {
      const down = smoothstep(-0.15, -1, up);
      x *= 1 - p.jawCut * down * clamp(-out + 0.3, 0, 1);
    }

    // رأس مثلثی
    if (p.apex) {
      const k = smoothstep(0.4, 1, up);
      x *= 1 - p.apex * k * 0.5;
      y *= 1 + p.apex * 0.4 * k;
    }

    // لغزش عمودی (پایین‌تر بودن مرکز لنز)
    if (p.bottomShift) y -= p.bottomShift * h;

    // شیب/چرخش فریم (pantoscopic) در خودِ هندسه نمی‌آید؛ بیرون اعمال می‌شود
    const tilt = (p.lensTiltDeg || 0) * (Math.PI / 180);
    if (tilt) {
      const c = Math.cos(tilt),
        s = Math.sin(tilt);
      const tx = x * c - y * s;
      y = x * s + y * c;
      x = tx;
    }

    pts[i] = { x: x * side, y };
  }
  return pts;
}

/** محاسبهٔ ارتفاع واقعی از روی نقاط (برای نرمال‌سازی). */
export function outlineBounds(pts) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/** داخلِ منحنی به اندازهٔ offset (برای لبهٔ داخلی فریم). */
export function offsetOutline(pts, offset) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n],
      next = pts[(i + 1) % n];
    const tx = next.x - prev.x,
      ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    // نرمال داخلی (سمت مرکز برای منحنی جهت‌دار پادساعتگرد)
    let nx = -ty / len,
      ny = tx / len;
    const cx = -pts[i].x,
      cy = -pts[i].y;
    if (nx * cx + ny * cy < 0) {
      nx = -nx;
      ny = -ny;
    }
    out[i] = { x: pts[i].x + nx * offset, y: pts[i].y + ny * offset };
  }
  return smoothPts(out, 2);
}

/** هموارسازی سبک با میانگین‌گیری سه‌تایی (لبه‌های صیقلی استات). */
export function smoothPts(pts, iterations = 1) {
  let a = pts;
  for (let k = 0; k < iterations; k++) {
    const n = a.length,
      out = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = a[(i - 1 + n) % n],
        c = a[i],
        q = a[(i + 1) % n];
      out[i] = { x: p.x * 0.25 + c.x * 0.5 + q.x * 0.25, y: p.y * 0.25 + c.y * 0.5 + q.y * 0.25 };
    }
    a = out;
  }
  return a;
}

/** بازتوزیع نقاط روی منحنی با گام یکنواخت (برای سواِپِ یکنواخت پروفیل). */
export function resample(pts, count, closed = true) {
  const src = closed ? [...pts, pts[0]] : pts;
  const seg = [];
  let total = 0;
  for (let i = 1; i < src.length; i++) {
    const d = Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
    seg.push(d);
    total += d;
  }
  const out = new Array(closed ? count : count);
  const step = total / (closed ? count : count - 1);
  let si = 0,
    acc = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (si < seg.length - 1 && acc + seg[si] < target) {
      acc += seg[si];
      si++;
    }
    const t = seg[si] ? (target - acc) / seg[si] : 0;
    const a = src[si],
      b = src[Math.min(si + 1, src.length - 1)];
    out[i] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return out;
}
