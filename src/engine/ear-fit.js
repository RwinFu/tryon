/**
 * ear-fit.js — گوش و کنارهٔ سر از همان ۴۶۸ نقطهٔ صورت «تشخیص» می‌شود
 *
 * مسئله: FaceMesh گوش را نمی‌بیند، و دسته‌ای که با عددِ ثابت ساخته شود در
 * صورتِ پهن/نزدیک از جلوی گونه رد می‌شود. راهِ درست همان کاری است که
 * اپتومترِ عینک می‌کند: کنارهٔ سر اندازه گرفته می‌شود، دسته روی همان کناره
 * می‌لغزد و پشتِ گوش خم می‌شود.
 *
 * این ماژول سه چیز می‌دهد (همه در «فضایِ سر»، میلی‌متر، +y بالا، +z رو به دوربین):
 *  ۱. `headBoundaryX/Z` — مرزِ کناریِ صورت در هر ارتفاع، از خودِ رأس‌های مدلِ
 *     کانونیک (نه عددِ دستی).
 *  ۲. `headSideX(z, y)` — «دیوارهٔ» سر در عمقِ z (وارونِ سطحِ مش) ⇒ دسته دقیقاً
 *     روی پوست می‌لغزد و هیچ‌وقت از صورت رد نمی‌شود.
 *  ۳. `earAnchor()` + `templePath()` — لنگَرِ گوش (کانال، بالای گوش، لاله) و
 *     مسیرِ کاملِ دسته: لولا → کنارهٔ سر → بالای گوش → خمِ پشتِ گوش → دنباله.
 *
 * اندازه‌ها از مدلِ کانونیک + نسبت‌های آنتروپومتریکِ بزرگسال می‌آیند (کانالِ
 * گوش ≈ ۰٫۶۱ طولِ سر عقب‌تر از نوکِ بینی؛ بالای گوش هم‌ارتفاعِ ابرو). چون
 * نشستنِ فریم هم روی همین سرِ کانونیک حساب می‌شود، دسته و سر و گوش با هر
 * اندازهٔ کاربر یک‌جا مقیاس می‌گیرند.
 */

import { surfaceZ } from "./face-surface.js";
import { CANONICAL_MM } from "./face-topology.js";
import { EYE } from "./head-fit.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mm = (id, k) => CANONICAL_MM[id * 3 + k];
const r2 = (v) => Math.round(v * 100) / 100;

/** نسبت‌های آنتروپومتریک (mm، سرِ کانونیک) */
export const EAR = {
  canalBelowEye: 5.9, // کانالِ گوش کمی زیرِ خطِ مردمک
  canalFromNoseTip: 0.61, // نسبتِ فاصلهٔ کانال از نوکِ بینی به طولِ سر
  headLength: 205, // نوکِ بینی → پسِ سر
  topAboveCanal: 20.2, // بالای گوش ≈ هم‌ارتفاعِ ابرو
  lobeBelowCanal: 39,
  pinnaLateral: 1.9, // لالهٔ گوش چند mm بیرون‌تر از پهن‌ترین جایِ صورت
  pinnaRx: 6.4,
  pinnaRy: 17.5,
  pinnaRz: 11.5,
  skinGap: 1.2, // فاصلهٔ دیوارهٔ دسته از پوست
  earGap: 0.5, // فاصلهٔ دیوارهٔ دسته از لالهٔ گوش
};

const boundaryCache = new Map();

/**
 * مرزِ کناریِ صورت در ارتفاع y: بیشترین |x| پوست و z همان لبه.
 * از بیرون به داخل پویش می‌شود تا اولین نقطهٔ پوست پیدا شود (سریع + دقیق،
 * چون سطحِ مش بین لندمارک‌ها هم پیوسته است).
 * @param {number} y ارتفاع (mm، فضایِ سر)
 * @returns {{x:number, z:number, y:number}}
 */
export function headEdge(y) {
  const key = Math.round(clamp(y, -90, 88) * 2) / 2;
  const hit = boundaryCache.get(key);
  if (hit) return hit;
  let x = 0;
  for (let probe = 86; probe >= 0; probe -= 0.5) {
    if (Number.isNaN(surfaceZ(probe, key))) continue;
    // لبه باید پایدار باشد، نه یک نقطهٔ پرت
    if (Number.isNaN(surfaceZ(probe - 0.5, key))) continue;
    x = probe;
    break;
  }
  const z = x > 0 ? surfaceZ(Math.max(0, x - 0.75), key) : 0;
  const out = { x: r2(x), y: key, z: r2(Number.isFinite(z) ? z : 0) };
  boundaryCache.set(key, out);
  return out;
}

/** بیشترین |x| پوست در ارتفاع y (mm) */
export const headBoundaryX = (y) => headEdge(y).x;
/** عقب‌ترین z پوستِ کناره در ارتفاع y (mm) */
export const headBoundaryZ = (y) => headEdge(y).z;

// ── دیوارهٔ سر: x به‌ازای عمقِ z ────────────────────────────────────────────
const sideCache = new Map();

/**
 * جدولِ دیوارهٔ سر برای یک ارتفاع: زوج‌های (z, x) از جلوی صورت تا پشتِ گوش.
 * یک‌بار ساخته و کش می‌شود (وارون‌سازیِ سطحِ مش با دوبخشی روی x).
 */
function sideProfile(y) {
  const yKey = Math.round(clamp(y, -88, 80) / 4) * 4; // بازهٔ کاملِ ارتفاعِ سر
  const hit = sideCache.get(yKey);
  if (hit) return hit;
  const edge = headEdge(yKey);
  const zFront = surfaceZ(0, yKey);
  const zEdge = edge.z;
  const z0 = Number.isFinite(zFront) ? zFront : 44;
  const table = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const z = z0 + (zEdge - z0) * (i / steps);
    let lo = 0, hi = edge.x;
    if (surfaceZ(0, yKey) <= z) hi = 0;
    else if (surfaceZ(edge.x - 0.05, yKey) >= z) lo = hi;
    for (let b = 0; b < 9; b++) {
      const mid = (lo + hi) / 2;
      const sz = surfaceZ(mid, yKey);
      if (Number.isNaN(sz) || sz > z) lo = mid;
      else hi = mid;
    }
    table.push({ z, x: (lo + hi) / 2 });
  }
  sideCache.set(yKey, table);
  return table;
}

/**
 * دیوارهٔ سر در عمقِ z: بیشترین |x| که پوست در آن عمق دارد.
 * برای zهای عقب‌تر از لبهٔ گونه، جمجمه کمی باریک می‌شود (برون‌یابیِ خطی).
 *
 * @param {number} z عمق (mm، فضایِ سر)
 * @param {number} y ارتفاع (mm)
 */
export function headSideX(z, y) {
  const table = sideProfile(y);
  const first = table[0], last = table[table.length - 1];
  if (z >= first.z) return 0; // جلوتر از سطحِ صورت: دیواره‌ای نیست
  if (z <= last.z) {
    const back = Math.min(1, (last.z - z) / 90);
    return last.x * (1 - 0.05 * back); // پسِ سر از گوش باریک‌تر است
  }
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1], b = table[i];
    if (z >= b.z) {
      const t = (a.z - z) / (a.z - b.z || 1);
      return a.x + (b.x - a.x) * t;
    }
  }
  return last.x;
}

// ── لنگَرِ گوش ─────────────────────────────────────────────────────────────
let anchorCache = null;

/**
 * لنگَرِ گوش در فضایِ سر (mm).
 * @returns {{
 *   canal:{x:number,y:number,z:number}, top:number, lobe:number, lateral:number,
 *   pinna:{x:number,y:number,z:number,rx:number,ry:number,rz:number},
 *   boundary:number, edgeZ:number, armX:number
 * }}
 */
export function earAnchor() {
  if (anchorCache) return anchorCache;
  const eyeY = EYE.center[1];
  const canalY = eyeY - EAR.canalBelowEye;
  const noseTipZ = mm(4, 2);
  const canalZ = r2(noseTipZ - EAR.canalFromNoseTip * EAR.headLength);
  const top = r2(canalY + EAR.topAboveCanal);
  const lobe = r2(canalY - EAR.lobeBelowCanal);
  // پهن‌ترین جایِ سر در بازهٔ ارتفاعِ گوش (لاله پهن‌ترین نقطهٔ سر است)
  let boundary = 0;
  for (let y = lobe; y <= top; y += 2) boundary = Math.max(boundary, headBoundaryX(y));
  const lateral = r2(boundary + EAR.pinnaLateral);
  anchorCache = {
    canal: { x: r2(boundary - 0.6), y: r2(canalY), z: canalZ },
    top,
    lobe,
    boundary: r2(boundary),
    lateral,
    edgeZ: headBoundaryZ(canalY),
    pinna: {
      x: r2(lateral - EAR.pinnaRx - 0.4),
      y: r2((top + lobe) / 2 + 4),
      z: r2(canalZ - 2),
      rx: EAR.pinnaRx,
      ry: EAR.pinnaRy,
      rz: EAR.pinnaRz,
    },
  };
  return anchorCache;
}

/**
 * مبدأِ فریم روی سر، از خودِ نقاطِ تکیه‌گاهِ فریم (پل و بالشتک).
 * همان قراردادِ `seatOnHead`: عمیق‌ترین نقطهٔ تکیه‌گاه روی پوست می‌نشیند و
 * ۰٫۵mm فشردگیِ طبیعیِ بافت هم حساب می‌شود. فقط برای این لازم است که مسیرِ
 * دسته بداند گوشِ همین سر کجاست (اختلافِ فریم‌ها تا ۱۳mm در عمق است).
 *
 * @param {Array<{name:string, role:string, geo?:{position:ArrayLike<number>}}>} parts
 * @param {{oy?:number}} [o]
 * @returns {{ox:number, oy:number, oz:number}}
 */
export function seatOrigin(parts = [], { oy = EYE.center[1] - 1.5 } = {}) {
  let best = -Infinity;
  let found = false;
  for (const part of parts) {
    const isBridge = part.name === "bridge";
    const isPad = part.role === "pad";
    if (!isBridge && !isPad) continue;
    const pos = part.geo?.position;
    if (!pos) continue;
    const verts = pos.length / 3;
    const step = Math.max(1, Math.floor(verts / 260)) * 3;
    for (let i = 0; i < pos.length; i += step) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (Math.abs(x) > 16) continue;
      const skin = surfaceZ(-x, oy + y); // xِ فریم = راستِ فرد، xِ مدل = چپِ تصویر
      if (Number.isNaN(skin)) continue;
      const need = skin - z;
      if (need > best) best = need;
      found = true;
    }
  }
  const oz = found ? best - 0.5 : EYE.corneaZ + 17.2;
  return { ox: 0, oy: r2(oy), oz: r2(clamp(oz, EYE.corneaZ + 10, EYE.corneaZ + 26)) };
}

/** مبدأِ فریم در فضایِ سر (قراردادِ نشستن: oz = corneaZ + vd، oy = seatY) */
export function headOrigin({ vd = 17, seatY = EYE.center[1] - 1.5 } = {}) {
  return { ox: 0, oy: r2(seatY), oz: r2(EYE.corneaZ + vd) };
}

/** نرمِ بیشینه: گوشهٔ تیزِ برخوردِ دسته با دیوارهٔ سر را می‌گیرد */
const smax = (a, b, k = 2.5) => Math.max(a, b) + k * Math.log1p(Math.exp(-Math.abs(a - b) / k));

/**
 * مسیرِ دسته در فضایِ **فریم** (mm): لولا → کنارهٔ سر → بالای گوش → خمِ پشتِ
 * گوش → دنباله. طولِ کل با `templeLen` همان فریم هم‌خوان است، ولی خم دقیقاً
 * سرِ جایِ آناتومیکِ گوش می‌افتد (نه کسری از طول که با سرِ کاربر جابه‌جا شود).
 *
 * @param {{
 *   side:number, spec:object, hinge:{x:number,y:number,z:number},
 *   origin?:{ox:number,oy:number,oz:number}, vd?:number
 * }} o
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function templePath({ side, spec = {}, hinge, origin, vd = 17 }) {
  const s = side >= 0 ? 1 : -1;
  const O = origin || headOrigin({ vd });
  const ear = earAnchor();
  const halfT = Math.max(1, (Number(spec.templeT) || 2.6) / 2);
  const hx = Math.abs(Number(hinge?.x) || 62);
  const hy = (Number(hinge?.y) || 10) + O.oy; // فضایِ سر
  const hz = (Number(hinge?.z) || -4) + O.oz;
  const skin = halfT + EAR.skinGap;
  const armX = ear.lateral + halfT + EAR.earGap;
  const zBend = ear.canal.z + EAR.pinnaRz; // صفحهٔ جلویِ لالهٔ گوش
  const zTop = zBend - 4; // آخرین نقطهٔ لغزش روی سر

  const pts = [];
  const push = (x, y, z) => pts.push({ x, y, z });
  // ۱) از لولا، مماس بر قوسِ جلوی فریم
  push(hx, hy, hz);
  push(hx + 1.0, hy - 0.25, hz - 10);
  // ۲) لغزش روی دیوارهٔ سر تا جلوی لالهٔ گوش
  const steps = 7;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const z = hz - 10 + (zTop - (hz - 10)) * t;
    const y = hy - 0.25 + (ear.canal.y + 9.5 - (hy - 0.25)) * t;
    // از لبهٔ گونه به عقب، لالهٔ گوش بیرون‌تر می‌زند ⇒ دسته هم بیرون‌تر می‌رود
    const ramp = clamp((ear.edgeZ - z) / Math.max(8, ear.edgeZ - zBend), 0, 1);
    const w = ramp * ramp * (3 - 2 * ramp);
    const need = (headSideX(z, y) + skin) * (1 - w) + armX * w;
    push(smax(hx + 1.0, need, 2.6), y, z);
  }
  // ۳) بالای گوش: نقطهٔ تماسِ واقعی، بعد خمِ پشتِ لاله.
  //     دسته روی لالهٔ گوش (که ~۴mm از جمجمه بیرون‌تر است) می‌نشیند و درست
  //     پشتِ لبهٔ عقبیِ لاله، به دیوارهٔ جمجمه برمی‌گردد — همان «جای گرفتنِ»
  //     طبیعیِ دسته که در عینکِ واقعی دیده می‌شود.
  push(armX - 1.5, ear.canal.y + 4.0, zTop - 5.5);
  push(ear.boundary - 4.2, ear.canal.y - 1.5, zTop - 13);

  // ۴) دنباله: باقیِ طولِ اعلام‌شده، پشتِ لاله و رو به داخلِ سر
  const used = arcLength(pts);
  const want = clamp(Number(spec.templeLen) || 145, 90, 175);
  const drop = clamp(Number(spec.earDrop) || 8.5, 4, 16) * 1.5;
  const bendHint = clamp(Number(spec.earBendAt) || 0.82, 0.6, 0.95);
  const tail = clamp(want - used, 11, 46);
  const segs = Math.max(2, Math.round(tail / 8));
  const last = pts[pts.length - 1];
  const zTip = last.z - tail * (0.86 + (bendHint - 0.82) * 1.5);
  const xTip = ear.boundary - 7.2;
  const yTip = last.y - drop;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const e = t * t * (3 - 2 * t); // خمِ نرم
    push(last.x + (xTip - last.x) * e, last.y + (yTip - last.y) * e, last.z + (zTip - last.z) * e);
  }
  // فضایِ سر → فضایِ فریم
  return pts.map((p) => ({ x: r2(s * p.x - O.ox), y: r2(p.y - O.oy), z: r2(p.z - O.oz) }));
}

/** طولِ چندضلعی در سه‌بعد */
export function arcLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return L;
}

/**
 * کپسولِ «لالهٔ گوش» برای سرِ نامرئی (فضایِ فریم).
 * همان حجمی را می‌پوشاند که گوشِ واقعی می‌پوشاند: دیدِ روبه‌رو دنبالهٔ پشتِ
 * گوش را می‌بُرد، ولی مسیرِ روی شقیقه دست‌نخورده می‌ماند (چون از لاله
 * بیرون‌تر است).
 *
 * @param {{ox:number,oy:number,oz:number}} origin مبدأِ فریم در فضایِ سر
 */
export function earShells(origin = headOrigin()) {
  const ear = earAnchor();
  const out = [];
  for (const s of [1, -1]) {
    out.push({
      x: r2(s * ear.pinna.x - origin.ox),
      y: r2(ear.pinna.y - origin.oy),
      z: r2(ear.pinna.z - origin.oz),
      rx: ear.pinna.rx,
      ry: ear.pinna.ry,
      rz: ear.pinna.rz,
    });
  }
  return out;
}
