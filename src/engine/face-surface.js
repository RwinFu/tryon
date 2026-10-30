/**
 * face-surface.js — پرس‌وجوی سطحِ صورت روی مشِ رسمیِ MediaPipe
 *
 * برای «نشستنِ درست» باید بدانیم پوستِ واقعی کجاست، نه فقط چند لندمارک.
 * این ماژول ۸۹۸ مثلثِ توپولوژیِ FaceMesh را در فضایِ کانونیک (mm) نگه می‌دارد و
 * با فهرستِ مکانی، برای هر نقطهٔ (x,y) جلوترین z پوست و برای هر ارتفاع، پهنای
 * خطِ رخ را برمی‌گرداند. همان چیزی که برای سنجشِ هزاران نقطهٔ فریم لازم است.
 */

import { CANONICAL_MM, FACE_TRIS } from "./face-topology.js";

const N = CANONICAL_MM.length / 3;
const CELL = 12; // mm
const grid = new Map();
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

for (let i = 0; i < N; i++) {
  const x = CANONICAL_MM[i * 3], y = CANONICAL_MM[i * 3 + 1];
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
export const FACE_BOUNDS = { minX, maxX, minY, maxY };

const key = (cx, cy) => cx * 4096 + cy;

for (let t = 0; t < FACE_TRIS.length; t += 3) {
  const a = FACE_TRIS[t], b = FACE_TRIS[t + 1], c = FACE_TRIS[t + 2];
  const xs = [CANONICAL_MM[a * 3], CANONICAL_MM[b * 3], CANONICAL_MM[c * 3]];
  const ys = [CANONICAL_MM[a * 3 + 1], CANONICAL_MM[b * 3 + 1], CANONICAL_MM[c * 3 + 1]];
  const cx0 = Math.floor(Math.min(...xs) / CELL), cx1 = Math.floor(Math.max(...xs) / CELL);
  const cy0 = Math.floor(Math.min(...ys) / CELL), cy1 = Math.floor(Math.max(...ys) / CELL);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const k = key(cx, cy);
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(t / 3);
    }
  }
}

/**
 * جلوترین z پوست در نقطهٔ (x,y) فضایِ کانونیک (mm). NaN اگر بیرون از صورت باشد.
 * @returns {number}
 */
export function surfaceZ(x, y) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  let best = NaN;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(key(cx + dx, cy + dy));
      if (!arr) continue;
      for (const tri of arr) {
        const ia = FACE_TRIS[tri * 3], ib = FACE_TRIS[tri * 3 + 1], ic = FACE_TRIS[tri * 3 + 2];
        const ax = CANONICAL_MM[ia * 3], ay = CANONICAL_MM[ia * 3 + 1], az = CANONICAL_MM[ia * 3 + 2];
        const bx = CANONICAL_MM[ib * 3], by = CANONICAL_MM[ib * 3 + 1], bz = CANONICAL_MM[ib * 3 + 2];
        const ccx = CANONICAL_MM[ic * 3], ccy = CANONICAL_MM[ic * 3 + 1], ccz = CANONICAL_MM[ic * 3 + 2];
        const den = (by - ccy) * (ax - ccx) + (ccx - bx) * (ay - ccy);
        if (Math.abs(den) < 1e-9) continue;
        const w1 = ((by - ccy) * (x - ccx) + (ccx - bx) * (y - ccy)) / den;
        const w2 = ((ccy - ay) * (x - ccx) + (ax - ccx) * (y - ccy)) / den;
        const w3 = 1 - w1 - w2;
        // لبه‌ها را کمی باز می‌گذاریم تا شکافِ باریکِ بین مثلث‌ها نقطه را NaN نکند
        if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
        const z = w1 * az + w2 * bz + w3 * ccz;
        if (Number.isNaN(best) || z > best) best = z;
      }
    }
  }
  return best;
}

/** نصفِ پهنای خطِ رخ در ارتفاع y (mm) — برای سنجشِ فاصلهٔ دسته از گونه */
export function silhouetteHalfWidth(y) {
  let best = 0;
  for (let i = 0; i < N; i++) {
    const py = CANONICAL_MM[i * 3 + 1];
    if (Math.abs(py - y) > 3) continue;
    const x = Math.abs(CANONICAL_MM[i * 3]);
    if (x > best) best = x;
  }
  return best;
}

/**
 * پروفایلِ بینی در صفحهٔ میانی: برای هر y، جلوترین z (که با |x| کوچک‌تر از ۱۴mm
 * به‌دست می‌آید). برای نشستنِ پل و بالشتک‌ها به‌کار می‌رود.
 */
export function noseProfile(samples = 24) {
  const out = [];
  const y0 = -12, y1 = 40;
  for (let i = 0; i < samples; i++) {
    const y = y0 + ((y1 - y0) * i) / (samples - 1);
    let z = NaN;
    for (const x of [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10, 12, -12]) {
      const s = surfaceZ(x, y);
      if (!Number.isNaN(s) && (Number.isNaN(z) || s > z)) z = s;
    }
    if (!Number.isNaN(z)) out.push({ y, z });
  }
  return out;
}

/**
 * «زینِ بینی»: نقطه‌ای روی پلِ بینی که پلِ فریم باید رویش بنشیند.
 * با کمینهٔ z در بازهٔ بالای بینی (بینِ گوشهٔ داخلیِ چشم و پایین‌تر) پیدا می‌شود.
 */
export function noseSaddle() {
  let best = { y: 24, z: -Infinity };
  for (let y = 14; y <= 34; y += 1) {
    const z = surfaceZ(0, y);
    if (Number.isNaN(z)) continue;
    // زین = کم‌ترین ز (عقب‌ترین نقطه) در بالای پل
    if (z < best.z || best.z === -Infinity) best = { y, z };
  }
  return best;
}

/** جمعِ بافت: `surfaceZ` برای آرایه‌ای از نقاط (x,y) — برای دسته‌های تست */
export function surfaceSamples(points) {
  return points.map(([x, y]) => ({ x, y, z: surfaceZ(x, y) }));
}

/**
 * پهنای «گیرهٔ بینی» در بازهٔ ارتفاع [y0,y1]: بیشترین فاصلهٔ دو کنارهٔ بینی در
 * جایی که سطح هنوز نزدیک به جلوترین نقطهٔ همان بازه است. برای مقایسه با
 * فاصلهٔ بینیِ فریم (dbn) به‌کار می‌رود.
 */
export function noseGripWidth(y0, y1, band = 3) {
  let zMax = -Infinity;
  for (let y = y0; y <= y1; y += 1) {
    const z = surfaceZ(0, y);
    if (!Number.isNaN(z) && z > zMax) zMax = z;
  }
  if (!Number.isFinite(zMax)) return 0;
  let half = 0;
  for (let y = y0; y <= y1; y += 0.75) {
    for (let x = 0; x <= 26; x += 0.5) {
      const z = surfaceZ(x, y);
      if (Number.isNaN(z)) break;
      if (z >= zMax - band && x > half) half = x;
    }
  }
  return half * 2;
}
