/**
 * matte.js — «مات‌گیری»: حذف پس‌زمینه و تمیزکاریِ برش برای عکس‌های قطعه
 *
 * چرا جدا از photogram.js؟ چون آن‌جا ماسک فقط برای *اندازه‌گیری* است (ماسکِ سخت،
 * سیاه‌وسفید). اینجا خروجی قرار است *روی مدل سه‌بعدی بنشیند*، پس باید:
 *   • لبهٔ نرم (آلفای ضدِپله) داشته باشد؛
 *   • هالهٔ رنگِ پس‌زمینه از دورِ قطعه پاک شود (decontamination)؛
 *   • سایهٔ ملایمِ روی میز/کاغذ حذف شود (و نه خودِ فریمِ مشکی)؛
 *   • خرده‌نویزها (parts جداشده) حذف شوند؛
 *   • سوراخ‌های ریز پر شوند اما **داخلِ عدسی باز بماند** (عدسی شفاف است)؛
 *   • برش در جعبهٔ تنگ با حاشیهٔ یکسان برگردد تا مقیاس حفظ شود.
 *
 * همه‌چیز روی ImageData خام است ⇒ در Node هم تست‌شدنی، بدون DOM و بدون وابستگی.
 *
 * ورودی/خروجی‌ی اصلی: {@link cutout}
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** آیا تصویر آلفای واقعی دارد (PNG شفاف)؟ */
export function hasAlpha(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true;
  return false;
}

/** میانگینِ رنگِ حاشیه (مرجعِ پس‌زمینه) — میانگینِ ساده، چون حاشیه معمولاً یکدست است */
export function borderColor(rgba, w, h, inset = 2) {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const take = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    r += rgba[p];
    g += rgba[p + 1];
    b += rgba[p + 2];
    n++;
  };
  for (let d = 0; d < inset; d++) {
    for (let x = 0; x < w; x += 2) {
      take(x, d);
      take(x, h - 1 - d);
    }
    for (let y = 0; y < h; y += 2) {
      take(d, y);
      take(w - 1 - d, y);
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [255, 255, 255];
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۱) مؤلفه‌های همبند (برای حذفِ خرده‌نویز و نگه‌داشتنِ قطعهٔ اصلی)
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * برچسب‌گذاریِ مؤلفه‌های همبندِ ماسک (۴ همسایه).
 * @returns {{labels:Int32Array, stats:Array<{area:number,x0:number,y0:number,x1:number,y1:number,cx:number,cy:number,touch:number}>, count:number}}
 */
export function components(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const stats = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = stats.length;
    const st = { area: 0, x0: w, y0: h, x1: -1, y1: -1, cx: 0, cy: 0, touch: 0 };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const i = stack[--sp];
      const x = i % w,
        y = (i / w) | 0;
      st.area++;
      st.cx += x;
      st.cy += y;
      if (x < st.x0) st.x0 = x;
      if (y < st.y0) st.y0 = y;
      if (x > st.x1) st.x1 = x;
      if (y > st.y1) st.y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) st.touch++;
      if (x > 0 && mask[i - 1] && labels[i - 1] < 0) (labels[i - 1] = id), (stack[sp++] = i - 1);
      if (x < w - 1 && mask[i + 1] && labels[i + 1] < 0) (labels[i + 1] = id), (stack[sp++] = i + 1);
      if (y > 0 && mask[i - w] && labels[i - w] < 0) (labels[i - w] = id), (stack[sp++] = i - w);
      if (y < h - 1 && mask[i + w] && labels[i + w] < 0) (labels[i + w] = id), (stack[sp++] = i + w);
    }
    if (st.area) {
      st.cx /= st.area;
      st.cy /= st.area;
    }
    stats.push(st);
  }
  return { labels, stats, count: stats.length };
}

/**
 * فقط قطعه‌های معتبر را نگه می‌دارد:
 *   • بزرگ‌ترین مؤلفه همیشه می‌ماند؛
 *   • مؤلفه‌های دیگر اگر دست‌کم minRatio از بزرگ‌ترین باشند و در محدودهٔ کشیده‌شدهٔ
 *     آن بیفتند (مثلاً دسته‌ای که در عکس از فریم جدا افتاده) هم می‌مانند.
 * @param {{pieces?:number,minRatio?:number,minArea?:number,reach?:number}} opts
 */
export function keepSubject(mask, w, h, opts = {}) {
  const { pieces = 2, minRatio = 0.04, minArea = 24, reach = 0.12 } = opts;
  const { labels, stats } = components(mask, w, h);
  if (!stats.length) return { mask, kept: 0, stats };
  const order = [...stats].sort((a, b) => b.area - a.area);
  const main = order[0];
  const padX = Math.max(8, (main.x1 - main.x0) * reach);
  const padY = Math.max(8, (main.y1 - main.y0) * reach);
  const keep = new Set([stats.indexOf(main)]);
  for (const st of order.slice(1)) {
    if (keep.size >= pieces) break;
    if (st.area < minArea || st.area < main.area * minRatio) continue;
    const inside =
      st.x1 >= main.x0 - padX && st.x0 <= main.x1 + padX && st.y1 >= main.y0 - padY && st.y0 <= main.y1 + padY;
    if (inside) keep.add(stats.indexOf(st));
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (mask[i] && keep.has(labels[i])) out[i] = 1;
  const keptArea = [...keep].reduce((a, id) => a + stats[id].area, 0);
  return { mask: out, kept: keep.size, area: keptArea, stats, dropped: stats.length - keep.size };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۲) ریخت‌شناسی و سوراخ‌ها
 * ───────────────────────────────────────────────────────────────────────── */

function morph(mask, w, h, r, mode) {
  if (r <= 0) return mask;
  const src = new Uint8Array(mask);
  const out = new Uint8Array(mask.length);
  const R = Math.ceil(r);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R),
      y1 = Math.min(h - 1, y + R);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R),
        x1 = Math.min(w - 1, x + R);
      let hit = 0;
      for (let yy = y0; yy <= y1 && !hit; yy++) {
        const dy = yy - y,
          row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x;
          if (dx * dx + dy * dy > r * r + 0.25) continue;
          const v = src[row + xx];
          if (mode === "dilate" ? v : !v) {
            hit = 1;
            break;
          }
        }
      }
      out[y * w + x] = mode === "dilate" ? hit : hit ? 0 : src[y * w + x];
    }
  }
  return out;
}

export const dilate = (mask, w, h, r = 1) => morph(mask, w, h, r, "dilate");
export const erode = (mask, w, h, r = 1) => morph(mask, w, h, r, "erode");
/** بستن (دیلاته←ادغامِ ریزه←سپس فرسایش): ترک‌های ریزِ داخل قطعه را می‌بندد */
export function closeMask2(mask, w, h, r = 1) {
  return erode(dilate(mask, w, h, r), w, h, r);
}

/** نواحیِ خالیِ بسته (که به لبه وصل نیستند) — کاندیدای سوراخ */
export function holesOf(mask, w, h) {
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
    if (!touches) out.push(pixels);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/**
 * پرکردنِ سوراخ‌های **ریز** (نویزِ جداسازی، بازتاب روی فریم) و بازگذاشتنِ سوراخ‌های بزرگ
 * (داخلِ عدسی که در عکس شفاف است و باید شفاف بماند).
 * @param {number} maxPx بیشینهٔ مساحتِ سوراخ برای پرشدن
 * @param {number} maxRatio نسبت به مساحتِ خودِ قطعه
 */
export function fillSmallHoles(mask, w, h, { maxPx = 900, maxRatio = 0.02 } = {}) {
  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  const limit = Math.max(12, Math.min(maxPx, area * maxRatio));
  const holes = holesOf(mask, w, h);
  let filled = 0;
  for (const px of holes) {
    if (px.length > limit) break; // همهٔ سوراخ‌ها از بزرگ به کوچک مرتب‌اند
    for (const i of px) mask[i] = 1;
    filled++;
  }
  return { mask, filled, kept: holes.length - filled, limit };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۳) آلفای نرم: فاصلهٔ علامت‌دار تا لبه (تقریبِ چمفر، دو پاس)
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * تبدیلِ فاصلهٔ چمفر (دو پاس، همسایگیِ ۳×۳) از مجموعه‌ای از پیکسل‌های مبدأ.
 * @param {Uint8Array} seeds مبدأها (فاصله = ۰)
 */
function distanceFrom(seeds, w, h) {
  const INF = 1e6;
  const D1 = 1,
    D2 = Math.SQRT2;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = seeds[i] ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + D1);
      if (y > 0) d[i] = Math.min(d[i], d[i - w] + D1);
      if (x > 0 && y > 0) d[i] = Math.min(d[i], d[i - w - 1] + D2);
      if (x < w - 1 && y > 0) d[i] = Math.min(d[i], d[i - w + 1] + D2);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      if (x < w - 1) d[i] = Math.min(d[i], d[i + 1] + D1);
      if (y < h - 1) d[i] = Math.min(d[i], d[i + w] + D1);
      if (x < w - 1 && y < h - 1) d[i] = Math.min(d[i], d[i + w + 1] + D2);
      if (x > 0 && y < h - 1) d[i] = Math.min(d[i], d[i + w - 1] + D2);
    }
  return d;
}

/**
 * فاصلهٔ علامت‌دار تا لبه: داخلِ قطعه مثبت، بیرون (از جمله داخلِ حفرهٔ عدسی) منفی.
 * دو تبدیلِ فاصلهٔ جداگانه می‌گیریم تا داخلِ سوراخِ عدسی هم درست منفی شود.
 */
export function signedDistance(mask, w, h) {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const inD = distanceFrom(inv, w, h); // فاصلهٔ هر پیکسلِ قطعه تا نزدیک‌ترین پس‌زمینه
  const outD = distanceFrom(mask, w, h); // فاصلهٔ هر پیکسلِ پس‌زمینه تا نزدیک‌ترین قطعه
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? inD[i] : -outD[i];
  return out;
}

/**
 * آلفای نرم از ماسک سخت.
 * @param {number} feather پهنای ناحیهٔ نیمه‌شفاف (پیکسل)
 * @param {number} core حاشیهٔ کاملاً کدر (پیکسل) — با آن لبه یک پیکسل تیزتر می‌شود
 */
export function softAlpha(mask, w, h, { feather = 1.6, core = 0.35 } = {}) {
  const sd = signedDistance(mask, w, h);
  const a = new Float32Array(w * h);
  for (let i = 0; i < sd.length; i++) a[i] = clamp((sd[i] + feather / 2 + core) / feather, 0, 1);
  return a;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۴) پاک‌سازیِ رنگ: سایه و هالهٔ پس‌زمینه
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * سرکوبِ سایه: فقط پیکسل‌هایی که (الف) نزدیکِ لبه باشند، (ب) رنگشان همان رنگِ
 * پس‌زمینه باشد و فقط تیره‌تر شده باشد. فریمِ مشکیِ واقعی تیره‌تر از حد است و
 * در امان می‌ماند (k < shadowLo را سایه حساب نمی‌کنیم).
 */
export function suppressShadow(rgba, w, h, alpha, bg, { strength = 0.85, band = 7, lo = 0.42, hi = 0.96 } = {}) {
  const sd = signedDistance(
    Uint8Array.from(alpha, (v) => (v > 0.45 ? 1 : 0)),
    w,
    h,
  );
  const bgL = Math.max(12, lum(bg[0], bg[1], bg[2]));
  let cut = 0;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    if (alpha[i] <= 0.002) continue;
    if (sd[i] > band) continue; // فقط نوارِ لبه
    const r = rgba[p],
      g = rgba[p + 1],
      b = rgba[p + 2];
    const k = lum(r, g, b) / bgL;
    if (k < lo || k > hi) continue; // تیره‌تر از این یعنی خودِ قطعه است
    // شباهتِ فام: نسبتِ کانال‌ها باید شبیهِ پس‌زمینه باشد
    const d =
      Math.abs(r / Math.max(1, r + g + b) - bg[0] / Math.max(1, bg[0] + bg[1] + bg[2])) +
      Math.abs(g / Math.max(1, r + g + b) - bg[1] / Math.max(1, bg[0] + bg[1] + bg[2]));
    if (d > 0.09) continue;
    const s = (hi - k) / (hi - lo); // چقدر شبیه سایه است
    const next = alpha[i] * clamp(1 - s * strength * (1 - sd[i] / Math.max(1, band)), 0, 1);
    if (next < alpha[i]) cut += alpha[i] - next;
    alpha[i] = next;
  }
  return { alpha, removed: cut };
}

/**
 * رفعِ هاله (decontamination): رنگِ پیکسل‌های نیمه‌شفاف را از رنگِ پس‌زمینه می‌شوید:
 * C = (C - (1-α)·BG) / α . فقط روی لبه اعمال می‌شود تا داخلِ قطعه دست‌نخورده بماند.
 */
export function decontaminate(rgba, w, h, alpha, bg) {
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const a = alpha[i];
    if (a <= 0.02 || a >= 0.995) continue;
    const k = (1 - a) / a;
    rgba[p] = clamp(rgba[p] - bg[0] * k, 0, 255);
    rgba[p + 1] = clamp(rgba[p + 1] - bg[1] * k, 0, 255);
    rgba[p + 2] = clamp(rgba[p + 2] - bg[2] * k, 0, 255);
  }
  return rgba;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۵) برشِ تنگ
 * ───────────────────────────────────────────────────────────────────────── */

/** جعبهٔ تنگِ آلفا (با حاشیهٔ دلخواه، محدود به تصویر) */
export function alphaBox(alpha, w, h, { pad = 2, min = 0.02 } = {}) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < min) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** برشِ تصویر و آلفا در جعبه (خروجی RGBA با آلفای واقعی) */
export function cropTo(rgba, alpha, w, h, box) {
  const { x0, y0 } = box;
  const cw = box.w,
    ch = box.h;
  const out = new Uint8ClampedArray(cw * ch * 4);
  const aOut = new Float32Array(cw * ch);
  // رنگ‌ها پیش‌ضرب نمی‌شوند: three.js و PNG هر دو آلفای غیرِضرب‌شده می‌خواهند.
  for (let y = 0; y < ch; y++) {
    const src = ((y0 + y) * w + x0) * 4;
    const dst = y * cw * 4;
    for (let x = 0; x < cw; x++) {
      const s = src + x * 4,
        d = dst + x * 4;
      const av = clamp(alpha[(y0 + y) * w + x0 + x], 0, 1);
      out[d] = rgba[s];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2];
      out[d + 3] = Math.round(av * 255);
      aOut[y * cw + x] = av;
    }
  }
  return { image: { width: cw, height: ch, data: out }, alpha: aOut };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۶) API اصلی
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * عکسِ خام → برشِ تمیز (RGBA با آلفا) + گزارشِ تمیزکاری.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @param {{mask?:Uint8Array, bg?:number[], feather?:number, pad?:number, close?:number,
 *          shadow?:number|false, decontaminate?:boolean, pieces?:number,
 *          maxHolePx?:number, maxHoleRatio?:number, trim?:boolean}} opts
 *        mask  اگر ماسکِ آماده (از photogram) داری بده تا فقط تمیزکاری انجام شود.
 */
export function cutout(imageData, opts = {}) {
  const w = imageData.width,
    h = imageData.height;
  const rgba = imageData.data instanceof Uint8ClampedArray ? imageData.data : new Uint8ClampedArray(imageData.data);
  const bg = opts.bg || (hasAlpha(rgba) ? [255, 255, 255] : borderColor(rgba, w, h));
  const alphaChannel = hasAlpha(rgba);

  // ۱) ماسک: یا از ورودی، یا از آلفای PNG، یا با آستانهٔ رنگیِ ساده
  let mask = opts.mask;
  let mode = "given";
  if (!mask) {
    if (alphaChannel) {
      mask = new Uint8Array(w * h);
      for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = rgba[p] > 24 ? 1 : 0;
      mode = "alpha";
    } else {
      const d = new Float32Array(w * h);
      for (let i = 0, p = 0; i < d.length; i++, p += 4)
        d[i] =
          0.3 * Math.abs(rgba[p] - bg[0]) + 0.59 * Math.abs(rgba[p + 1] - bg[1]) + 0.11 * Math.abs(rgba[p + 2] - bg[2]);
      const t = opts.tolerance ?? autoTolerance(d);
      mask = new Uint8Array(w * h);
      for (let i = 0; i < d.length; i++) mask[i] = d[i] > t ? 1 : 0;
      mode = "color";
    }
  }

  // ۲) تمیزکاریِ ماسک: بستنِ ترک، حذفِ خرده‌نویز، پرکردنِ سوراخِ ریز
  if (opts.close !== 0) mask = closeMask2(mask, w, h, opts.close ?? 1);
  const kept = keepSubject(mask, w, h, { pieces: opts.pieces ?? 2 });
  mask = kept.mask;
  const { mask: filled, filled: holesFilled, kept: holesKept } = fillSmallHoles(mask, w, h, {
    maxPx: opts.maxHolePx ?? 900,
    maxRatio: opts.maxHoleRatio ?? 0.02,
  });
  mask = filled;

  // ۳) آلفای نرم
  let alpha = softAlpha(mask, w, h, { feather: opts.feather ?? 1.6, core: opts.core ?? 0.35 });

  // ۴) سایه و هاله
  const work = new Uint8ClampedArray(rgba); // رنگ را روی کپی اصلاح می‌کنیم
  let shadowRemoved = 0;
  if (opts.shadow !== false && !alphaChannel) {
    const r = suppressShadow(work, w, h, alpha, bg, { strength: opts.shadow ?? 0.85 });
    alpha = r.alpha;
    shadowRemoved = r.removed;
  }
  if (opts.decontaminate !== false && !alphaChannel) decontaminate(work, w, h, alpha, bg);

  // ۵) برشِ تنگ
  const box = alphaBox(alpha, w, h, { pad: opts.pad ?? 2 }) || { x0: 0, y0: 0, x1: w - 1, y1: h - 1, w, h };
  const { image, alpha: aOut } = cropTo(work, alpha, w, h, box);

  // ۶) امتیازِ اطمینان
  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  const coverage = area / (w * h);
  let touch = 0;
  for (let x = 0; x < w; x++) {
    if (mask[x]) touch++;
    if (mask[(h - 1) * w + x]) touch++;
  }
  for (let y = 0; y < h; y++) {
    if (mask[y * w]) touch++;
    if (mask[y * w + w - 1]) touch++;
  }
  const conf = Math.round(
    clamp(
      100 -
        (coverage < 0.01 ? 45 : coverage > 0.9 ? 40 : 0) -
        Math.min(30, (touch / Math.max(1, 2 * (w + h))) * 120) -
        kept.dropped * 4 -
        (holesKept > 4 ? 8 : 0),
      5,
      99,
    ),
  );

  return {
    image: { width: image.width, height: image.height, data: image.data },
    alpha: aOut,
    box,
    meta: {
      mode,
      bg,
      coverage: +coverage.toFixed(4),
      confidence: conf,
      pieces: kept.kept,
      dropped: kept.dropped,
      holesFilled,
      holesKept,
      borderTouch: +(touch / Math.max(1, 2 * (w + h))).toFixed(3),
      shadowRemoved: +shadowRemoved.toFixed(0),
      alphaChannel,
    },
  };
}

/**
 * آستانهٔ خودکار: دو سطحِ اُتسو روی فاصلهٔ رنگی، با کفِ ایمن برای پس‌زمینه‌های خیلی یکدست.
 */
export function autoTolerance(dist) {
  const bins = 64;
  const hist = new Float64Array(bins);
  let max = 1;
  for (let i = 0; i < dist.length; i++) if (dist[i] > max) max = dist[i];
  for (let i = 0; i < dist.length; i++) hist[Math.min(bins - 1, ((dist[i] / max) * (bins - 1)) | 0)]++;
  const total = dist.length;
  let sum = 0;
  for (let b = 0; b < bins; b++) sum += b * hist[b];
  let sumB = 0,
    wB = 0,
    best = 0,
    thr = 0;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += b * hist[b];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = b;
    }
  }
  const t = ((thr + 0.5) / (bins - 1)) * max;
  return clamp(t, 16, Math.max(20, max * 0.55));
}

/** برش را روی یک رنگِ زمینه می‌نشاند (پیش‌نمایشِ شطرنجی/ساده در UI) */
export function flatten(image, bg = [255, 255, 255]) {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < out.length; i += 4) {
    const a = image.data[i + 3] / 255;
    out[i] = image.data[i] * a + bg[0] * (1 - a);
    out[i + 1] = image.data[i + 1] * a + bg[1] * (1 - a);
    out[i + 2] = image.data[i + 2] * a + bg[2] * (1 - a);
    out[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/** آیا تصویر خالی است (هیچ پیکسلِ کدری ندارد)؟ */
export function isBlank(image, minArea = 16) {
  let n = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 24) n++;
  return n < minArea;
}
