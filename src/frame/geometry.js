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
  /** لبهٔ داخلی لنز در مختصات قاب (محل رسیدن فریم به پل) */
  const innerX = Math.max(s.dbn * 0.5 + 0.6, lensCX - s.lensW / 2 + rimWEarly(s) * 0.3);
  const outerX = lensCX + s.lensW / 2 - rimWEarly(s) * 0.3;
  const R = wrapRadius(s.baseCurve);
  const panto = -s.pantoDeg * D2R;
  const isMetal = !!s.metal;
  const rimW = isMetal ? s.metalRimW : s.rimW;
  const rimT = isMetal ? s.metalRimT : s.rimT;

  /** zِ سطح لنز در مختصات موضعی لنز (فریم چرخیدهٔ دور چشم) */
  const dome = (x, y) => {
    const r2 = x * x + y * y;
    return r2 < R * R ? R - Math.sqrt(R * R - r2) : R;
  };

  // ── . دور لنز (rim) ────────────────────────────────────────────────
  // اگر خطِ دنبالی‌شده از عکس محصول داده شود، همان را جای منحنی پایه می‌گذاریم
  const externalOutline = (side, samples) => {
    const lp = side > 0 ? s.lensPathR || s.lensPath : s.lensPathL || s.lensPath;
    if (!lp) return null;
    const pts = lp.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
    return resample(pts, samples, true);
  };
  for (const side of [1, -1]) {
    const raw = externalOutline(side, 260) || lensOutline(s, side, 260);
    const outer = resample(smoothPts(raw, 1), s.style === "rimless" ? 4 : 132, true);
    const path = outer.map((p) => {
      const lx = p.x - side * (s.lensW / 2) * 0; // مرکز لنز در مختصات خودش
      return { x: p.x, y: p.y, z: -dome(lx, p.y) * 1.0 };
    });
    if (s.style !== "rimless") {
      // نیمهٔ پایین / بالا برای half & brow
      const all = path;
      let use = all;
      let profile = roundedRectProfile(rimW, rimT, rimW * 0.5 * s.bevel + 0.2, 4);
      if (s.style === "half") {
        use = pickRange(all, (p) => p.y < halfH * 0.18);
        if (!use.length) use = all.slice(0, Math.floor(all.length / 2));
      } else if (s.style === "brow") {
        use = pickRange(all, (p) => p.y > -halfH * 0.1);
        profile = roundedRectProfile(rimW * 1.35, rimT * 1.25, rimW * 0.45, 4);
      }
      const role = s.style === "brow" ? "frame" : isMetal ? "metal" : "frame";
      if (s.style === "brow") {
        const lowPath = pickRange(all, (p) => p.y <= -halfH * 0.06).map((p) => ({
          x: p.x + side * lensCX,
          y: p.y,
          z: p.z + 0.35,
        }));
        if (lowPath.length > 5)
          add(
            side > 0 ? "lowrimR" : "lowrimL",
            "metal",
            sweep(lowPath, roundedRectProfile(1.7, 1.4, 0.5, 3), { closed: false }),
          );
      }
      const rimPath = use.map((p) => ({ x: p.x + side * lensCX, y: p.y, z: p.z }));
      if (rimPath.length > 6) {
        add(side > 0 ? "rimR" : "rimL", role, sweep(rimPath, profile, { closed: s.style === "full" }), {
          path: rimPath,
          sw: Math.max(rimW, rimT),
        });
      }
      // سیم نایلونی بالای عدسی در نیم‌فریم
      if (s.style === "half") {
        const cordPath = pickRange(all, (p) => p.y >= halfH * 0.18).map((p) => ({
          x: p.x + side * lensCX,
          y: p.y,
          z: p.z + rimT * 0.28,
        }));
        if (cordPath.length > 4)
          add(side > 0 ? "cordR" : "cordL", "metal", sweep(cordPath, ellipseProfile(0.7, 0.7, 6), { closed: false }));
      }
      // عدسی
      const inner = resample(offsetOutline(raw, -rimW * (s.style === "half" ? 0.35 : 0.9)), 96, true);
      const capPath = inner.map((p) => ({ x: p.x + side * lensCX, y: p.y, z: -dome(p.x, p.y) + 0.35 }));
      add(side > 0 ? "lensR" : "lensL", "lens", lensSurface(capPath, R, s));
    } else {
      // فریم بدون حلقه: عدسی کمی بزرگ‌تر و سوراخ‌شده
      const inner = resample(offsetOutline(raw, -0.6), 96, true);
      const capPath = inner.map((p) => ({ x: p.x + side * lensCX, y: p.y, z: -dome(p.x, p.y) + 0.35 }));
      add(side > 0 ? "lensR" : "lensL", "lens", lensSurface(capPath, R, s));
    }
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
    const bw = isMetal ? (s.bridgeStyle === "keyhole" ? 1.35 : 1.5) : rimW * (s.style === "rimless" ? 0.45 : 1.0);
    const prof = isMetal
      ? ellipseProfile(bw, 2.5, 8)
      : roundedRectProfile(rimW * (s.style === "rimless" ? 0.8 : 1.05), rimT * 0.9, rimT * 0.32, 3);
    add("bridge", isMetal || s.style === "rimless" ? "metal" : "frame", sweep(path, prof, { closed: false }), {
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
      add("topbar", "metal", sweep(top, ellipseProfile(1.5, 1.5, 8), { closed: false }));
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
      add(side > 0 ? "endR" : "endL", isMetal ? "metal" : "frame", ep);
    }

    if (s.hinge) {
      const hx = ax + side * rimW * 1.02;
      const hw = isMetal ? 1.7 : 2.5;
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
    const templeRole = isMetal ? "metal" : "frame";
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
    if (isMetal) {
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
    if (s.nosePads || isMetal) {
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
    .map((p) => ({ path: p.path, sw: p.sw || 3, role: p.role }));
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
  const N = path.length;
  const position = [],
    normal = [],
    uv = [],
    index = [];
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of path) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  cx /= N;
  cy /= N;
  cz /= N;
  const nz = (x, y, z) => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  position.push(cx, cy, cz + 1.35);
  normal.push(0, 0, 1);
  uv.push(0.5, 0.5);
  for (let i = 0; i < N; i++) {
    const p = path[i];
    // برآمدگی کروی + ضخامت لبه
    const r2 = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    const Reff = Math.max(70, R * 2.2);
    const z = p.z + 1.35 - r2 / (2 * Reff);
    position.push(p.x, p.y, z);
    normal.push(...nz((p.x - cx) / Reff, (p.y - cy) / Reff, 1));
    uv.push((p.x - cx) / s.lensW + 0.5, (p.y - cy) / s.lensH + 0.5);
  }
  for (let i = 0; i < N; i++) index.push(0, 1 + ((i + 1) % N), 1 + i);
  return { position, normal, uv, index, vertexCount: N + 1 };
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
