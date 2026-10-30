/**
 * head-fit.js — برازشِ مدلِ رسمیِ صورتِ MediaPipe روی ۴۶۸ لندمارک
 *
 * چرا این ماژول؟
 *  - روشِ قبلی چرخش را از ماتریسِ MediaPipe یا از دو-سه نقطهٔ دستی برمی‌داشت و
 *    مقیاس را از PD/پهنای صورت حدس می‌زد. نتیجه: رولِ برعکس، پیچِ ساختگی،
 *    مقیاسِ ۶ تا ۱۸٪ خطا و «شنا کردنِ» عینک روی بینی.
 *  - اینجا همان کاری انجام می‌شود که اپتومتریست می‌کند: شکلِ رسمیِ صورت
 *    (canonical_face_model، ۴۶۸ رأس و ۸۹۸ مثلث) با همهٔ نقاطِ دیده‌شده جفت
 *    می‌شود؛ چرخشِ سه‌بعدی (yaw/pitch/roll)، مقیاسِ متریک و مرکز از دلِ همان
 *    جفت‌شدن می‌آید و یک مدلِ سه‌بعدیِ قابلِ اتکا برای نشستنِ عینک می‌سازد.
 *
 * چرا zِ MediaPipe مصرف نمی‌شود؟
 *  - zِ لندمارکِ MediaPipe نسبی و پرنویز است (اندازه‌گیری شد: خطای ۲۵px روی یک
 *    عکسِ ۵۱۲px). برازشِ سه‌بعدی با آن، پیچ/یاوِ ساختگی می‌سازد. اینجا عمق از
 *    خودِ مدلِ کانونیک می‌آید و سه زاویه با کمینه‌کردنِ خطای بازتصویرِ ۲بعدی
 *    (که دقیق است) پیدا می‌شوند — همان روشی که SDKهای مطرح استفاده می‌کنند.
 *
 * خروجی همیشه finite است؛ دادهٔ بد ⇒ `confidence` پایین، نه NaN.
 */

import { CANONICAL_MM, CANONICAL_METRICS, FACE_TRIS } from "./face-topology.js";

const N = 468;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** وزنِ هر لندمارک: نقاطِ استخوانیِ پایدار وزنِ بالا، نقاطِ حالت‌پذیر وزنِ کم */
export const LANDMARK_WEIGHT = (() => {
  const w = new Float32Array(N).fill(1);
  const set = (ids, v) => ids.forEach((i) => (w[i] = v));
  // چشم‌ها: گوشهٔ داخلی/بیرونی و پلکِ بالا/پایین (در برابر پلک‌زدن پایدارند)
  set([33, 133, 263, 362, 159, 145, 386, 374, 130, 243, 359, 463, 27, 257], 2.6);
  // بینی: پل، پره، نوک — کلیدِ نشستنِ عینک
  set([168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 129, 358, 49, 279, 278, 344, 439, 440, 219, 220], 2.4);
  // خطِ فک، شقیقه، پیشانی
  set([234, 454, 127, 356, 172, 397, 152, 10, 21, 251, 103, 332, 93, 323, 132, 361, 70, 300, 105, 334], 2.0);
  // دهان (با لبخند جابه‌جا می‌شود ⇒ وزنِ متوسط)
  set([61, 291, 13, 14, 0, 17, 84, 314, 78, 308], 1.2);
  // لب‌های داخلی، داخلِ دهان و پلک‌های متحرک ⇒ سبک
  set([267, 269, 270, 409, 37, 39, 40, 185, 191, 80, 81, 82, 90, 180, 85, 315, 310, 311, 312, 320, 404], 0.5);
  return w;
})();

/** مختصاتِ کانونیکِ «مردمک» — میانگینِ گوشه‌های چشم، ۲٫۵ میلی‌متر جلوتر (قوزکِ قرنیه) */
export const EYE = (() => {
  const z = (CANONICAL_MM[33 * 3 + 2] + CANONICAL_MM[263 * 3 + 2]) / 2;
  const y = (CANONICAL_MM[33 * 3 + 1] + CANONICAL_MM[263 * 3 + 1]) / 2;
  const xL = (CANONICAL_MM[33 * 3] + CANONICAL_MM[133 * 3]) / 2;
  const xR = (CANONICAL_MM[263 * 3] + CANONICAL_MM[362 * 3]) / 2;
  return {
    center: [(xL + xR) / 2, y, z],
    left: [xL, y, z],
    right: [xR, y, z],
    corneaZ: z + 12.5, // قوزکِ قرنیه: لبهٔ کناریِ چشم ≈ ۱۲٫۵mm عقب‌تر از جلوترین نقطهٔ قرنیه
    halfSpan: (xR - xL) / 2,
  };
})();

/** نقطه‌ای که FaceTracker به‌عنوان لنگرِ pose استفاده می‌کند (میانهٔ چهار گوشهٔ چشم) */
export const POSE_ANCHOR = (() => {
  const ids = [33, 133, 263, 362];
  let x = 0, y = 0, z = 0;
  for (const i of ids) {
    x += CANONICAL_MM[i * 3];
    y += CANONICAL_MM[i * 3 + 1];
    z += CANONICAL_MM[i * 3 + 2];
  }
  return [x / ids.length, y / ids.length, z / ids.length];
})();

/** نقطهٔ «زینِ بینی» (پایین‌ترین نقطهٔ پل) و پروفایلِ بینی برای نشستنِ فریم */
export const NOSE = {
  saddle: 6,
  bridgeTop: 168,
  bridgeMid: 197,
  bridgeLow: 195,
  tip: 4,
  sides: [129, 358, 49, 279, 278, 344, 439, 440, 219, 220, 45, 275, 220, 440],
  profile: [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 129, 358, 49, 279, 45, 275, 220, 440, 219, 439, 218, 438],
};

let RING = null;
/** مثلث‌های مجاورِ هر رأس (برای پرس‌وجوی سطحِ پوست) */
export function vertexRing() {
  if (RING) return RING;
  const ring = Array.from({ length: N }, () => []);
  for (let t = 0; t < FACE_TRIS.length; t += 3) {
    const tri = t / 3;
    for (let k = 0; k < 3; k++) {
      const v = FACE_TRIS[t + k];
      if (v < N) ring[v].push(tri);
    }
  }
  RING = ring;
  return ring;
}

// ── جبر خطیِ کوچک ──────────────────────────────────────────────────────────
const det3 = (A) => A[0] * (A[4] * A[8] - A[5] * A[7]) - A[3] * (A[1] * A[8] - A[2] * A[7]) + A[6] * (A[1] * A[5] - A[2] * A[4]);
const mul3 = (A, B) => {
  const C = new Float64Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      let t = 0;
      for (let k = 0; k < 3; k++) t += A[r * 3 + k] * B[k * 3 + c];
      C[r * 3 + c] = t;
    }
  return C;
};
const transpose3 = (A) => {
  const C = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[c * 3 + r];
  return C;
};

function eigenSymmetric3(input) {
  const A = Float64Array.from(input);
  const V = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const pairs = [[0, 1], [0, 2], [1, 2]];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (const [p, q] of pairs) off += A[p * 3 + q] ** 2;
    if (off < 1e-24) break;
    for (const [p, q] of pairs) {
      const apq = A[p * 3 + q];
      if (Math.abs(apq) < 1e-24) continue;
      const theta = (A[q * 3 + q] - A[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k * 3 + p], akq = A[k * 3 + q];
        A[k * 3 + p] = c * akp - s * akq;
        A[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p * 3 + k], aqk = A[q * 3 + k];
        A[p * 3 + k] = c * apk - s * aqk;
        A[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k * 3 + p], vkq = V[k * 3 + q];
        V[k * 3 + p] = c * vkp - s * vkq;
        V[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [A[0], A[4], A[8]], vectors: V };
}

export function quatFromMat(R) {
  const tr = R[0] + R[4] + R[8];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s, 0.25 * s];
  } else if (R[0] > R[4] && R[0] > R[8]) {
    const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2;
    q = [0.25 * s, (R[1] + R[3]) / s, (R[6] + R[2]) / s, (R[7] - R[5]) / s];
  } else if (R[4] > R[8]) {
    const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2;
    q = [(R[1] + R[3]) / s, 0.25 * s, (R[5] + R[7]) / s, (R[2] - R[6]) / s];
  } else {
    const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2;
    q = [(R[6] + R[2]) / s, (R[5] + R[7]) / s, 0.25 * s, (R[3] - R[1]) / s];
  }
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
}

export function quatRotate(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/**
 * کواترنیون از زوایای اویلر با ترتیبِ ZYX (رولِ Z، سپس یاوِ Y، سپس پیچِ X).
 * عمداً از مسیرِ ماتریس می‌رود تا با `eulerFromQuat` دقیقاً معکوس باشد؛ نسخهٔ
 * قبلی فرمولِ بسته با استخراجِ زاویه هم‌خوان نبود و تا ۱۵ درجه اختلاف می‌داد
 * (همین باعث می‌شد seedِ فریمِ بعد چرخشِ غلط بگیرد).
 */
export function quatFromEuler(pitch, yaw, roll) {
  const ca = Math.cos(pitch), sa = Math.sin(pitch);
  const cb = Math.cos(yaw), sb = Math.sin(yaw);
  const cc = Math.cos(roll), sc = Math.sin(roll);
  // R = Rz(roll)·Ry(yaw)·Rx(pitch)
  return quatFromMat([
    cb * cc, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa,
    cb * sc, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa,
    -sb, cb * sa, cb * ca,
  ]);
}

/** زوایای اویلر (ZYX) از کواترنیون — معکوسِ دقیقِ `quatFromEuler` */
export function eulerFromQuat(q) {
  const R = matFromQuat(q);
  const pitch = Math.atan2(R[7], R[8]);
  const yaw = Math.asin(clamp(-R[6], -1, 1));
  const roll = Math.atan2(R[3], R[0]);
  return { pitch, yaw, roll };
}

export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Kabsch وزن‌دار: مقیاس/چرخش/انتقالِ بهینه برای نگاشتِ src → dst (هر دو ۳بعدی) */
export function kabschWeighted(src, dst, weights, count = N) {
  let sw = 0;
  const mx = [0, 0, 0], my = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const wi = weights[i];
    if (!wi) continue;
    sw += wi;
    for (let k = 0; k < 3; k++) {
      mx[k] += src[i * 3 + k] * wi;
      my[k] += dst[i * 3 + k] * wi;
    }
  }
  if (!(sw > 0)) return { q: [0, 0, 0, 1], scale: 1, translate: [0, 0, 0], sourceMean: mx, targetMean: my };
  for (let k = 0; k < 3; k++) {
    mx[k] /= sw;
    my[k] /= sw;
  }
  const C = new Float64Array(9);
  let varSrc = 0;
  for (let i = 0; i < count; i++) {
    const wi = weights[i];
    if (!wi) continue;
    const ax = src[i * 3] - mx[0], ay = src[i * 3 + 1] - mx[1], az = src[i * 3 + 2] - mx[2];
    const bx = dst[i * 3] - my[0], by = dst[i * 3 + 1] - my[1], bz = dst[i * 3 + 2] - my[2];
    varSrc += wi * (ax * ax + ay * ay + az * az);
    C[0] += wi * ax * bx; C[1] += wi * ax * by; C[2] += wi * ax * bz;
    C[3] += wi * ay * bx; C[4] += wi * ay * by; C[5] += wi * ay * bz;
    C[6] += wi * az * bx; C[7] += wi * az * by; C[8] += wi * az * bz;
  }
  const { values, vectors } = eigenSymmetric3(mul3(transpose3(C), C));
  const sval = values.map((v) => Math.sqrt(Math.max(0, v)));
  const order = [0, 1, 2].sort((a, b) => sval[b] - sval[a]);
  const U = new Float64Array(9), V = new Float64Array(9);
  const S = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const idx = order[k];
    S[k] = sval[idx];
    const vx = vectors[idx], vy = vectors[3 + idx], vz = vectors[6 + idx];
    const cx = C[0] * vx + C[1] * vy + C[2] * vz;
    const cy = C[3] * vx + C[4] * vy + C[5] * vz;
    const cz = C[6] * vx + C[7] * vy + C[8] * vz;
    const dot = cx * vx + cy * vy + cz * vz;
    const inv = S[k] > 1e-12 ? (dot < 0 ? -1 : 1) / S[k] : 0;
    U[k] = cx * inv; U[3 + k] = cy * inv; U[6 + k] = cz * inv;
    V[k] = vx; V[3 + k] = vy; V[6 + k] = vz;
  }
  const d = Math.sign(det3(mul3(V, transpose3(U))) || 1);
  const D = [1, 1, d];
  const VD = Float64Array.from(V);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) VD[r * 3 + c] = V[r * 3 + c] * D[c];
  const R = mul3(VD, transpose3(U));
  const scale = (S[0] + S[1] + S[2] * d) / (varSrc || 1);
  const q = quatFromMat(R);
  const rmx = quatRotate(q, mx);
  return {
    q,
    scale,
    translate: [my[0] - scale * rmx[0], my[1] - scale * rmx[1], my[2] - scale * rmx[2]],
    sourceMean: mx,
    targetMean: my,
  };
}

/** چرخشِ کواترنیون به ماتریسِ ۳×۳ (سطر-محور) */
export function matFromQuat(q) {
  const [x, y, z, w] = q;
  return new Float64Array([
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ]);
}

// ── برازش ───────────────────────────────────────────────────────────────────

/**
 * خطای بازتصویرِ مدل با چرخشِ R: بهترین مقیاس/انتقالِ دوبعدی و RMSِ وزن‌دار.
 * @returns {{err:number, scale:number, tx:number, ty:number}}
 */
function planarResidual(R, model, obs, w, count) {
  // p_i = چرخشِ مدل؛ سپس u = s·px + tx ، v = s·py + ty
  let sw = 0, mpx = 0, mpy = 0, mox = 0, moy = 0;
  const px = new Float64Array(count), py = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const x = model[i * 3], y = model[i * 3 + 1], z = model[i * 3 + 2];
    px[i] = R[0] * x + R[1] * y + R[2] * z;
    py[i] = R[3] * x + R[4] * y + R[5] * z;
    const wi = w[i];
    if (!wi) continue;
    sw += wi;
    mpx += px[i] * wi; mpy += py[i] * wi;
    mox += obs[i * 3] * wi; moy += obs[i * 3 + 1] * wi;
  }
  if (!(sw > 0)) return { err: Infinity, scale: 1, tx: 0, ty: 0 };
  mpx /= sw; mpy /= sw; mox /= sw; moy /= sw;
  let num = 0, den = 0;
  for (let i = 0; i < count; i++) {
    const wi = w[i];
    if (!wi) continue;
    const a = px[i] - mpx, b = py[i] - mpy;
    const A = obs[i * 3] - mox, B = obs[i * 3 + 1] - moy;
    num += wi * (a * A + b * B);
    den += wi * (a * a + b * b);
  }
  const s = den > 1e-12 ? num / den : 0;
  if (!(s > 0)) return { err: Infinity, scale: s, tx: 0, ty: 0 };
  const tx = mox - s * mpx, ty = moy - s * mpy;
  let ss = 0;
  for (let i = 0; i < count; i++) {
    const wi = w[i];
    if (!wi) continue;
    const du = s * px[i] + tx - obs[i * 3];
    const dv = s * py[i] + ty - obs[i * 3 + 1];
    ss += wi * (du * du + dv * dv);
  }
  return { err: Math.sqrt(ss / sw), scale: s, tx, ty };
}

/**
 * برازشِ کاملِ سر روی لندمارک‌های نرمال‌شده (۰..۱).
 *
 * @param {Array<{x:number,y:number,z:number}>} lms لندمارک‌های MediaPipe (۴۷۸ یا ۴۶۸)
 * @param {{W:number,H:number,iters?:number,weights?:Float32Array,seed?:number[]}} opts
 * @returns {{
 *   ok:boolean, q:number[], scale:number, translate:number[], pupilPx:[number,number],
 *   rmsPx:number, rmsMm:number, inlierRatio:number, confidence:number,
 *   weights:Float32Array, observed:Float64Array, euler:{pitch:number,yaw:number,roll:number},
 *   yaw:number, pitch:number, roll:number, canonical:Float32Array, coverage:number
 * }}
 */
export function fitCanonicalHead(lms, opts = {}) {
  const W = Math.max(1, opts.W || 640);
  const H = Math.max(1, opts.H || 480);
  const baseWeights = opts.weights || LANDMARK_WEIGHT;
  const fail = {
    ok: false, q: [0, 0, 0, 1], scale: 0, translate: [0, 0], pupilPx: [W / 2, H / 2],
    rmsPx: Infinity, rmsMm: Infinity, inlierRatio: 0, confidence: 0,
    weights: new Float32Array(N), observed: new Float64Array(N * 2),
    euler: { pitch: 0, yaw: 0, roll: 0 }, yaw: 0, pitch: 0, roll: 0,
    canonical: CANONICAL_MM, coverage: 0,
  };
  if (!lms || lms.length < N) return fail;

  // مشاهده‌ها: پیکسل، y رو به بالا
  const obs = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    const p = lms[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return fail;
    obs[i * 3] = p.x * W;
    obs[i * 3 + 1] = (1 - p.y) * H;
    obs[i * 3 + 2] = 0;
  }

  // ۱) مقیاس/رولِ اولیه از جفت‌شدنِ صفحه‌ای (مدلِ با z=0)
  const flat = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    flat[i * 3] = CANONICAL_MM[i * 3];
    flat[i * 3 + 1] = CANONICAL_MM[i * 3 + 1];
  }
  const seed = kabschWeighted(flat, obs, baseWeights, N);
  if (!(seed.scale > 1e-3) || !Number.isFinite(seed.scale)) return fail;
  let euler = eulerFromQuat(seed.q);
  let best = { q: seed.q, roll: euler.roll, yaw: euler.yaw, pitch: euler.pitch, ...planarResidual(matFromQuat(seed.q), CANONICAL_MM, obs, baseWeights, N) };
  best.err = planarResidual(matFromQuat(seed.q), CANONICAL_MM, obs, baseWeights, N).err;

  const evalAngles = (yaw, pitch, roll) => {
    const q = quatFromEuler(pitch, yaw, roll);
    const r = planarResidual(matFromQuat(q), CANONICAL_MM, obs, baseWeights, N);
    return { q, yaw, pitch, roll, ...r };
  };

  // ۲) جست‌وجوی درشتِ yaw/pitch. اگر زوایای فریمِ قبل را داشته باشیم (seed)، فقط
  //    حوالیِ همان را می‌گردیم؛ این کار هزینهٔ هر فریم را از ~۲۵ms به چند ms می‌آورد.
  const roll0 = euler.roll;
  const seedAngles = opts.seed || null;
  let coarse = null;
  const seeds = seedAngles
    ? (() => {
        const out = [];
        for (const dy of [-6, 0, 6]) for (const dp of [-5, 0, 5]) for (const dr of [0, -2.5, 2.5]) out.push([seedAngles.yaw + dy, seedAngles.pitch + dp, (seedAngles.roll ?? 0) + dr]);
        return out;
      })()
    : null;
  if (seeds) {
    for (const [y, p, r] of seeds) {
      const cand = evalAngles((y * Math.PI) / 180, (p * Math.PI) / 180, (r * Math.PI) / 180);
      if (!coarse || cand.err < coarse.err) coarse = cand;
    }
  } else {
    for (let yaw = -48; yaw <= 48.1; yaw += 12) {
      for (let pitch = -30; pitch <= 30.1; pitch += 10) {
        for (const dr of [0, -8, 8]) {
          const cand = evalAngles((yaw * Math.PI) / 180, (pitch * Math.PI) / 180, roll0 + (dr * Math.PI) / 180);
          if (!coarse || cand.err < coarse.err) coarse = cand;
        }
      }
    }
  }
  if (coarse && coarse.err < best.err) best = coarse;

  // ۳) ریزسازیِ مختصات‌به‌مختصات با گامِ نصف‌شونده
  let stepDeg = 6;
  while (stepDeg > 0.12) {
    let improved = false;
    for (const axis of ["yaw", "pitch", "roll"]) {
      for (const dir of [1, -1]) {
        const cand = { yaw: best.yaw, pitch: best.pitch, roll: best.roll };
        cand[axis] += (dir * stepDeg * Math.PI) / 180;
        const ev = evalAngles(cand.yaw, cand.pitch, cand.roll);
        if (ev.err < best.err - 1e-4) {
          best = ev;
          improved = true;
        }
      }
    }
    if (!improved) stepDeg /= 2;
  }

  // ۴) IRLS: نقاطِ پرت (دهانِ باز، انسکار، خطای لندمارک) وزن کم می‌گیرند
  const weights = Float32Array.from(baseWeights);
  let final = best;
  for (let it = 0; it < 3; it++) {
    const R = matFromQuat(final.q);
    const res = new Float64Array(N);
    let sw = 0, ss = 0;
    for (let i = 0; i < N; i++) {
      const x = CANONICAL_MM[i * 3], y = CANONICAL_MM[i * 3 + 1], z = CANONICAL_MM[i * 3 + 2];
      const u = final.scale * (R[0] * x + R[1] * y + R[2] * z) + final.tx;
      const v = final.scale * (R[3] * x + R[4] * y + R[5] * z) + final.ty;
      res[i] = Math.hypot(u - obs[i * 3], v - obs[i * 3 + 1]);
      if (weights[i]) {
        ss += weights[i] * res[i] * res[i];
        sw += weights[i];
      }
    }
    const rms = Math.sqrt(ss / Math.max(1e-9, sw));
    const sigma = Math.max(1.2, rms * 1.6);
    for (let i = 0; i < N; i++) {
      if (!baseWeights[i]) continue;
      const k = res[i] / sigma;
      weights[i] = baseWeights[i] * (k <= 1 ? 1 : 1 / (k * k));
    }
    // با وزن‌های تازه، زوایا را یک‌بار دیگر ریز کن (نقاطِ پرت حذف شده‌اند)
    const refined = refineAngles(final);
    final = refined.err < final.err ? refined : final;
  }

  function refineAngles(start) {
    let current = start;
    let step = seedAngles ? 1 : 2;
    while (step > 0.1) {
      let improved = false;
      for (const axis of ["yaw", "pitch", "roll"]) {
        for (const dir of [1, -1]) {
          const cand = { yaw: current.yaw, pitch: current.pitch, roll: current.roll };
          cand[axis] += (dir * step * Math.PI) / 180;
          const q = quatFromEuler(cand.pitch, cand.yaw, cand.roll);
          const r = planarResidual(matFromQuat(q), CANONICAL_MM, obs, weights, N);
          if (r.err < current.err - 1e-4) {
            current = { q, ...cand, ...r };
            improved = true;
          }
        }
      }
      if (!improved) step /= 2;
    }
    return current;
  }

  // نگهبانِ مقیاس: اگر مدل «فروپاشیده» باشد (چند لندمارکِ هم‌مکان)، مقیاس به
  // نزدیکِ صفر می‌رود؛ چنین برازشی برای نشستن بی‌معناست و باید رد شود.
  //
  // سقفِ ثابت (px/mm) غلط بود: عکسِ نزدیک/پرتفکیک (یا آپلودِ ۴K) رمزی ۴–۶ برابر
  // می‌دهد و برازشِ سالم رد می‌شد. به‌جایش مقیاس را با *اندازهٔ دیده‌شدهٔ صورت*
  // می‌سنجیم: فاصلهٔ پیشانی→چانه در پیکسل تقسیم بر همان فاصله در مدل (mm).
  const spanPx = Math.hypot(obs[10 * 3] - obs[152 * 3], obs[10 * 3 + 1] - obs[152 * 3 + 1]);
  const spanMm = Math.hypot(
    CANONICAL_MM[10 * 3] - CANONICAL_MM[152 * 3],
    CANONICAL_MM[10 * 3 + 1] - CANONICAL_MM[152 * 3 + 1],
  );
  const expectedScale = spanPx / Math.max(1e-6, spanMm); // px بر mm، از خودِ مشاهده
  const scalePxPerMm = final.scale;
  const scaleOk =
    Number.isFinite(scalePxPerMm) &&
    scalePxPerMm > Math.max(0.05, expectedScale * 0.35) &&
    scalePxPerMm < Math.max(0.6, expectedScale * 2.6);
  if (!scaleOk) {
    return { ...fail, reason: "implausible-scale", scale: scalePxPerMm, expectedScale };
  }

  const R = matFromQuat(final.q);
  let used = 0, inliers = 0;
  for (let i = 0; i < N; i++) {
    if (!baseWeights[i]) continue;
    used++;
    const x = CANONICAL_MM[i * 3], y = CANONICAL_MM[i * 3 + 1], z = CANONICAL_MM[i * 3 + 2];
    const u = final.scale * (R[0] * x + R[1] * y + R[2] * z) + final.tx;
    const v = final.scale * (R[3] * x + R[4] * y + R[5] * z) + final.ty;
    if (Math.hypot(u - obs[i * 3], v - obs[i * 3 + 1]) < Math.max(2.5, final.err * 2.2)) inliers++;
  }
  const inlierRatio = used ? inliers / used : 0;
  const mmPerPx = 1 / Math.max(1e-6, final.scale);
  const rmsMm = final.err * mmPerPx;
  const e = eulerFromQuat(final.q);
  // اطمینان: خطای جفت‌شدن (mm) + نسبتِ نقاطِ سالم
  const confidence = clamp(
    (1 - clamp((rmsMm - 1.6) / 5.2, 0, 1)) * 0.66 + clamp((inlierRatio - 0.5) / 0.45, 0, 1) * 0.34,
    0,
    1,
  );

  // مردمکِ تصویر: مرکزِ چشمِ کانونیک با همین تبدیل (پرنویزتر از لندمارکِ عنبیه نیست)
  const pupil = [
    final.scale * (R[0] * EYE.center[0] + R[1] * EYE.center[1] + R[2] * EYE.center[2]) + final.tx,
    final.scale * (R[3] * EYE.center[0] + R[4] * EYE.center[1] + R[5] * EYE.center[2]) + final.ty,
  ];

  return {
    ok: true,
    q: final.q,
    scale: final.scale,
    tx: final.tx,
    ty: final.ty,
    translate: [final.tx, final.ty],
    pupilPx: pupil,
    rmsPx: final.err,
    rmsMm,
    inlierRatio,
    confidence: +confidence.toFixed(3),
    weights,
    observed: obs,
    euler: e,
    yaw: e.yaw,
    pitch: e.pitch,
    roll: e.roll,
    canonical: CANONICAL_MM,
    coverage: +(inliers / N).toFixed(3),
    metrics: CANONICAL_METRICS,
  };
}

/**
 * نقطهٔ فضایِ سر (mm، محورهای کانونیک) → پیکسلِ تصویر و عمقِ نسبی (px، رو به دوربین مثبت).
 * عمق نسبت به «صفحهٔ مردمک» اندازه‌گیری می‌شود.
 */
export function headToPx(fit, pMm) {
  const R = matFromQuat(fit.q);
  const x = pMm[0], y = pMm[1], z = pMm[2];
  const u = fit.scale * (R[0] * x + R[1] * y + R[2] * z) + fit.tx;
  const v = fit.scale * (R[3] * x + R[4] * y + R[5] * z) + fit.ty;
  const zRel = fit.scale * ((R[6] * x + R[7] * y + R[8] * z) - (R[6] * EYE.center[0] + R[7] * EYE.center[1] + R[8] * EYE.center[2]));
  return [u, v, zRel];
}

/** پیکسلِ تصویر (بدون عمق) → فضای سر؛ عمقِ دلخواه بر حسبِ mm */
export function pxToHead(fit, u, v, zRelPx = 0) {
  const dU = (u - fit.tx) / fit.scale;
  const dV = (v - fit.ty) / fit.scale;
  const dW = zRelPx / fit.scale + (CANONICAL_MM[33 * 3 + 2] + CANONICAL_MM[263 * 3 + 2]) / 2 - 0;
  const R = matFromQuat(fit.q);
  // معکوسِ چرخش: Rᵀ
  const x = R[0] * dU + R[3] * dV + R[6] * dW;
  const y = R[1] * dU + R[4] * dV + R[7] * dW;
  const z = R[2] * dU + R[5] * dV + R[8] * dW;
  return [x, y, z];
}

/** میانگینِ چند لندمارک در فضایِ کانونیک (mm) */
export function canonicalMid(ids) {
  const out = [0, 0, 0];
  for (const i of ids) for (let k = 0; k < 3; k++) out[k] += CANONICAL_MM[i * 3 + k];
  const n = ids.length || 1;
  return [out[0] / n, out[1] / n, out[2] / n];
}

/**
 * عمقِ سطحِ بینی در فضایِ سر برای یک نقطهٔ (x,y): درون‌یابیِ وزن‌دارِ معکوسِ فاصله
 * روی نقاطِ پروفایلِ بینی + رأس‌های مجاورشان.
 * @returns {{z:number, spread:number}}
 */
export function noseSurfaceZ(x, y) {
  let sw = 0, sz = 0, near = 0;
  for (const i of NOSE.profile) {
    const px = CANONICAL_MM[i * 3], py = CANONICAL_MM[i * 3 + 1], pz = CANONICAL_MM[i * 3 + 2];
    const d2 = (px - x) ** 2 + (py - y) ** 2;
    if (d2 > 900) continue; // بیش از ۳۰mm دور، بی‌اثر
    near++;
    const w = 1 / Math.max(1, d2);
    sw += w;
    sz += w * pz;
  }
  if (!sw) return { z: 0, spread: 99 };
  return { z: sz / sw, spread: near };
}
