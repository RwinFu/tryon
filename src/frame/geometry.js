/**
 * geometry.js — موتور ساخت فریم عینک از پارامترهای میلی‌متری
 *
 * خروجی: { roles: {frame,metal,lens,pad}, bbox, meta } با هندسهٔ خام (آرایهٔ عدد).
 * همین خروجی هم در مرورگر به three تبدیل می‌شود و هم در Node به GLB —
 * یعنی یک منبع حقیقت برای «بکری» (bake) و «زمان اجرا».
 *
 * واحد: میلی‌متر، مبدأ = مرکز پلی بین دو لنز، روی صفحهٔ جلو.
 *  +x = شقیقهٔ راستِ فرد، +y = بالا، +z = بیرون از صورت (سمت دوربین)
 */
import { lensOutline, offsetOutline, resample, smoothPts, SHAPE_PRESETS } from "./shapes.js";
import { sweep, roundedRectProfile, ellipseProfile, roundedBox, mergeGeo, bounds } from "./sweep.js";

const D2R = Math.PI / 180;
const rimWEarly = (s) => (s.metal ? s.metalRimW : s.rimW) || 4;

export const DEFAULTS = {
  shape: "square",
  style: "full", // full | half | brow | rimless
  lensW: 52,
  lensH: 42,
  lensTiltDeg: 0,
  dbn: 18, // فاصلهٔ بینی (bridge)
  rimW: 5.4, // عرضِ نوار فریم روی دور لنز
  rimT: 3.6, // ضخامت فریم در عمق
  bevel: 0.42, // نسبت گِردی گوشهٔ برش (۰=تیز، ۰٫۵=لوله‌ای)
  baseCurve: 6, // منحنی بیس لنز (diopter) → فریم چقدر دور سر می‌پیچد
  pantoDeg: 8,
  splayDeg: 4,
  bridgeDrop: 0.55, // پایین‌تر بودن پل نسبت به مرکز لنز (نسبت به نیم‌ارتفاع)
  bridgeArch: 3.2,
  templeLen: 145,
  templeW: 5.0,
  templeT: 2.6,
  templeTaper: 0.72,
  earDrop: 8.5, // افت عمودی دسته در پشت گوش
  earBendAt: 0.82, // نسبتِ محل خم شدن دسته
  nosePads: false,
  doubleBridge: false,
  highBridge: false,
  hinge: true,
  endpiece: true,
  metalRimW: 2.0,
  metalRimT: 1.6,
  lensInset: 0.7,
  browShare: 0.62, // سهم ضخامت ابرو نسبت به فریم در browline
};

function rotateXYZ(p, ang) {
  if (!ang) return p;
  const c = Math.cos(ang),
    s2 = Math.sin(ang);
  return { x: p.x, y: p.y * c - p.z * s2, z: p.y * s2 + p.z * c };
}

/** تبدیل مشخصهٔ محصول به پارامترهای هندسه (اختصارهای رایج کاتالوگ). */
export function normalizeSpec(spec = {}) {
  const s = { ...DEFAULTS, ...spec };
  if (spec.size) {
    const [lens, bridge, temple] = String(spec.size)
      .split(/[^0-9.]+/)
      .filter(Boolean)
      .map(Number);
    if (lens) s.lensW = lens;
    if (bridge) s.dbn = bridge;
    if (temple) s.templeLen = temple;
  }
  if (!spec.lensH) s.lensH = Math.round((s.lensW || 52) * (SHAPE_PRESETS[s.shape]?.depth || 0.88) * 10) / 10;
  s.metal = s.material === "metal" || s.material === "titanium" || s.material === "steel";
  s.totalWidth = +(2 * s.lensW + s.dbn).toFixed(1);
  return s;
}

/** مسیر کاتمول-رم در فضای سه‌بعدی (بدون وابستگی به three). */
function cr3(points, samples = 24) {
  const p = points.filter(Boolean);
  if (p.length < 2) return p.slice();
  const a = p[0],
    b = p[1],
    z = p[p.length - 1],
    y = p[p.length - 2];
  const pts = [
    { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z },
    ...p,
    { x: 2 * z.x - y.x, y: 2 * z.y - y.y, z: 2 * z.z - y.z },
  ];
  const out = [];
  const segs = pts.length - 3;
  for (let seg = 0; seg < segs; seg++) {
    const p0 = pts[seg],
      p1 = pts[seg + 1],
      p2 = pts[seg + 2],
      p3 = pts[seg + 3];
    const steps = Math.max(2, Math.round(samples / segs));
    const last = seg === segs - 1;
    for (let i = 0; i < steps + (last ? 1 : 0); i++) {
      const t = i / steps;
      const t2 = t * t,
        t3 = t2 * t;
      const f = (c, d, e, g) =>
        0.5 * (2 * d + (e - c) * t + (2 * c - 5 * d + 4 * e - g) * t2 + (3 * d - c - 3 * e + g) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return out;
}

/** شعاع انحنای لنز از منحنی‌بیس. */
const wrapRadius = (bc) => Math.min(2400, Math.max(45, 530 / Math.max(0.6, bc || 6)));

/** آینه‌کردن هندسه در صفحهٔ x=0 (با بازچرخانیِ جهت مثلث‌ها). */
function mirrorX(g) {
  const out = {
    position: new Array(g.position.length),
    normal: new Array(g.normal.length),
    uv: g.uv.slice(),
    index: g.index.slice(),
    vertexCount: g.vertexCount,
  };
  for (let i = 0; i < g.position.length; i += 3) {
    out.position[i] = -g.position[i];
    out.position[i + 1] = g.position[i + 1];
    out.position[i + 2] = g.position[i + 2];
    out.normal[i] = -g.normal[i];
    out.normal[i + 1] = g.normal[i + 1];
    out.normal[i + 2] = g.normal[i + 2];
  }
  for (let f = 0; f + 2 < out.index.length; f += 3) {
    const t = out.index[f + 1];
    out.index[f + 1] = out.index[f + 2];
    out.index[f + 2] = t;
  }
  return out;
}

/** چرخش حول محور x به اندازهٔ پانتوسکوپیک. */
function rotateX(g, ang) {
  if (!ang) return g;
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const rot = (y, z) => [y * c - z * s, y * s + z * c];
  const out = {
    position: new Array(g.position.length),
    normal: new Array(g.normal.length),
    uv: g.uv.slice(),
    index: g.index.slice(),
    vertexCount: g.vertexCount,
  };
  for (let i = 0; i < g.position.length; i += 3) {
    out.position[i] = g.position[i];
    const [y, z] = rot(g.position[i + 1], g.position[i + 2]);
    out.position[i + 1] = y;
    out.position[i + 2] = z;
    out.normal[i] = g.normal[i];
    const [ny, nz] = rot(g.normal[i + 1], g.normal[i + 2]);
    out.normal[i + 1] = ny;
    out.normal[i + 2] = nz;
  }
  return out;
}

/**
 * یک رینگ استاتِ واقعی‌تر از sweep ساده می‌سازد: دهانهٔ عدسی اندازهٔ اسمی دارد،
 * بدنه دور آن به بیرون می‌رود، و لبهٔ داخل/خارج هر دو bevel دارند. سطح‌های
 * جلو و پشت بسته‌اند تا در نور/چرخش، لبهٔ باز و «دو لوله روی هم» دیده نشود.
 */
function annularRim(innerInput, outerInput, { side, lensCX, depth, rimWidth, dome }) {
  const count = Math.min(innerInput.length, outerInput.length);
  const inner = resample(innerInput, count, true);
  const outer = resample(outerInput, count, true);
  const bevelWidth = Math.max(0.22, Math.min(rimWidth * 0.17, 0.82, rimWidth * 0.32));
  const bevelDepth = Math.max(0.12, Math.min(depth * 0.18, 0.72));
  const innerFace = resample(offsetOutline(inner, -bevelWidth), count, true);
  const outerFace = resample(offsetOutline(outer, bevelWidth), count, true);
  const loops = [
    { pts: inner, z: depth / 2 - bevelDepth },
    { pts: innerFace, z: depth / 2 },
    { pts: outerFace, z: depth / 2 },
    { pts: outer, z: depth / 2 - bevelDepth },
    { pts: outer, z: -depth / 2 + bevelDepth },
    { pts: outerFace, z: -depth / 2 },
    { pts: innerFace, z: -depth / 2 },
    { pts: inner, z: -depth / 2 + bevelDepth },
  ];
  const position = [], uv = [], index = [];
  for (const loop of loops) {
    for (const p of loop.pts) {
      position.push(p.x + side * lensCX, p.y, -dome(p.x, p.y) + loop.z);
      uv.push(p.x / 100 + 0.5, p.y / 100 + 0.5);
    }
  }
  const centerAt = (loopIndex, i) => loops[loopIndex % loops.length].pts[i % count];
  const expectedNormal = (layer, i) => {
    const a = centerAt(layer, i), b = centerAt(layer + 1, i);
    const x = (a.x + b.x) * 0.5, y = (a.y + b.y) * 0.5;
    switch (layer) {
      case 0: return [-x, -y, 1];       // bevel at the lens aperture, front
      case 1: return [0, 0, 1];         // front face
      case 2: return [x, y, 1];          // outside bevel, front
      case 3: return [x, y, 0];          // outside wall
      case 4: return [x, y, -1];         // outside bevel, back
      case 5: return [0, 0, -1];        // back face
      case 6: return [-x, -y, -1];       // inside bevel, back
      default: return [-x, -y, 0];       // aperture wall
    }
  };
  const vector = (i) => [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const addTriangle = (a, b, c, target) => {
    const pa = vector(a), pb = vector(b), pc = vector(c);
    const ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = cross3(ab, ac);
    if (n[0] * target[0] + n[1] * target[1] + n[2] * target[2] < 0) index.push(a, c, b);
    else index.push(a, b, c);
  };
  for (let layer = 0; layer < loops.length; layer++) {
    const nextLayer = (layer + 1) % loops.length;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const a = layer * count + i, b = nextLayer * count + i;
      const c = nextLayer * count + j, d = layer * count + j;
      const target = expectedNormal(layer, i);
      addTriangle(a, b, c, target);
      addTriangle(a, c, d, target);
    }
  }
  const normal = new Array(position.length).fill(0);
  for (let i = 0; i < index.length; i += 3) {
    const ia = index[i], ib = index[i + 1], ic = index[i + 2];
    const a = vector(ia), b = vector(ib), c = vector(ic);
    const n = cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    for (const v of [ia, ib, ic]) {
      normal[v * 3] += n[0];
      normal[v * 3 + 1] += n[1];
      normal[v * 3 + 2] += n[2];
    }
  }
  for (let i = 0; i < normal.length; i += 3) {
    const len = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    normal[i] /= len; normal[i + 1] /= len; normal[i + 2] /= len;
  }
  return { position, normal, uv, index, vertexCount: position.length / 3 };
}

/**
 * ساخت یک فریم کامل.
 * @param {object} spec  پارامترها (بیشترها اختیاری‌اند)
 * @returns {{roles:Object, bbox:Object, meta:Object, parts:Array}}
 */
export function buildFrame(rawSpec = {}) {
  const s = normalizeSpec(rawSpec);
  const parts = [];
  /** @param {{path?:Array<{x:number,y:number,z:number}>,sw?:number}} [extra] مسیرِ سایه و ضخامت خطی‌اش (میلی‌متر) */
  const add = (name, role, geo, extra) => geo && parts.push({ name, role, geo, path: extra?.path, sw: extra?.sw });

  const halfH = s.lensH / 2;
  const lensCX = s.lensW / 2 + s.dbn / 2;
  const R = wrapRadius(s.baseCurve);
  const panto = -s.pantoDeg * D2R;
  const isMetal = !!s.metal;
  const rimW = isMetal ? s.metalRimW : s.rimW;
  const rimT = isMetal ? s.metalRimT : s.rimT;
  const metalTemple = s.templeMaterial === "metal" || (s.templeMaterial !== "acetate" && isMetal);
  const endpieceRole = s.endpieceMaterial === "accent" ? "accent" : s.endpieceMaterial === "frame" ? "frame" : isMetal ? "metal" : metalTemple ? "metal" : "frame";
  // داخل پل باید روی بخش بینی‌روِ رینگ بنشیند؛ نه بیرون از فریم.
  const innerX = Math.max(1.2, s.dbn / 2 - rimW * (isMetal ? 0.75 : 0.95));
  const outerX = lensCX + s.lensW / 2 + (isMetal ? rimW * 0.6 : rimW);

  /** zِ سطح لنز در مختصات موضعی لنز (فریم چرخیدهٔ دور چشم) */
  const dome = (x, y) => {
    const r2 = x * x + y * y;
    return r2 < R * R ? R - Math.sqrt(R * R - r2) : R;
  };

  // ── ۱. دور لنز: دهانه بر اساس سایز چاپی، بدنه رو به بیرون ─────────────
  // لنزِ ورودی همان اندازهٔ اسمیِ EYE است. در فریم استات، حلقه به بیرون
  // offset می‌شود؛ در مدل قبلی علامت offset برعکس بود و خود عدسی از فریم بزرگ‌تر.
  const externalOutline = (side, samples) => {
    const lp = side > 0 ? s.lensPathR || s.lensPath : s.lensPathL || s.lensPath;
    if (!lp) return null;
    const pts = lp.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
    return resample(pts, samples, true);
  };
  const bridgeIsMetal = s.bridgeMaterial === "metal" || isMetal || s.style === "rimless";
  const bridgeRole = s.bridgeMaterial === "accent" ? "accent" : bridgeIsMetal ? "metal" : "frame";
  const browMaterial = s.browMaterial === "metal" ? "metal" : "frame";
  for (const side of [1, -1]) {
    const raw = resample(smoothPts(externalOutline(side, 260) || lensOutline(s, side, 260), 1), 132, true);
    const localPath = (pts, zOffset = 0) => pts.map((p) => ({
      x: p.x + side * lensCX,
      y: p.y,
      z: -dome(p.x, p.y) + zOffset,
    }));
    const lensInset = s.style === "rimless"
      ? Math.max(0.08, Math.min(0.24, s.lensInset * 0.25))
      : isMetal
        ? Math.max(0.34, rimW * 0.44)
        : Math.max(0.38, s.lensInset || 0.7);
    const lensOutlineInner = resample(offsetOutline(raw, lensInset), 96, true);
    const capPath = lensOutlineInner.map((p) => ({ x: p.x + side * lensCX, y: p.y, z: -dome(p.x, p.y) + 0.2 }));

    if (s.style === "full" && !isMetal) {
      const outer = resample(offsetOutline(raw, -rimW), 132, true);
      const rimPath = localPath(outer);
      add(side > 0 ? "rimR" : "rimL", "frame", annularRim(raw, outer, {
        side, lensCX, depth: rimT, rimWidth: rimW, dome,
      }), { path: rimPath, sw: rimW });
    } else if (s.style === "full") {
      const rimPath = localPath(raw);
      add(side > 0 ? "rimR" : "rimL", "metal", sweep(
        rimPath,
        ellipseProfile(rimW, rimT, 10),
        { closed: true },
      ), { path: rimPath, sw: rimW });
    } else if (s.style === "brow") {
      const outer = resample(offsetOutline(raw, -rimW * 0.72), 132, true);
      const top = pickRange(outer, (p) => p.y > -halfH * 0.08);
      const low = pickRange(raw, (p) => p.y <= -halfH * 0.08);
      const topPath = localPath(top);
      const lowPath = localPath(low, 0.34);
      if (topPath.length > 5) add(side > 0 ? "browR" : "browL", "frame", sweep(
        topPath,
        roundedRectProfile(rimW * 1.38, rimT * 1.22, Math.min(rimW * 0.42, rimT * 0.45), 5),
        { closed: false },
      ), { path: topPath, sw: rimW * 1.3 });
      if (lowPath.length > 5) add(side > 0 ? "lowrimR" : "lowrimL", browMaterial, sweep(
        lowPath,
        ellipseProfile(s.metalRimW || 1.65, s.metalRimT || 1.3, 8),
        { closed: false },
      ), { path: lowPath, sw: s.metalRimW || 1.65 });
    } else if (s.style === "half") {
      const upper = pickRange(raw, (p) => p.y >= -halfH * 0.04);
      const lower = pickRange(raw, (p) => p.y < -halfH * 0.04);
      const upperPath = localPath(upper);
      const lowerPath = localPath(lower, 0.26);
      if (upperPath.length > 5) add(side > 0 ? "rimR" : "rimL", "metal", sweep(
        upperPath,
        ellipseProfile(rimW, rimT, 8),
        { closed: false },
      ), { path: upperPath, sw: rimW });
      if (lowerPath.length > 5) add(side > 0 ? "cordR" : "cordL", "metal", sweep(
        lowerPath,
        ellipseProfile(0.62, 0.62, 8),
        { closed: false },
      ));
    }

    if (s.style === "rimless" && s.rimlessMounts !== false) {
      const mountOffset = Math.max(1.6, s.lensW * 0.5 - 1.8);
      for (const [kind, localX] of [["outer", side * mountOffset], ["inner", -side * mountOffset]]) {
        const x = side * lensCX + localX;
        const y = kind === "inner" ? -halfH * 0.28 : halfH * 0.02;
        const z = -dome(localX, y) + 0.48;
        const head = roundedBox(1.65, 2.2, 0.9, 0.42, x, y, z, 4);
        add(`${kind}Mount${side > 0 ? "R" : "L"}`, "accent", head);
      }
    }
    add(side > 0 ? "lensR" : "lensL", "lens", lensSurface(capPath, R, s));
  }

  // ── ۲. پل (bridge) ──────────────────────────────────────────────────
  {
    const y0 = -halfH * s.bridgeDrop;
    const zb = -dome(-(lensCX - innerX), y0);
    const zHigh = zb - 1.1;
    const archY = y0 + s.bridgeArch + (s.highBridge ? halfH * 0.62 : 0);
    const pts = [
      { x: -innerX - rimW * 0.35, y: y0 + rimW * 0.18, z: zb + 0.25 },
      { x: -innerX * 0.86, y: y0 + 0.7, z: zb },
      { x: -innerX * 0.42, y: archY, z: zHigh },
      { x: 0, y: archY + 0.6, z: zHigh - 0.35 },
      { x: innerX * 0.42, y: archY, z: zHigh },
      { x: innerX * 0.86, y: y0 + 0.7, z: zb },
      { x: innerX + rimW * 0.35, y: y0 + rimW * 0.18, z: zb + 0.25 },
    ];
    const path = cr3(pts, 14);
    const bw = bridgeIsMetal ? (s.bridgeStyle === "keyhole" ? 1.35 : 1.5) : rimW * (s.style === "rimless" ? 0.45 : 1.0);
    const prof = bridgeIsMetal
      ? ellipseProfile(bw, 2.5, 8)
      : roundedRectProfile(rimW * (s.style === "rimless" ? 0.8 : 1.05), rimT * 0.9, rimT * 0.32, 3);
    add("bridge", bridgeRole, sweep(path, prof, { closed: false }), {
      path,
      sw: Math.max(2.5, Math.min(rimW, 4)),
    });

    if (s.doubleBridge) {
      const yTop = topOf(rawTop(s)) * 0.92;
      const bx = Math.max(innerX * 1.7, lensCX - s.lensW * 0.16);
      const zTop = -dome(-(lensCX - bx), yTop);
      const top = cr3(
        [
          { x: -bx, y: yTop, z: zTop + 0.3 },
          { x: 0, y: yTop + 0.9, z: -dome(0, yTop) - 0.5 },
          { x: bx, y: yTop, z: zTop + 0.3 },
        ],
        10,
      );
      add("topbar", bridgeIsMetal ? "metal" : "frame", sweep(top, ellipseProfile(1.5, 1.5, 8), { closed: false }));
    }
  }

  // ── ۳. قطعهٔ انتهایی، لولا، دسته ──────────────────────────────────────
  let hingeX = outerX;
  for (const side of [1, -1]) {
    const raw = lensOutline(s, side, 200);
    // نقطهٔ اتصال: لبهٔ بیرونی، در یک‌سوم بالایی
    const anchor = anchorOuter(raw, side);
    const ax = anchor.x + side * lensCX;
    const hinge = { x: ax + side * (rimW * 0.42), y: anchor.y + halfH * 0.04, z: anchor.z };
    hingeX = Math.max(hingeX, Math.abs(hinge.x));

    if (s.endpiece && s.style !== "rimless") {
      const ep = sweep(
        [
          { x: ax - side * rimW * 0.15, y: anchor.y, z: hinge.z + 0.15 },
          { x: ax + side * rimW * 0.55, y: anchor.y + 0.25, z: hinge.z - 0.35 },
          { x: ax + side * rimW * 0.95, y: anchor.y + 0.2, z: hinge.z - 1.5 },
        ],
        roundedRectProfile(rimW * 0.92, rimT * 0.82, rimT * 0.3, 3),
        { closed: false },
      );
      add(side > 0 ? "endR" : "endL", endpieceRole, ep);
    }

    if (s.hinge) {
      const hx = ax + side * rimW * 1.02;
      const hw = metalTemple ? 1.7 : 2.5;
      const hg = sweep(
        [
          { x: hx - side * 0.2, y: hinge.y, z: hinge.z - 0.2 },
          { x: hx + side * hw, y: hinge.y, z: hinge.z - 0.2 },
        ],
        roundedRectProfile(rimT * 0.86, rimT * 1.02, rimT * 0.32, 3),
        { closed: false },
      );
      add(side > 0 ? "hingeR" : "hingeL", "metal", hg);
      // پیچ لولا (دو نقطهٔ ریز روی بیرون فریم)
      for (const dz of [-0.55, 0.55]) {
        const screw = sweep(
          [
            { x: hx + hw * 0.5, y: hinge.y + dz * 0.1, z: hinge.z + rimT * 0.5 + dz },
            { x: hx + hw * 0.5, y: hinge.y + dz * 0.1, z: hinge.z + rimT * 0.78 + dz },
          ],
          ellipseProfile(0.55, 0.55, 6),
          { closed: true },
        );
        add(side > 0 ? "screwR" : "screwL", "accent", screw);
      }
    }

    // مسیر دسته: از لولا به عقب، با پاشش بیرون و خم پشت گوش
    const L = s.templeLen;
    const sp = Math.tan(s.splayDeg * D2R);
    const yStart = hinge.y;
    const bendAt = Math.max(0.5, Math.min(0.95, s.earBendAt));
    const pts = [
      { x: hinge.x + side * 0.4, y: yStart, z: hinge.z - 0.6 },
      { x: hinge.x + side * (1.6 + sp * 8), y: yStart - 0.3, z: hinge.z - 12 },
      { x: hinge.x + side * (2.6 + sp * 34), y: yStart - 1.1, z: hinge.z - 46 },
      { x: hinge.x + side * (3.4 + sp * 58), y: yStart - 2.2, z: hinge.z - 78 },
      { x: hinge.x + side * (3.9 + sp * L * 0.78), y: yStart - 3.4, z: hinge.z - L * bendAt },
      {
        x: hinge.x + side * (4.1 + sp * L * 0.82),
        y: yStart - 3.9 - s.earDrop * 0.25,
        z: hinge.z - (L * bendAt + (L - L * bendAt) * 0.42),
      },
      {
        x: hinge.x + side * (3.9 + sp * L * 0.8),
        y: yStart - 3.9 - s.earDrop,
        z: hinge.z - L * 0.985,
      },
      { x: hinge.x + side * (3.5 + sp * L * 0.72), y: yStart - 4.6 - s.earDrop * 1.35, z: hinge.z - L },
    ];
    const tp = cr3(pts, 16);
    const tipStart = 0.74;
    const templeRole = metalTemple ? "metal" : "frame";
    // پروفیل دسته: x = ضخامت (در راستای سر)، y = ارتفاعِ دیده‌شده از روبه‌رو
    const profFrame = (t) => {
      const k = 1 - (1 - s.templeTaper) * t;
      return roundedRectProfile(s.templeT * k, s.templeW * k, s.templeT * 0.42 * k, 3);
    };
    const profWire = (t) => {
      const k = 1 - (1 - s.templeTaper) * t;
      return ellipseProfile(1.7 * k + 0.4, 1.45 * k + 0.35, 8);
    };

    const swT = Math.max(s.templeW, s.templeT);
    if (metalTemple) {
      const metalEnd = Math.floor(tp.length * tipStart) + 1;
      const metalPart = tp.slice(0, metalEnd);
      add(side > 0 ? "templeR" : "templeL", "metal", sweep(metalPart, profWire(0), { closed: false }), {
        path: metalPart,
        sw: 1.8,
      });
      const tipPart = tp.slice(metalEnd - 1);
      if (tipPart.length > 3)
        add(side > 0 ? "tipR" : "tipL", "frame", sweep(tipPart, profFrame(0.8), { closed: false }), {
          path: tipPart,
          sw: s.templeW,
        });
    } else {
      const mainEnd = Math.floor(tp.length * tipStart) + 1;
      const main = tp.slice(0, mainEnd);
      add(side > 0 ? "templeR" : "templeL", templeRole, sweep(main, profFrame(0), { closed: false }), {
        path: main,
        sw: swT,
      });
      const tipPart = tp.slice(mainEnd - 1);
      if (tipPart.length > 3)
        add(
          side > 0 ? "tipR" : "tipL",
          "frameTip",
          sweep(tipPart, roundedRectProfile(s.templeT * 1.42, s.templeW * 1.08, s.templeT * 0.6, 3), { closed: false }),
          { path: tipPart, sw: swT * 1.15 },
        );
    }

    // پد بینی (فریم فلزی) یا بالشتک یکپارچهٔ استات
    if (s.nosePads || isMetal || s.style === "rimless") {
      const inX = s.dbn * 0.34 + 1.2;
      const topY = -halfH * (s.highBridge ? 0.35 : 0.52);
      const zTop = -dome(-s.dbn * 0.3, topY) + rimT * 0.25;
      const arm = cr3(
        [
          { x: side * inX * 0.72, y: topY, z: zTop },
          { x: side * (inX + 1.5), y: topY - 2.4, z: zTop + 1.9 },
          { x: side * (inX + 2.6), y: topY - 4.9, z: zTop + 3.1 },
        ],
        8,
      );
      add(side > 0 ? "padArmR" : "padArmL", "metal", sweep(arm, ellipseProfile(0.95, 0.95, 6), { closed: false }));
      const padGeo = roundedBox(2.0, 6.4, 1.5, 0.72, 0, 0, 0, 3);
      add(
        side > 0 ? "padR" : "padL",
        "pad",
        moveGeo(padGeo, side * (inX + 3.3), topY - 5.6, zTop + 3.5, { ry: side * -0.34, rz: side * 0.1 }),
      );
    }
  }

  // ── ۴. تراز و چرخش‌های کلی ────────────────────────────────────────────
  const roles = {};
  const meta = {
    totalWidth: s.totalWidth,
    lensW: s.lensW,
    dbn: s.dbn,
    templeLen: s.templeLen,
    lensCenters: [lensCX, -lensCX],
    // محلِ مرجع برای چسبیدن به بینی (ارتفاع مرکز لنز نسبت به پل)
    bridgeY: -halfH * s.bridgeDrop,
    // نیم‌پهنای فریم تا بیرونِ لولا (mm) — مرز پهنای «سر نامرئی» که دسته‌ها را می‌بُرد
    hingeX: +hingeX.toFixed(2),
    height: 0,
    depth: 0,
  };
  let bbox = null;
  for (const part of parts) {
    let g = part.geo;
    g = rotateX(g, panto);
    part.geo = g;
    if (part.path) part.path = part.path.map((p) => rotateXYZ(p, panto));
    roles[part.role] = roles[part.role] ? mergeGeo(roles[part.role], g) : { ...g };
  }
  for (const k of Object.keys(roles)) {
    bbox = bbox ? unionBox(bbox, bounds(roles[k])) : bounds(roles[k]);
  }
  if (!bbox) bbox = { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  meta.center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
  meta.min = bbox.min;
  meta.max = bbox.max;
  // مرکز هندسی را روی x,y در مبدأ بگذار تا چرخش‌ها تمیز باشند
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  meta.bboxCenterX = cx;
  meta.size = bbox.size;
  meta.tris = Object.values(roles).reduce((a, r) => a + r.index.length / 3, 0);
  meta.silhouette = parts
    .filter((p) => p.path && p.path.length > 3 && p.role !== "lens" && p.role !== "pad" && p.role !== "accent")
    .map((p) => ({ name: p.name, path: p.path, sw: p.sw || 3, role: p.role }));
  return { roles, bbox, meta, parts, spec: s };
}

function unionBox(a, b) {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    size: [
      Math.max(a.max[0], b.max[0]) - Math.min(a.min[0], b.min[0]),
      Math.max(a.max[1], b.max[1]) - Math.min(a.min[1], b.min[1]),
      Math.max(a.max[2], b.max[2]) - Math.min(a.min[2], b.min[2]),
    ],
  };
}

/** عدسی: سطح کاسه‌ای از خط داخلی + کمی برآمدگی */
function lensSurface(path, R, s) {
  // Concentric rings, not a single triangle fan: smooth spherical glass with
  // normals matching its actual surface and CCW front faces (toward the camera).
  const N = path.length, rings = 10;
  const position = [], normal = [], uv = [], index = [];
  const cx = (Math.min(...path.map(p => p.x)) + Math.max(...path.map(p => p.x))) / 2;
  const cy = (Math.min(...path.map(p => p.y)) + Math.max(...path.map(p => p.y))) / 2;
  const add = (x, y) => {
    const dx = x - cx, dy = y - cy;
    const nz = Math.sqrt(Math.max(1, R * R - dx * dx - dy * dy));
    position.push(x, y, 0.35 - (R - nz));
    const length = Math.hypot(dx, dy, nz);
    normal.push(dx / length, dy / length, nz / length);
    uv.push(dx / s.lensW + 0.5, dy / s.lensH + 0.5);
  };
  add(cx, cy);
  for (let ring = 1; ring <= rings; ring++) {
    for (const p of path) add(cx + (p.x - cx) * ring / rings, cy + (p.y - cy) * ring / rings);
  }
  const area = path.reduce((sum, p, i) => {
    const n = path[(i + 1) % N];
    return sum + p.x * n.y - n.x * p.y;
  }, 0);
  const tri = (a, b, c) => area > 0 ? index.push(a, b, c) : index.push(a, c, b);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    tri(0, 1 + i, 1 + j);
    for (let ring = 1; ring < rings; ring++) {
      const a = 1 + (ring - 1) * N, b = a + N;
      tri(a + i, b + i, b + j);
      tri(a + i, b + j, a + j);
    }
  }
  return { position, normal, uv, index, vertexCount: position.length / 3 };
}

/** طولانی‌ترین بازهٔ پیوسته از نقاطِ یک منحنی بسته که شرط را دارند (نیم‌فریم/ابرو). */
export function pickRange(pts, test) {
  const n = pts.length;
  let start = -1;
  for (let i = 0; i < n; i++)
    if (!test(pts[i])) {
      start = i;
      break;
    }
  if (start < 0) return pts.slice();
  const out = [];
  for (let k = 1; k <= n; k++) {
    const p = pts[(start + k) % n];
    if (test(p)) out.push(p);
    else if (out.length) break;
  }
  return out;
}

function anchorOuter(raw, side) {
  let best = raw[0],
    score = -Infinity;
  for (const p of raw) {
    const sc = p.x * side * 1.0 + p.y * 0.55; // بیرونی و کمی بالا
    if (sc > score) {
      score = sc;
      best = p;
    }
  }
  const r2 = best.x ** 2 + best.y ** 2;
  void r2;
  return { x: best.x, y: best.y, z: 0 };
}

function anchorInner(raw, side) {
  let best = raw[0],
    score = Infinity;
  for (const p of raw) {
    const sc = p.x * side - p.y * 0.2;
    if (sc < score) {
      score = sc;
      best = p;
    }
  }
  return { x: best.x, y: best.y * 0.35, z: 0.4 };
}

/** بالاترین نقطهٔ منحنی (برای جای‌گذاری نوار بالایی خلبانی). */
function topOf(pts) {
  let best = pts[0];
  for (const p of pts) if (p.y > best.y) best = p;
  return best.y;
}
const rawTop = (s) => lensOutline(s, 1, 120);

/** انتقال + چرخشِ سادهٔ یک هندسه (برای پد بینی و قطعات ریز). */
function moveGeo(g, dx = 0, dy = 0, dz = 0, { rx = 0, ry = 0, rz = 0 } = {}) {
  const rot = (v, a, ax) => {
    const c = Math.cos(a),
      s2 = Math.sin(a);
    if (ax === "x") return [v[0], v[1] * c - v[2] * s2, v[1] * s2 + v[2] * c];
    if (ax === "y") return [v[0] * c + v[2] * s2, v[1], -v[0] * s2 + v[2] * c];
    return [v[0] * c - v[1] * s2, v[0] * s2 + v[1] * c, v[2]];
  };
  const out = {
    position: new Array(g.position.length),
    normal: new Array(g.normal.length),
    uv: g.uv.slice(),
    index: g.index.slice(),
    vertexCount: g.vertexCount,
  };
  const map = (x, y, z) => {
    let v = [x, y, z];
    if (rx) v = rot(v, rx, "x");
    if (ry) v = rot(v, ry, "y");
    if (rz) v = rot(v, rz, "z");
    return [v[0] + dx, v[1] + dy, v[2] + dz];
  };
  for (let i = 0; i < g.position.length; i += 3) {
    const [x, y, z] = map(g.position[i], g.position[i + 1], g.position[i + 2]);
    out.position[i] = x;
    out.position[i + 1] = y;
    out.position[i + 2] = z;
    const [a, b, c] = map(g.normal[i], g.normal[i + 1], g.normal[i + 2]);
    out.normal[i] = a;
    out.normal[i + 1] = b;
    out.normal[i + 2] = c;
  }
  return out;
}

function ellipseOutline(w, h, seg = 24) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * h * 0.5 });
  }
  return pts;
}
