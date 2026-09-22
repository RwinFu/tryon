/**
 * sweep.js — هندسهٔ خالص (بدون وابستگی به three) برای تولید شبکهٔ مثلثی
 *
 * همهٔ خروجی‌ها آرایهٔ سادهٔ number هستند: position / normal / uv / index.
 * به همین دلیل هم در مرورگر (three.BufferGeometry) و هم در Node (تولید GLB)
 * و هم در تست‌های واحد قابل استفاده‌اند.
 */

const TAU = Math.PI * 2;
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * پروفیل برش عرضی: مستطیل گرد (استات واقعی) یا بیضی/دایره (فلز).
 * @param {number} w  عرض (در صفحهٔ فریم، عمود بر مسیر)
 * @param {number} h  ضخامت (در راستای z / عمق)
 * @param {number} r  شعاع گرد گوشه (0..min/2)  →  0.5 = بیضی کامل
 * @param {number} seg
 */
export function roundedRectProfile(w, h, r = 0, seg = 4) {
  const hw = w / 2,
    hh = h / 2;
  const rad = Math.max(0, Math.min(r, Math.min(hw, hh)));
  if (rad * 2 >= Math.min(w, h)) return ellipseProfile(w, h, seg * 2 + 2);
  const straight = Math.max(0, hw - rad),
    straightV = Math.max(0, hh - rad);
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (TAU / 4);
      pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
    }
  };
  // شروع از گوشهٔ بالا-راست، در جهت مثلثات
  corner(straight, straightV, 0);
  corner(-straight, straightV, Math.PI / 2);
  corner(-straight, -straightV, Math.PI);
  corner(straight, -straightV, (3 * Math.PI) / 2);
  // حذف نقاط تکراری انتهای هر ربع
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push(p);
  }
  return out;
}

export function ellipseProfile(w, h, seg = 10) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * h * 0.5 });
  }
  return pts;
}

/**
 * جاروب (sweep) یک پروفیل بسته در امتداد یک مسیر بستهٔ صاف.
 * @param {Array<{x,y,z}>} path  مسیر مرکزی
 * @param {Array<{x,y}>} profile  برش عرضی (x = عرض در صفحه، y = عمق)
 * @param {object} opts  { closed, taper(t)->number, twist }
 */
export function sweep(path, profile, opts = {}) {
  const closed = opts.closed !== false;
  const N = path.length,
    M = profile.length;
  const rings = closed ? N + 1 : N;
  const position = new Array(N * M * 3).fill(0);
  const normal = new Array(N * M * 3).fill(0);
  const uv = new Array(N * M * 2).fill(0);
  const index = [];

  const frames = new Array(N);
  let t0 = [0, 0, 1];
  for (let i = 0; i < N; i++) {
    const a = path[closed ? (i - 1 + N) % N : Math.max(0, i - 1)];
    const b = path[closed ? (i + 1) % N : Math.min(N - 1, i + 1)];
    const t = norm3([b.x - a.x, b.y - a.y, b.z - a.z]);
    // محور «عرض» در صفحهٔ XY و عمود بر مماس
    let u = norm3(cross([0, 0, 1], t));
    if (!isFinite(u[0]) || (u[0] === 0 && u[1] === 0)) u = [1, 0, 0];
    const v = norm3(cross(t, u));
    frames[i] = { u, v };
    if (i === 0) t0 = t;
  }

  for (let i = 0; i < N; i++) {
    const p = path[i],
      { u, v } = frames[i];
    const taper = opts.taper ? opts.taper(i / (N - 1 || 1)) : 1;
    for (let j = 0; j < M; j++) {
      const pr = profile[j];
      const px = pr.x * taper,
        py = pr.y * (opts.taperY ? opts.taperY(i / (N - 1 || 1)) : taper);
      const k = (i * M + j) * 3;
      position[k] = p.x + u[0] * px + v[0] * py;
      position[k + 1] = p.y + u[1] * px + v[1] * py;
      position[k + 2] = p.z + u[2] * px + v[2] * py;
      // نرمال تقریبی: جهت بردار شعاعی پروفیل
      const pl = Math.hypot(pr.x, pr.y) || 1;
      const nn = norm3([
        u[0] * (pr.x / pl) + v[0] * (pr.y / pl),
        u[1] * (pr.x / pl) + v[1] * (pr.y / pl),
        u[2] * (pr.x / pl) + v[2] * (pr.y / pl),
      ]);
      normal[k] = nn[0];
      normal[k + 1] = nn[1];
      normal[k + 2] = nn[2];
      const q = (i * M + j) * 2;
      uv[q] = i / (N - 1 || 1);
      uv[q + 1] = j / M;
    }
  }
  const segs = closed ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const a = i * M + j,
        b = i * M + j2,
        c = i2 * M + j,
        d = i2 * M + j2;
      index.push(a, c, b, b, c, d);
    }
  }
  let vertexCount = N * M;
  if (!closed) {
    // درپوش دو سرِ باز (مثل دسته) با رأس مرکزی، تا مش از پشت خالی نباشد
    for (const [ring, flip] of [[0, true], [(N - 1) * M, false]]) {
      let mx = 0,
        my = 0,
        mz = 0;
      for (let j = 0; j < M; j++) {
        const k = (ring + j) * 3;
        mx += position[k];
        my += position[k + 1];
        mz += position[k + 2];
      }
      mx /= M;
      my /= M;
      mz /= M;
      const cIdx = vertexCount++;
      const nrm = flip ? [-t0[0], -t0[1], -t0[2]] : t0;
      position.push(mx, my, mz);
      normal.push(nrm[0], nrm[1], nrm[2]);
      uv.push(0.5, 0.5);
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M;
        if (flip) index.push(cIdx, ring + j2, ring + j);
        else index.push(cIdx, ring + j, ring + j2);
      }
    }
  }
  void rings;

  // خودتنظیمیِ جهت مثلث‌ها: نرمال باید از محور مسیر به بیرون اشاره کند،
  // وگرنه آینه‌شدنِ سمت چپ/راست مش را پشت‌ورو می‌کند.
  for (let t = 0; t < 6 && t < M; t++) {
    const i = Math.floor(((t + 0.5) / 6) * N);
    const k = (i * M + t) * 3;
    const p = path[i];
    const dot =
      (position[k] - p.x) * normal[k] +
      (position[k + 1] - p.y) * normal[k + 1] +
      (position[k + 2] - p.z) * normal[k + 2];
    if (dot < 0) {
      for (let f = 0; f + 2 < index.length; f += 3) {
        const tmp = index[f + 1];
        index[f + 1] = index[f + 2];
        index[f + 2] = tmp;
      }
      break;
    }
  }
  return { position, normal, uv, index, vertexCount };
}



/** شبکهٔ «کلاهک» صاف روی یک منحنی بسته (سطح لنز). */
export function domedCap(outline, opts = {}) {
  const N = outline.length;
  const cx = opts.cx || 0,
    cy = opts.cy || 0;
  const R = opts.radius || 400,
    bulge = opts.bulge || 0;
  const z0 = opts.z || 0;
  const position = [],
    normal = [],
    uv = [],
    index = [];
  // مرکز
  position.push(cx, cy, z0 + bulge);
  normal.push(0, 0, 1);
  uv.push(0.5, 0.5);
  for (let i = 0; i < N; i++) {
    const p = outline[i];
    const r2 = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    const z = z0 + bulge - (R > 0 ? r2 / (2 * R) : 0) + (opts.backCurve ? -r2 / opts.backCurve : 0);
    position.push(p.x, p.y, z);
    // شیب سطح → نرمال
    const dzdx = (R > 0 ? -(p.x - cx) / R : 0),
      dzdy = (R > 0 ? -(p.y - cy) / R : 0);
    const n = norm3([-dzdx, -dzdy, 1]);
    normal.push(n[0], n[1], n[2]);
    uv.push((p.x - cx) / (opts.w || 1) + 0.5, (p.y - cy) / (opts.h || 1) + 0.5);
  }
  let area = 0;
  for (let i = 0; i < N; i++) {
    const a = outline[i],
      b = outline[(i + 1) % N];
    area += a.x * b.y - b.x * a.y;
  }
  const flip = area < 0;
  for (let i = 0; i < N; i++) {
    if (flip) index.push(0, 1 + i, 1 + ((i + 1) % N));
    else index.push(0, 1 + ((i + 1) % N), 1 + i);
  }
  return { position, normal, uv, index, vertexCount: N + 1 };
}

/** مستطیل گرد سه‌بعدی (برای بلوک لولا و قطعهٔ انتهایی). */
export function roundedBox(w, h, d, r, cx = 0, cy = 0, cz = 0, seg = 3) {
  const profile = roundedRectProfile(w, h, r, seg);
  const path = [];
  const depth = Math.max(d - r * 2, 0.001);
  const steps = depth < 0.05 ? 1 : 3;
  for (let i = 0; i <= steps; i++) path.push({ x: cx, y: cy, z: cz - depth / 2 + (depth / steps) * i });
  const g = sweep(path, profile, { closed: false });
  // بستن دو سر با درپوش صاف
  return g;
}

/** تبدیل هندسهٔ ساده به three.BufferGeometry */
export function toThreeGeometry(g, THREE) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(g.position, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.normal, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(g.uv, 2));
  geo.setIndex(g.index);
  geo.computeBoundingSphere();
  return geo;
}

export function bounds(g) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < g.position.length; i += 3) {
    const x = g.position[i],
      y = g.position[i + 1],
      z = g.position[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], size: [maxX - minX, maxY - minY, maxZ - minZ] };
}

export function mergeGeo(a, b) {
  if (!b) return a;
  const v = a.vertexCount;
  return {
    position: [...a.position, ...b.position],
    normal: [...a.normal, ...b.normal],
    uv: [...a.uv, ...b.uv],
    index: [...a.index, ...b.index.map((i) => i + v)],
    vertexCount: v + b.vertexCount,
  };
}

/** چرخش/انتقال یک هندسه (برای آینه‌کردن لنز چپ/راست و شیب پانتوسکوپیک). */
export function xform(g, m) {
  const apply = (x, y, z) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const s = w || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / s,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / s,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / s,
    ];
  };
  const nrm = (x, y, z) =>
    norm3([
      m[0] * x + m[1] * y + m[2] * z,
      m[4] * x + m[5] * y + m[6] * z,
      m[8] * x + m[9] * y + m[10] * z,
    ]);
  const out = {
    position: new Array(g.position.length),
    normal: new Array(g.normal.length),
    uv: g.uv.slice(),
    index: g.index.slice(),
    vertexCount: g.vertexCount,
  };
  for (let i = 0; i < g.position.length; i += 3) {
    const p = apply(g.position[i], g.position[i + 1], g.position[i + 2]);
    out.position[i] = p[0];
    out.position[i + 1] = p[1];
    out.position[i + 2] = p[2];
    const n = nrm(g.normal[i], g.normal[i + 1], g.normal[i + 2]);
    out.normal[i] = n[0];
    out.normal[i + 1] = n[1];
    out.normal[i + 2] = n[2];
  }
  return out;
}

/** ماتریس ۴×۴ ستونی (هم‌خوان با three) از چرخش‌ها و انتقال. */
export function compose({ rx = 0, ry = 0, rz = 0, tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1 }) {
  const cx = Math.cos(rx),
    sxn = Math.sin(rx),
    cy = Math.cos(ry),
    syn = Math.sin(ry),
    cz = Math.cos(rz),
    szn = Math.sin(rz);
  // R = Rz · Ry · Rx
  const r00 = cz * cy,
    r01 = cz * syn * sxn - szn * cx,
    r02 = cz * syn * cx + szn * sxn;
  const r10 = szn * cy,
    r11 = szn * syn * sxn + cz * cx,
    r12 = szn * syn * cx - cz * sxn;
  const r20 = -syn,
    r21 = cy * sxn,
    r22 = cy * cx;
  const m = new Array(16);
  m[0] = r00 * sx;
  m[1] = r10 * sx;
  m[2] = r20 * sx;
  m[3] = 0;
  m[4] = r01 * sy;
  m[5] = r11 * sy;
  m[6] = r21 * sy;
  m[7] = 0;
  m[8] = r02 * sz;
  m[9] = r12 * sz;
  m[10] = r22 * sz;
  m[11] = 0;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}
