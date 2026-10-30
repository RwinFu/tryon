/**
 * occluder.js — «سرِ نامرئی» برای بریدن دسته‌های عینک پشت صورت
 *
 * یک مشِ فقط‌عمق (رنگ نمی‌نویسد، فقط عمق) به‌همراهِ دو «لالهٔ گوش»، در فضایِ
 * **سر** ساخته می‌شود و کلِ گروه با آفستِ نشستن به فضایِ فریم می‌آید.
 *
 * چرا دیگر سوپربیضی‌گونِ ساده نیست؟
 *  - دیوارهٔ سر با یک بیضی/جعبهٔ گرد توصیف نمی‌شود: نزدیکِ صورت باریک است و
 *    فقط از شقیقه به عقب به پهن‌ترین حدش می‌رسد. فرمِ قبلی در عمقِ شقیقه
 *    ~۷mm پهن‌تر از سرِ واقعی بود، پس لبهٔ داخلیِ دسته را می‌بُرید — و از
 *    طرفِ دیگر به پهنای لولا محدود می‌شد، پس هیچ‌وقت دسته‌ها را پشتِ گوش
 *    پنهان نمی‌کرد (دسته از کنارِ صورت رد می‌شد).
 *  - اینجا نیم‌پهنای سر در هر (ارتفاع، عمق) از خودِ سطحِ مشِ صورت گرفته
 *    می‌شود (`ear-fit.headSideX`) ⇒ مش دقیقاً همان‌جایی تمام می‌شود که دسته
 *    می‌تواند دیده شود.
 *  - جلوی مش همیشه ۴mm پشتِ قرنیه است، پس هرگز روی عدسی/حلقه نمی‌افتد.
 */

import { earAnchor, headSideX } from "./ear-fit.js";
import { EYE } from "./head-fit.js";

/** جلوی سر نسبت به قرنیه (mm) — همیشه عقب‌تر از صفحهٔ عدسی */
export const HEAD = {
  frontBehindCornea: 4,
  backBehindCornea: 210, // تا پسِ سر
  pad: 0.6, // چند mm بیرون‌تر از پوست تا لبهٔ پوست هم پوشیده شود
  topY: 78, // بالای مش (پیشانی)
  bottomY: -84, // زیرِ چانه
  rows: 15,
  cols: 15,
};

/** zِ جلوی مش در فضایِ سر (mm) */
export const headFrontZ = () => EYE.corneaZ - HEAD.frontBehindCornea;

// ── جدولِ دیوارهٔ سر (فضایِ سر) ─────────────────────────────────────────────
let wallCache = null;

function wall() {
  if (wallCache) return wallCache;
  const ys = [];
  for (let i = 0; i < HEAD.rows; i++) ys.push(HEAD.bottomY + (HEAD.topY - HEAD.bottomY) * (i / (HEAD.rows - 1)));
  const zTop = headFrontZ();
  const zBot = zTop - HEAD.backBehindCornea + HEAD.frontBehindCornea;
  const zs = [];
  for (let i = 0; i < HEAD.cols; i++) zs.push(zTop + (zBot - zTop) * (i / (HEAD.cols - 1)));
  const w = ys.map((y) => zs.map((z) => headSideX(z, y)));
  wallCache = { ys, zs, w };
  return wallCache;
}

/**
 * نیم‌پهنای دیوارهٔ سر در ارتفاع y و عمق z (mm، فضایِ سر) — درون‌یابیِ دوسطحی.
 * @param {number} y ارتفاع (mm)
 * @param {number} z عمق (mm)
 */
export function wallWidth(y, z) {
  const { ys, zs, w } = wall();
  const fy = ((y - ys[0]) / (ys[ys.length - 1] - ys[0])) * (ys.length - 1);
  const fz = ((z - zs[0]) / (zs[zs.length - 1] - zs[0])) * (zs.length - 1);
  const iy = Math.max(0, Math.min(ys.length - 2, Math.floor(fy)));
  const iz = Math.max(0, Math.min(zs.length - 2, Math.floor(fz)));
  const ty = Math.max(0, Math.min(1, fy - iy));
  const tz = Math.max(0, Math.min(1, fz - iz));
  const a = w[iy][iz] * (1 - tz) + w[iy][iz + 1] * tz;
  const b = w[iy + 1][iz] * (1 - tz) + w[iy + 1][iz + 1] * tz;
  return a * (1 - ty) + b * ty;
}

/**
 * پارامترهای سرِ نامرئی برای یک فریم و یک صورت.
 * @param {{frameHalfWidth?:number, faceWmm?:number, vertexDistance?:number,
 *          origin?:{ox:number,oy:number,oz:number}}} o
 *   origin: مبدأِ فریم روی سر (mm) — همان چیزی که مسیرِ دسته با آن ساخته شده
 */
export function headOccluderParams({ frameHalfWidth = 72, faceWmm = 0, vertexDistance = 13, origin = null } = {}) {
  void frameHalfWidth;
  void faceWmm;
  const vd = Math.min(30, Math.max(6, Number(vertexDistance) || 13));
  const O = origin && Number.isFinite(origin.oz) ? origin : { ox: 0, oy: EYE.center[1] - 1.5, oz: EYE.corneaZ + vd };
  const zFront = headFrontZ();
  return {
    origin: O,
    pad: HEAD.pad,
    zFront,
    zBack: zFront - (HEAD.backBehindCornea - HEAD.frontBehindCornea),
    rx: earAnchor().boundary, // نیم‌پهنای جمجمه (گزارش)
    ry: (HEAD.topY - HEAD.bottomY) / 2,
    cy: (HEAD.topY + HEAD.bottomY) / 2,
    front: -(vd + HEAD.frontBehindCornea), // در فضایِ فریم
    ears: earAnchor(),
  };
}

/**
 * مقدارِ «داخلِ سر» در نقطهٔ p (فضایِ فریم): کمتر از ۱ یعنی داخل.
 * همان تابعی که مش با آن ساخته می‌شود، پس حسابرسی و رندر یکی‌اند.
 */
export function headValue(p, h) {
  const O = h.origin || { ox: 0, oy: 0, oz: 0 };
  const zH = p.z + O.oz;
  const yH = p.y + O.oy;
  const xH = p.x + O.ox;
  if (zH > h.zFront || yH > HEAD.topY + 6 || yH < HEAD.bottomY - 6) return 4;
  const w = wallWidth(yH, zH) + (h.pad ?? HEAD.pad);
  if (!(w > 0.2)) return 4;
  return (xH / w) ** 2;
}

export const insideHead = (p, h) => headValue(p, h) < 1;

/**
 * داخلِ لالهٔ گوش (فضایِ فریم). لاله همان حجمی است که دنبالهٔ دسته را از دیدِ
 * روبه‌رو می‌پوشاند.
 * @param {{x:number,y:number,z:number}} p
 * @param {{ox:number,oy:number,oz:number}} origin
 */
export function insideEar(p, origin) {
  const ear = earAnchor();
  const xH = Math.abs(p.x + (origin?.ox || 0));
  const yH = p.y + (origin?.oy || 0);
  const zH = p.z + (origin?.oz || 0);
  const dx = (xH - ear.pinna.x) / (ear.pinna.rx + 0.5);
  const dy = (yH - ear.pinna.y) / (ear.pinna.ry + 0.5);
  const dz = (zH - ear.pinna.z) / (ear.pinna.rz + 0.5);
  return dx * dx + dy * dy + dz * dz <= 1;
}

/** هندسهٔ واحد سوپربیضی‌گون: کرهٔ واحد با نگاشت مؤلفه‌ای sign(v)·|v|^(2/e) */
export function superellipsoidGeometry(THREE, exp = 4, widthSegments = 36, heightSegments = 26) {
  const g = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const pos = g.attributes.position;
  const k = 2 / exp;
  const f = (v) => Math.sign(v) * Math.abs(v) ** k;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, f(pos.getX(i)), f(pos.getY(i)), f(pos.getZ(i)));
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** مشِ دیوارهٔ سر در فضایِ سر: دو ورقهٔ ±x که در لبه‌ها به هم می‌رسند */
function wallGeometry(THREE) {
  const { ys, zs, w } = wall();
  const position = [];
  const index = [];
  const rows = ys.length, cols = zs.length;
  for (const sign of [1, -1]) {
    const base = position.length / 3;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const width = w[i][j] + HEAD.pad;
        position.push(sign * (width > 0.1 ? width : 0), ys[i], zs[j]);
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
        if (sign > 0) index.push(a, c, b, b, c, d);
        else index.push(a, b, c, b, d, c);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** مشِ فقط‌عمق (رنگ نمی‌نویسد) که پیش از فریم رندر می‌شود */
export function createHeadOccluder(THREE, params = headOccluderParams()) {
  const group = new THREE.Group();
  group.name = "occluder";
  group.renderOrder = -100;
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
  const head = new THREE.Mesh(wallGeometry(THREE), mat);
  head.name = "occluderHead";
  group.add(head);
  const earGeo = superellipsoidGeometry(THREE, 3, 20, 14);
  for (const side of ["L", "R"]) {
    const m = new THREE.Mesh(earGeo, mat);
    m.name = `occluderEar${side}`;
    group.add(m);
  }
  applyHeadOccluder(group, params);
  return group;
}

/**
 * جای گروهِ سر + لاله‌های گوش را از پارامترها می‌گذارد.
 * مش در فضایِ سر است، پس گروه به اندازهٔ منفیِ مبدأِ نشستن جابه‌جا می‌شود.
 */
export function applyHeadOccluder(target, p) {
  const group = target?.isGroup ? target : null;
  const O = p.origin || { ox: 0, oy: 0, oz: 0 };
  if (group) {
    group.position.set(-O.ox, -O.oy, -O.oz);
    group.updateMatrix();
    const ears = group.children.filter((c) => c.name?.startsWith("occluderEar"));
    const ear = earAnchor();
    ears.forEach((m, i) => {
      const s = i === 0 ? 1 : -1; // L اول، R دوم
      m.scale.set(ear.pinna.rx, ear.pinna.ry, ear.pinna.rz);
      m.position.set(s * ear.pinna.x, ear.pinna.y, ear.pinna.z);
      m.updateMatrix();
    });
  } else if (target?.isMesh) {
    target.position.set(-O.ox, -O.oy, -O.oz);
    target.updateMatrix();
  }
  target.userData.head = p;
  return target;
}
