/**
 * موتور مستقل نشست عینک — فقط ریاضی قابل‌آزمون، بدون DOM یا Three.js.
 * ورودی‌ها در پیکسل/میلی‌مترند و خروجی برای Stage آماده است.
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function solveWearableScale({ eyeSpanPx, pdMm, faceWidthPx, projectedAxis = 1 }) {
  const axis = clamp(Number(projectedAxis) || 1, 0.45, 1);
  const pd = clamp(Number(pdMm) || 63, 48, 82);
  const optical = Math.max(0.01, Number(eyeSpanPx) || 0) / (pd * axis);
  const facial = Math.max(1, Number(faceWidthPx) || 1) / (140 * axis);
  const ratio = optical / facial;
  const scale = clamp(optical, facial * 0.82, facial * 1.18);
  return {
    scale,
    optical,
    facial,
    agreement: ratio > 0 ? Math.min(ratio, 1 / ratio) : 0,
    constrained: Math.abs(scale - optical) > 1e-6,
  };
}

export function solveBridgeSeat(pose, spec) {
  const noseW = Number(pose?.noseWmm);
  const dbn = Number(spec?.dbn);
  if (!(noseW > 8) || !(dbn > 5)) {
    return { yMm: 0, zMm: 0, ratio: null, weight: 0, confidence: "unknown" };
  }
  const ratio = dbn / noseW;
  const profile = Math.max(
    Math.abs(Number(pose.quality?.yaw) || 0),
    Math.abs(Number(pose.quality?.visualYaw) || 0),
  );
  const viewWeight = clamp(1 - profile / 0.72, 0.18, 1);
  const calibrationWeight = pose.pdLocked || pose.autoPd === false ? 1 : 0.72;
  const weight = viewWeight * calibrationWeight;
  return {
    yMm: clamp((0.68 - ratio) * 12, -2.5, 2.5) * weight,
    zMm: clamp((ratio - 0.68) * 4, -1, 1) * weight,
    ratio,
    weight,
    confidence: weight > 0.84 ? "high" : weight > 0.35 ? "estimated" : "low",
  };
}

// ══════════════════════════════════════════════════════════════════════════
// نشستنِ فریم روی صورت — بر پایهٔ مشِ کاملِ صورت (۴۶۸ نقطه) و سطحِ پوست
// ══════════════════════════════════════════════════════════════════════════
//
// روشِ قدیمی: مبدأِ فریم (مرکزِ پل) روی «میانهٔ گوشه‌های داخلیِ چشم» گذاشته
// می‌شد و مقیاس از PD/پهنای صورت حدس زده می‌شد. نتیجه‌اش سه خطای دیداری بود:
//   ۱) پل روی بینی نمی‌نشست (شناور می‌ماند)،
//   ۲) اندازهٔ فریم ۶ تا ۹ درصد بزرگ‌تر از صورت بود،
//   ۳) رول/پیچِ فریم با سر هم‌راستا نبود.
//
// روشِ این‌جا (همان کاری که اپتومتریست می‌کند):
//   ۱) سرِ کانونیک روی همهٔ ۴۶۸ لندمارک برازش می‌شود (head-fit.js) ⇒ چرخشِ
//      سه‌بعدی، مقیاسِ متریک (px/mm) و مرکز، با کمینه‌کردنِ خطای بازتصویر.
//   ۲) «نقطه‌های تکیه‌گاه» فریم (پل و بالشتک‌ها) از خودِ مشِ فریم گرفته می‌شود.
//   ۳) فاصلهٔ رأس (vertex distance) هدف ۱۲–۱۵ میلی‌متر از قرنیه است؛ ارتفاعِ
//      نشستن طوری حل می‌شود که پل *دقیقاً* روی سطحِ بینی بنشیند و همین فاصله
//      رأس حفظ شود. این‌طور پل نه شناور می‌ماند و نه در پوست فرو می‌رود.
//   ۴) در پایان، «حسابرسیِ نشست» روی صدها نقطهٔ فریم انجام می‌شود: کمترین
//      فاصله از پوست، تعدادِ نقاطِ فرورفته و محلِ تماس گزارش می‌شود.

import { buildFrame } from "../frame/geometry.js";
import { fitCanonicalHead, headToPx, EYE, POSE_ANCHOR, quatRotate, matFromQuat } from "./head-fit.js";
import { CANONICAL_MM } from "./face-topology.js";
import { surfaceZ, noseGripWidth } from "./face-surface.js";
import { bounds } from "../frame/sweep.js";

const FIT_CACHE = new WeakMap(); // spec → { built, contact }
const clamp2 = (v, a, b) => (v < a ? a : v > b ? b : v);
const NOSE_MID_IDS = [168, 6, 197, 195, 5, 4, 1, 2];
const BROW_IDS = [105, 334, 66, 296, 65, 295];

/**
 * ساخت/کش هندسهٔ فریم و استخراجِ «سطحِ پشتیِ فریم» در ناحیهٔ بینی.
 *
 * برای هر خانهٔ ۱٫۶ میلی‌متریِ (x,y) در ناحیهٔ «صفحهٔ بینی» عقب‌ترین zِ فریم
 * نگه داشته می‌شود؛ همان سطحی که به پوست نگاه می‌کند. این‌طور به‌جای چند نقطهٔ
 * دستی، صدها نقطه از پل، لبهٔ داخلیِ حلقه و بالشتک وارد حلِ نشستن می‌شوند.
 *
 * نکته: فقط ناحیهٔ *بالای* بینی (ریشه و کناره‌های بالایی) نقطهٔ تکیه‌گاه است.
 * لبهٔ پایینِ حلقه اگر روی نوکِ بینی بیفتد در واقعیت روی پوست می‌نشیند و بینی
 * جلوی آن را می‌گیرد؛ آن را «تماسِ بینی» گزارش می‌کنیم نه تکیه‌گاهِ ارتفاع.
 */
export function seatAnchors(spec) {
  if (!spec || typeof spec !== "object") return null;
  const hit = FIT_CACHE.get(spec);
  if (hit) return hit;
  const built = buildFrame(spec);
  const meta = built.meta;
  const halfW = (Number(meta.dbn) || 18) / 2;
  const lensH = Number(meta.lensW ? spec.lensH || 42 : 42);
  const noseReach = halfW + 6.5;
  const topLimit = lensH * 0.22; // پایین‌ترین ارتفاعِ مجازِ تکیه‌گاه (نسبت به مرکز لنز)
  const CELL = 1.6;
  const cells = new Map();
  let bridgeCells = 0;
  let padCells = 0;
  for (const part of built.parts) {
    if (!part.geo || !part.geo.position) continue;
    if (part.role === "lens" || part.role === "lensEdge") continue;
    if (/^temple|^tip|^hinge|^endpiece|Mount/.test(part.name)) continue;
    const pos = part.geo.position;
    const isBridge = part.name === "bridge";
    const isPad = part.role === "pad";
    if (!isBridge && !isPad && !/^rim/i.test(part.name) && part.role !== "metal" && part.role !== "accent") continue;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (Math.abs(x) > noseReach || y < -topLimit) continue;
      const k = Math.round(x / CELL) + "," + Math.round(y / CELL);
      const c = cells.get(k);
      // پل و بالشتک باید *لمس* کنند؛ لبهٔ داخلیِ حلقه اجازه دارد چند میلی‌متر
      // در بافتِ نرمِ کنارهٔ بینی فرو برود (همان چیزی که در عینکِ تنگ دیده می‌شود).
      const allow = isBridge || isPad ? 0 : 2.4;
      if (!c || z < c.z) cells.set(k, { x, y, z, bridge: isBridge, pad: isPad, allow });
    }
  }
  const support = [...cells.values()];
  for (const c of support) {
    if (c.bridge) bridgeCells++;
    if (c.pad) padCells++;
  }
  const entry = { built, meta, support, bridgeCells, padCells, all: built.parts };
  FIT_CACHE.set(spec, entry);
  return entry;
}

/** سطحِ بینی/صورت در فضایِ سر: بزرگ‌ترین z از دو نیمه (بینی متقارن فرض می‌شود) */
function headSurfaceZ(x, y) {
  const a = surfaceZ(x, y);
  const b = surfaceZ(-x, y);
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return Math.max(a, b);
}

/**
 * کم‌ترین جابه‌جاییِ رو به جلو که همهٔ نقطه‌های تکیه‌گاه را در بیرونِ پوست
 * (یا در حدِ فشارِ مجاز) نگه می‌دارد.
 */
export function contactOffset(points, oy, compress = 0.5) {
  let need = -Infinity;
  let at = null;
  for (const p of points) {
    // xِ فریم = راستِ فرد، xِ مدلِ کانونیک = چپِ تصویر ⇒ قرینه
    const skin = headSurfaceZ(-p.x, oy + p.y);
    if (Number.isNaN(skin)) continue;
    const need_i = skin - p.z - compress - (p.allow || 0);
    if (need_i > need) {
      need = need_i;
      at = { x: +p.x.toFixed(1), y: +(oy + p.y).toFixed(1), skinZ: +skin.toFixed(1), part: p.bridge ? "bridge" : "rim" };
    }
  }
  return { z: need, at };
}

/**
 * نشستنِ فریم روی سرِ برازش‌شده (همهٔ محاسبات در میلی‌مترِ فضایِ سر است).
 * @param {{fit:object, spec:object, pupilLift?:number, maxVd?:number, vertical?:number,
 *          depth?:number, lateral?:number}} o
 */
export function seatOnHead(o) {
  const { fit, spec } = o || {};
  if (!fit || !fit.ok || !(fit.scale > 0)) return null;
  const anchors = seatAnchors(spec);
  const meta = anchors.meta;
  if (!anchors || !anchors.support.length) return null;
  const corneaZ = EYE.corneaZ;
  const lensH = Number(meta.lensH) || Number(spec.lensH) || 42;
  const compress0 = clamp2(o.compress ?? 0.5, 0, 2); // فشارِ مجازِ پوست (mm)
  const canon = fit.canonical || CANONICAL_MM;
  const browTop = Math.max(...BROW_IDS.map((id) => canon[id * 3 + 1]));
  const lift = clamp2(o.pupilLift ?? 1.5, -5, 7);
  const maxVd = clamp2(o.maxVd ?? 16, 11, 24);
  const minVd = clamp2(o.minVd ?? 10.5, 6, maxVd);

  const evaluate = (oy, compress = compress0) => {
    const c = contactOffset(anchors.support, oy, compress);
    const vd = c.z - corneaZ;
    const pupil = EYE.center[1] - oy;
    const brow = Math.max(0, oy + lensH / 2 - (browTop + 2));
    // فاصلهٔ پل از پوست در همین ارتفاع: اگر شناور بماند، هزینه دارد؛ کاربر
    // عینکِ شناور را همان لحظه می‌بیند.
    let gap = null;
    for (const p of anchors.support) {
      if (!p.bridge) continue;
      const skin = headSurfaceZ(-p.x, oy + p.y);
      if (Number.isNaN(skin)) continue;
      const g = p.z + c.z - skin;
      if (gap === null || g < gap) gap = g;
    }
    const float = gap === null ? 0 : Math.max(0, gap - 2.5);
    // هزینه: دیداری (مردمک) + شناوریِ رو به جلو (VD>17) + شناوریِ پل.
    // فرو رفتن در پوست جریمه نمی‌شود چون با فشارِ طبیعیِ بافت جبران می‌شود و
    // در گزارش هم به‌عنوان هشدار می‌آید.
    const cost = (pupil - lift) ** 2 + 0.55 * Math.max(0, vd - 17) ** 2 + 0.9 * float ** 2 + 0.5 * brow ** 2;
    return { oy, z: c.z, at: c.at, vd, pupil, brow, gap, cost };
  };

  // جست‌وجوی یک‌بعدیِ درشت + ریزسازی (تابع صاف است، مینیمم یگانه دارد)
  // مردمک حداکثر ۴٫۵mm بالاتر / ۳mm پایین‌تر از مرکزِ لنز؛ بیرونِ این بازه
  // حتی اگر بینی اجازه بدهد، فریم «بدنشسته» دیده می‌شود.
  const lo = EYE.center[1] - 3.5 + (o.vertical || 0);
  const hi = EYE.center[1] + 6 + (o.vertical || 0);
  const solve = (compress) => {
    let top = null;
    for (let t = lo; t <= hi + 1e-9; t += 0.25) {
      const e = evaluate(t, compress);
      if (!Number.isFinite(e.z)) continue;
      if (!top || e.cost < top.cost) top = e;
    }
    if (!top) return null;
    for (let step = 0.1; step > 0.004; step /= 2) {
      for (const dir of [1, -1]) {
        const e = evaluate(top.oy + dir * step, compress);
        if (Number.isFinite(e.z) && e.cost < top.cost) top = e;
      }
    }
    return top;
  };
  let compress = compress0;
  let best = solve(compress);
  if (!best) return null;
  // اگر فاصلهٔ رأس از بازهٔ طبیعی بیرون زد، اجازهٔ فرورفتن در بافت را زیاد
  // می‌کنیم تا فریم به صورت نزدیک بماند (شناوریِ چند سانتی‌متری بدترین خطای
  // دیداری است؛ فشارِ ۲ تا ۴ میلی‌متری روی بینی همان چیزی است که واقعاً رخ می‌دهد).
  for (let i = 0; i < 3 && best.z - corneaZ > 17.5; i++) {
    compress = Math.min(4.5, compress + (best.z - corneaZ - 17.5) + 0.6);
    const next = solve(compress);
    if (!next) break;
    best = next;
  }
  const oy = best.oy;
  let oz = best.z + (o.depth || 0);

  // ── پاسِ «بدونِ فرورفتگی»: تا وقتی نقطه‌ای بیش از ۰٫۶mm داخلِ پوست است،
  // فریم را کمی جلو می‌بریم. این تضمین می‌کند نتیجه هرگز «توی صورت» نباشد.
  let clipFixed = 0;
  for (let i = 0; i < 4; i++) {
    const w = worstPenetration(anchors, oy, oz, 0);
    if (!w || w.clear > -0.6) break;
    const push = -w.clear - 0.6 + 0.25;
    oz += push;
    clipFixed += push;
  }

  // ── جانبی: انحرافِ خطِ وسطِ بینی از مدل (باقی‌ماندهٔ لندمارک‌های میانی) ──
  const R = matFromQuat(fit.q);
  const ax = R[0], ay = R[3];
  const ax2 = ax * ax + ay * ay || 1;
  let du = 0, dv = 0, wn = 0;
  for (const id of NOSE_MID_IDS) {
    if (!fit.observed) break;
    const cx = canon[id * 3], cy = canon[id * 3 + 1], cz = canon[id * 3 + 2];
    const u = fit.scale * (R[0] * cx + R[1] * cy + R[2] * cz) + fit.tx;
    const v = fit.scale * (R[3] * cx + R[4] * cy + R[5] * cz) + fit.ty;
    du += fit.observed[id * 3] - u;
    dv += fit.observed[id * 3 + 1] - v;
    wn++;
  }
  const ox = wn ? clamp2((du * ax + dv * ay) / (wn * fit.scale * ax2), -6, 6) : 0;
  const oxSeat = clamp2(ox + (o.lateral || 0), -9, 9);

  // آیا پل واقعاً پوست را لمس می‌کند یا شناور است؟
  let bridgeGap = null;
  for (const p of anchors.support) {
    if (!p.bridge) continue;
    const skin = headSurfaceZ(-p.x, oy + p.y);
    if (Number.isNaN(skin)) continue;
    const gap = p.z + oz - skin;
    if (bridgeGap === null || gap < bridgeGap) bridgeGap = gap;
  }
  const audit = auditSeat(anchors, oy, oz, oxSeat);

  // پهنای بینی در ارتفاعِ همان جایی که فریم می‌گیرد ⇒ سنجشِ درستیِ پلِ فریم
  const gripY0 = oy - Math.max(3, lensH * 0.08);
  const gripY1 = oy + Math.max(4, lensH * 0.12);
  const noseWidth = noseGripWidth(gripY0, gripY1);
  const dbn = Number(anchors.meta.dbn) || 18;
  const warnings = [];
  const vdOut = oz - corneaZ;
  if (audit.worst && audit.worst.clear < -1.2) warnings.push("rim-pressure");
  if (vdOut > 19) warnings.push("vertex-distance");
  if (bridgeGap !== null && bridgeGap > 4) warnings.push("bridge-float");
  if (fit.confidence < 0.45) warnings.push("low-confidence");
  void dbn;
  return {
    ox: oxSeat, oy, oz, q: fit.q, scale: fit.scale,
    report: {
      vd: +vdOut.toFixed(2),
      seatY: +oy.toFixed(2),
      pupilOffset: +(EYE.center[1] - oy).toFixed(2),
      lensTopToBrow: +(oy + lensH / 2 - browTop).toFixed(2),
      bridgeY: +anchors.meta.bridgeY.toFixed(2),
      bridgeZ: +anchors.meta.bridgeZ.toFixed(2),
      contact: best.at,
      midline: +oxSeat.toFixed(2),
      penetration: audit.penetration,
      bridgeGap: bridgeGap === null ? null : +bridgeGap.toFixed(2),
      pressure: +compress.toFixed(2),
      clipFixed: +clipFixed.toFixed(2),
      noseWidth: +noseWidth.toFixed(1),
      warnings,
      minClearance: audit.minClearance,
      samples: audit.samples,
      confidence: fit.confidence,
      rmsMm: +fit.rmsMm.toFixed(2),
      source: "dense-468",
    },
  };
}

/** بدترین فرورفتگیِ رأس‌های فریم در پوست (بدونِ جانبی) */
function worstPenetration(anchors, oy, oz, ox) {
  let worst = null;
  const seen = new Set();
  for (const part of anchors.all) {
    if (!part.geo || !part.geo.position) continue;
    if (part.role === "pad") continue;
    const pos = part.geo.position;
    const step = Math.max(1, Math.floor(pos.length / 3 / 260)) * 3;
    for (let i = 0; i < pos.length; i += step) {
      const x = pos[i] + ox, y = pos[i + 1] + oy, z = pos[i + 2] + oz;
      if (Math.abs(x) > 46 || z < 20) continue;
      const key = `${Math.round(x / 2)},${Math.round(y / 2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const skin = headSurfaceZ(x, y);
      if (Number.isNaN(skin)) continue;
      const clear = z - skin;
      if (!worst || clear < worst.clear) worst = { x: +x.toFixed(1), y: +y.toFixed(1), clear: +clear.toFixed(2) };
    }
  }
  return worst;
}

/**
 * حسابرسیِ برخوردِ فریم با پوست: برای همهٔ رأس‌های جلوییِ فریم (بدون دسته‌ها)
 * بررسی می‌کند آیا داخلِ پوست رفته‌اند یا نه.
 */
export function auditSeat(anchors, oy, oz, ox = 0) {
  if (!anchors) return { samples: 0, penetration: 0, minClearance: null, worst: null };
  let samples = 0, penetration = 0, minClearance = Infinity, worst = null;
  const seen = new Set();
  for (const part of anchors.all) {
    if (!part.geo || !part.geo.position) continue;
    if (part.role === "pad") continue; // بالشتک باید روی پوست باشد
    const pos = part.geo.position;
    const step = Math.max(1, Math.floor(pos.length / 3 / 220)) * 3;
    for (let i = 0; i < pos.length; i += step) {
      const x = pos[i] + ox, y = pos[i + 1] + oy, z = pos[i + 2] + oz;
      if (Math.abs(x) > 58) continue; // دسته/لولا: پشتِ گونه، نه جلوی صورت
      if (z < 20) continue; // بخش‌های عقب (دسته)
      const key = `${Math.round(x / 2)},${Math.round(y / 2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = headSurfaceZ(x, y);
      if (Number.isNaN(s)) continue;
      samples++;
      const clear = z - s;
      if (clear < minClearance) { minClearance = clear; worst = { x: +x.toFixed(1), y: +y.toFixed(1), clear: +clear.toFixed(2) }; }
      if (clear < -1.0) penetration++;
    }
  }
  return {
    samples,
    penetration,
    minClearance: Number.isFinite(minClearance) ? +minClearance.toFixed(2) : null,
    worst,
  };
}

/** نمایندهٔ «سرِ کانونیک» برای وقتی که برازشِ شخصی نداریم (هندسه یکسان است) */
const CANON_STUB = {
  ok: true, q: [0, 0, 0, 1], scale: 1, tx: 0, ty: 0, observed: null,
  confidence: 0.35, rmsMm: 0, canonical: null, euler: { pitch: 0, yaw: 0, roll: 0 }, yaw: 0, pitch: 0, roll: 0,
};
const OFFSET_CACHE = new WeakMap();

/**
 * آفستِ نشستنِ فریم در فضایِ سر (mm) — مستقل از تصویر، فقط تابعِ هندسهٔ فریم.
 * مدلِ سر کانونیک است، پس یک‌بار برای هر spec حساب و کش می‌شود.
 */
export function seatOffsetsFor(spec) {
  if (!spec || typeof spec !== "object") return null;
  const hit = OFFSET_CACHE.get(spec);
  if (hit) return hit;
  const seat = seatOnHead({ fit: CANON_STUB, spec });
  if (seat) seat.meta = seatAnchors(spec)?.meta || null;
  OFFSET_CACHE.set(spec, seat);
  return seat;
}

/**
 * مبدأِ فریم روی سر (mm) برای همین فریم — همان جایی که `seatOnHead` می‌نشاند.
 * مسیرِ دسته (`ear-fit`) با همین مبدأ ساخته می‌شود تا نوکِ دسته پشتِ گوشِ
 * همان سر بیفتد، نه چند میلی‌متر جلوتر.
 * @param {object} spec
 * @returns {{ox:number, oy:number, oz:number}|null}
 */
export function specHeadOrigin(spec) {
  const seat = seatOffsetsFor(spec);
  if (!seat) return null;
  return { ox: seat.ox || 0, oy: seat.oy, oz: seat.oz };
}

/**
 * آفستِ فضایِ سر → مختصاتِ صحنهٔ Stage (پیکسلِ مرکز‌مبدأ، y بالا).
 *
 * قرارداد: `pose.x/y` جای «میانهٔ گوشه‌های چشم، ۱۳mm جلوتر» است (همان لنگرِ
 * FaceTracker). پس آفستِ نشستن نسبت به همان لنگر سنجیده می‌شود و با چرخشِ
 * سَمت‌شدهٔ pose می‌چرخد. مقیاسِ S = scale·k طوری انتخاب می‌شود که اندازهٔ
 * فریم روی تصویر دقیقاً با فاصلهٔ لندمارک‌ها هم‌خوان باشد.
 */
export function seatToPose(seat, pose, W, H, opts = {}) {
  if (!seat || !pose) return null;
  const camZ = Number(opts.camZ || pose.camZ) || 900;
  const z0 = Number(pose.z) || 0;
  const k = clamp2((camZ - z0) / camZ, 0.4, 1.4);
  const faceScale = Number(opts.scale || pose.headFit?.scale || pose.scale) || 4;
  const S = faceScale * k;
  const vg = Number(opts.vgMm ?? pose.vgMm ?? 13);
  const d = [
    seat.ox - POSE_ANCHOR[0],
    seat.oy - POSE_ANCHOR[1],
    seat.oz - POSE_ANCHOR[2] - vg,
  ];
  const q = (opts.q || pose.q || [0, 0, 0, 1]).slice();
  const r = quatRotate(q, d);
  return {
    x: ((Number(pose.x) || W / 2) - W / 2) * k + S * r[0],
    y: (H / 2 - (Number(pose.y) || H / 2)) * k + S * r[1],
    z: z0 + S * r[2],
    q,
    scale: S,
    report: { ...(seat.report || {}), offsetMm: d.map((v) => +v.toFixed(2)) },
  };
}

/**
 * نشستنِ کامل از لندمارک‌های تصویر (مسیرِ ابزارهای آفلاین/تست).
 * برای مسیرِ زنده از `seatOffsetsFor` + `seatToPose` استفاده کنید.
 */
export function buildSeat(o) {
  const pose = o?.pose;
  const spec = o?.spec;
  if (!spec) return null;
  const W = Math.max(1, o.W || pose?.W || 0);
  const H = Math.max(1, o.H || pose?.H || 0);
  let fit = o.fit || pose?.headFit || null;
  if (!fit && pose?.landmarks && W > 1 && H > 1) fit = fitCanonicalHead(pose.landmarks, { W, H });
  const seat = (fit && fit.ok ? seatOnHead({ fit, spec, targetVd: o.vd }) : null) || seatOffsetsFor(spec);
  if (!seat) return null;
  if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)) {
    return seatToPose(seat, pose, W, H, { scale: fit && fit.ok ? fit.scale : undefined });
  }
  // بدونِ pose: تبدیل از راهِ خودِ برازش
  const useFit = fit && fit.ok ? fit : null;
  if (!useFit) return null;
  const camZ = o.camZ || pose?.camZ || 900;
  const [u, v, zRel] = headToPx(useFit, [seat.ox, seat.oy, seat.oz]);
  const k = clamp2((camZ - zRel) / camZ, 0.5, 1.5);
  return {
    x: (u - W / 2) * k,
    y: (v - H / 2) * k,
    z: zRel,
    q: useFit.q,
    scale: useFit.scale * k,
    report: { ...seat.report, k: +k.toFixed(3), px: [+u.toFixed(1), +v.toFixed(1), +zRel.toFixed(2)] },
  };
}

/**
 * گزارشِ نشستن → ردیف‌های «برگهٔ فیت» (همان شکلِ fitReport).
 * این ردیف‌ها از فیزیکِ واقعیِ روی‌صورت می‌آیند، نه از مقایسهٔ اعدادِ کاتالوگ:
 * فاصلهٔ رأس، نشستنِ پل، انحرافِ مردمک و فشارِ حلقه.
 *
 * @param {object} report خروجیِ `seatOnHead`/`seatToPose`
 * @param {"fa"|"en"} lang
 * @returns {Array<{label:string,value:string,hint:string,status:"good"|"warn"|"bad"}>}
 */
export function seatRows(report, lang = "fa") {
  if (!report || !Number.isFinite(report.vd)) return [];
  const fa = lang === "fa";
  const rows = [];
  const status = (ok, warn) => (ok ? "good" : warn ? "warn" : "bad");
  rows.push({
    label: fa ? "فاصلهٔ رأس" : "Vertex distance",
    value: `${report.vd.toFixed(1)} mm`,
    hint: fa
      ? report.vd > 19 ? "فریم از صورت فاصله دارد" : report.vd < 9 ? "فریم به مژه نزدیک است" : report.vd <= 16 ? "در بازهٔ طبیعیِ ۱۰–۱۶" : "کمی جلوتر از بازهٔ طبیعی"
      : report.vd > 19 ? "Frame sits away from the face" : report.vd < 9 ? "Too close to the lashes" : "Natural 10–16 range",
    status: status(report.vd <= 19, report.vd <= 22),
  });
  if (Number.isFinite(report.bridgeGap)) {
    rows.push({
      label: fa ? "نشستنِ پل" : "Bridge seating",
      value: `${report.bridgeGap.toFixed(1)} mm`,
      hint: fa
        ? report.bridgeGap > 4 ? "پل روی بینی نمی‌نشیند؛ پلِ بازتر لازم است" : report.bridgeGap < -1.5 ? "پل در بینی فشار می‌آورد" : "پل روی ریشهٔ بینی نشسته"
        : report.bridgeGap > 4 ? "Bridge floats; needs a wider bridge" : report.bridgeGap < -1.5 ? "Bridge presses into the nose" : "Bridge rests on the nose root",
      status: status(Math.abs(report.bridgeGap) <= 4, Math.abs(report.bridgeGap) <= 8),
    });
  }
  if (Number.isFinite(report.pupilOffset)) {
    rows.push({
      label: fa ? "محلِ مردمک" : "Pupil height",
      value: `${report.pupilOffset >= 0 ? "+" : ""}${report.pupilOffset.toFixed(1)} mm`,
      hint: fa
        ? Math.abs(report.pupilOffset) <= 3 ? "مردمک نزدیکِ مرکزِ عدسی است" : "مردمک از مرکزِ عدسی دور است"
        : Math.abs(report.pupilOffset) <= 3 ? "Pupil near the lens centre" : "Pupil off the lens centre",
      status: status(Math.abs(report.pupilOffset) <= 5, Math.abs(report.pupilOffset) <= 8),
    });
  }
  if (Number.isFinite(report.minClearance)) {
    rows.push({
      label: fa ? "فشارِ حلقه" : "Rim pressure",
      value: `${report.minClearance.toFixed(1)} mm`,
      hint: fa
        ? report.minClearance < -1.5 ? "لبهٔ حلقه روی گونه/بینی فشار می‌آورد" : "بدونِ فشارِ محسوس"
        : report.minClearance < -1.5 ? "Rim presses on the nose/cheek" : "No noticeable pressure",
      status: status(report.minClearance > -1.5, report.minClearance > -2.5),
    });
  }
  return rows;
}
