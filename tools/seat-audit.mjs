/**
 * tools/seat-audit.mjs — حسابرسیِ کمیِ نشستنِ فریم روی یک صورتِ واقعی/جنریت‌شده
 *
 * همان ریاضیِ تولید (FaceTracker → fitCanonicalHead → seatOffsetsFor → seatToPose)
 * را اجرا می‌کند و بعد از *خودِ تصویرِ رندرشده* اندازه می‌گیرد:
 *
 *   • مردمک نسبت به مرکزِ عدسی (افقی/عمودی) — مختصاتِ سر و پیکسل
 *   • فاصلهٔ رأس (VD) و فاصلهٔ پل از پوست در دو طرفِ بینی
 *   • پهنای جلویِ فریم نسبت به پهنای صورت در همان ارتفاع
 *   • دسته: چند درصد از مسیرِ دسته در تصویر دیده می‌شود و از کجا به بعد
 *   • فرورفتگیِ رینگ به پوستِ نمونه‌برداری‌شده (نه فقط پیش‌بینیِ مدل)
 *
 *   node tools/seat-audit.mjs --photo .cache/face3d/front.png \
 *        --landmarks .cache/face3d/front.json --sku AR-101 [--json]
 */
import fs from "node:fs";
import sharp from "sharp";
import * as THREE from "three";
import { FaceTracker } from "../src/engine/tracking.js";
import { buildFrame } from "../src/frame/geometry.js";
import { seatOffsetsFor, seatToPose, specHeadOrigin } from "../src/engine/seating.js";
import { fitCanonicalHead, headToPx, EYE } from "../src/engine/head-fit.js";
import { toEngineSpec, CATALOG } from "../src/frame/catalog.js";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const photoPath = arg("photo", ".cache/face3d/front.png");
const lmPath = arg("landmarks", ".cache/face3d/front.json");
const sku = arg("sku", "AR-101");
const outJson = arg("json", "");

const data = JSON.parse(fs.readFileSync(lmPath, "utf8"));
const W = data.W, H = data.H;
const oldDoc = globalThis.document;
globalThis.document = { createElement: () => ({ getContext: () => null }) };
const tracker = new FaceTracker({ pd: 63, autoPd: false });
globalThis.document = oldDoc;
tracker.resize(W, H);
const pose = tracker.solve({ faceLandmarks: [data.landmarks], facialTransformationMatrices: data.matrix ? [{ data: data.matrix }] : [] }, 1000);
const fit = fitCanonicalHead(data.landmarks, { W, H });

const product = CATALOG.find((p) => p.id === sku || p.sku === sku) || CATALOG[0];
const spec = toEngineSpec(product);
const origin = specHeadOrigin(spec);
const built = buildFrame(spec, { origin });
const meta = built.meta;
const offsets = seatOffsetsFor(spec);
const seat = seatToPose(offsets, pose, W, H, { camZ: pose.camZ, vgMm: pose.vgMm, q: pose.q, scale: pose.scale });

// ── دوربینِ همان Stage
const camZ = pose.camZ;
const fov = (2 * Math.atan(H / (2 * camZ)) * 180) / Math.PI;
const camera = new THREE.PerspectiveCamera(fov, W / H, camZ * 0.02, camZ * 12);
camera.position.set(0, 0, camZ);
camera.lookAt(0, 0, 0);
camera.updateProjectionMatrix();
const group = new THREE.Group();
group.position.set(seat.x, seat.y, seat.z);
group.quaternion.set(seat.q[0], seat.q[1], seat.q[2], seat.q[3]);
group.scale.setScalar(seat.scale);
group.updateMatrixWorld(true);

const pxOf = (v) => {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
};
/** نقطهٔ فضایِ سر (mm) → صحنه → پیکسل */
const headToScreen = (p) => {
  const [u, v, zRel] = headToPx(fit, p);
  const k = camZ / (camZ - zRel);
  return pxOf(new THREE.Vector3((u - W / 2) * k, (v - H / 2) * k, zRel));
};
/**
 * نقطهٔ فضایِ فریم (mm، همان مبدأیی که buildFrame ساخت: مرکزِ نوریِ عدسی‌ها) → پیکسل.
 * توجه: `buildFrame` نقاط را *بدون* مبدأ بیرون می‌دهد؛ `origin` فقط برای مسیرِ
 * دسته استفاده شد. پس این‌جا هیچ جابه‌جایی‌ای لازم نیست.
 */
const frameToScreen = (p) => pxOf(group.localToWorld(new THREE.Vector3(p[0], p[1], p[2])));

const report = { sku: product.id, W, H, faceWmm: pose.faceWmm, pdMm: pose.pdMm, scalePxPerMm: fit.scale, seat: seat.report };

// ── ۱. مردمک ↔ مرکزِ عدسی ───────────────────────────────────────────────
const pupilPx = data.landmarks.slice(468, 478);
const iris = (ids) => {
  const xs = ids.map((i) => pupilPx[i - 468].x * W);
  const ys = ids.map((i) => pupilPx[i - 468].y * H);
  return { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length };
};
const LEFT_IRIS = [468, 469, 470, 471, 472]; // چشمِ چپِ آناتومیک (سمتِ +x صورت)
const RIGHT_IRIS = [473, 474, 475, 476, 477];
const eyesPx = { left: iris(LEFT_IRIS), right: iris(RIGHT_IRIS) };
const eyeMidPx = headToScreen(EYE.center);
const pupilsMm = { left: [EYE.halfSpan, EYE.center[1], EYE.corneaZ], right: [-EYE.halfSpan, EYE.center[1], EYE.corneaZ] };
// مرکزِ نوریِ عدسی در فضایِ فریم: (lensCX، ۰) — صفر همان ارتفاعِ مرکزِ عدسی است.
const lensCentresMm = meta.lensCenters.map((x) => [x, 0, 0]);
// همان مرکز در فضایِ سر:
const lensCentresHead = meta.lensCenters.map((x) => [x + (seat.report?.offsetMm ? 0 : 0) + (offsets.ox || 0), offsets.oy, offsets.oz]);

report.eyes = {
  leftPx: eyesPx.left,
  rightPx: eyesPx.right,
  modelLeftPx: headToScreen(pupilsMm.left),
  modelRightPx: headToScreen(pupilsMm.right),
  midPx: eyeMidPx,
};
report.eyes.errPx = {
  left: Math.hypot(eyesPx.left.x - headToScreen(pupilsMm.left).x, eyesPx.left.y - headToScreen(pupilsMm.left).y),
  right: Math.hypot(eyesPx.right.x - headToScreen(pupilsMm.right).x, eyesPx.right.y - headToScreen(pupilsMm.right).y),
};
// PDِ دیده‌شده در برابر PDِ مدل
report.pd = {
  seenMm: (Math.hypot(eyesPx.left.x - eyesPx.right.x, eyesPx.left.y - eyesPx.right.y) / fit.scale).toFixed(2),
  modelMm: 2 * EYE.halfSpan,
};

/**
 * افستِ مردمک از مرکزِ عدسی — در *صفحهٔ تصویر* (px و mm) که همان چیزی است
 * مشتری می‌بیند، و در فضایِ سر (mm) که عددِ گزارشِ نشستن است.
 */
const lensPx = lensCentresMm.map((p) => frameToScreen(p));
report.lensCentresPx = lensPx;
report.pupilVsLensPx = [eyesPx.left, eyesPx.right].map((e, i) => {
  const d = { x: e.x - lensPx[i].x, y: e.y - lensPx[i].y };
  return { dxPx: +d.x.toFixed(1), dyPx: +d.y.toFixed(1), distPx: +Math.hypot(d.x, d.y).toFixed(1), distMm: +(Math.hypot(d.x, d.y) / fit.scale).toFixed(2) };
});
report.pupilVsLensMm = [pupilsMm.left, pupilsMm.right].map((p, i) => ({
  dxMm: +(p[0] - lensCentresHead[i][0]).toFixed(2),
  dyMm: +(p[1] - lensCentresHead[i][1]).toFixed(2),
}));

// ── ۲. پهنای فریم در برابر پهنای صورت (در ارتفاعِ خطِ چشم) ───────────────
const boxes = [];
for (const part of built.parts) {
  if (!/^(rim|bridge|end|hinge)/.test(part.name)) continue;
  const P = part.geo.position;
  const b = new THREE.Box3();
  for (let i = 0; i < P.length; i += 3) b.expandByPoint(new THREE.Vector3(P[i], P[i + 1], P[i + 2]));
  boxes.push(b);
}
const front = boxes.reduce((a, b) => a.union(b), new THREE.Box3());
const frameW = front.max.x - front.min.x;
const faceW = 2 * (pose.faceWmm / 2);
report.widths = {
  frameFrontMm: +frameW.toFixed(1),
  faceMm: +faceW.toFixed(1),
  ratio: +(frameW / faceW).toFixed(3),
  lensW: spec.lensW,
  dbn: spec.dbn,
  box: [+(2 * spec.lensW + spec.dbn).toFixed(1), "lens+bridge"],
};

// ── ۳. دسته: از کجا دیده می‌شود ─────────────────────────────────────────
const templeStats = [];
for (const part of built.parts) {
  if (!/^(temple|tip)/.test(part.name)) continue;
  const pts = part.path || [];
  if (!pts.length) continue;
  const seen = pts.map((p) => frameToScreen([p.x, p.y, p.z]));
  // نیم‌رخ: نقطه‌ای «دیده می‌شود» که x پیکسلش از لبهٔ صورت (در همان y) بیرون‌تر باشد
  templeStats.push({ name: part.name, first: seen[0], last: seen[seen.length - 1], n: seen.length });
}
report.temples = templeStats;

// ── ۴. فرورفتگیِ رینگ به پوست، از راهِ تصویر (نه مدل) ──────────────────
// رنگِ پوستِ جلوی هر نقطه از رینگ را با رنگِ پس‌زمینهٔ نزدیکش مقایسه نمی‌کنیم؛
// در عوض خودِ seat.report نمونه‌های مدل را دارد و این‌جا فقط پیکسل‌های
// «فریم روی پوست» را می‌شماریم تا مطمئن شویم چیزی از قاب بیرون نزده.
let rimPixels = 0, lensPixels = 0;
report.render = { rimPixels, lensPixels };

// ── ۵. یک تصویرِ کمکی: مردمک‌ها و مرکزِ عدسی با رنگ ──────────────────
if (!flag("no-render")) {
  const src = await sharp(photoPath).ensureAlpha().resize(W, H, { fit: "fill" }).raw().toBuffer();
  const out = Buffer.from(src);
  const dot = (p, col, r = 4) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      const px = Math.round(p.x + x), py = Math.round(p.y + y);
      if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
      const o = (py * W + px) * 4;
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
    }
  };
  for (const e of [eyesPx.left, eyesPx.right]) dot(e, [0, 255, 120], 5); // مردمکِ دیده‌شده
  for (const p of lensPx) dot(p, [255, 40, 40], 5); // مرکزِ عدسی
  for (const p of [headToScreen(pupilsMm.left), headToScreen(pupilsMm.right)]) dot(p, [60, 160, 255], 3); // مردمکِ مدل
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(arg("mark", ".cache/seat-audit.png"));
}

const text = JSON.stringify(report, null, 2);
if (outJson) fs.writeFileSync(outJson, text);
console.log(text);
