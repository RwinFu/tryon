/** اسکن حرفه‌ای صورت — تست‌های عددیِ خالص (بدون مرورگر) */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FaceScan,
  LM,
  buildScanMesh,
  frameQuality,
  headMeshFromLandmarks,
  interpupillaryPx,
  measureFrame,
  robust,
  suggestSize,
} from "../src/engine/face-scan.js";

const W = 960;
const H = 720;

/**
 * سرِ ساختگی با نسبت‌های انسانی: PD = ۶۳ میلی‌متر، عنبیه ۱۱٫۷ میلی‌متر.
 * خروجی در مختصات نرمال‌شده (۰..۱) مثل MediaPipe است.
 */
function head({ pdMm = 63, irisMm = 11.7, roll = 0, noseMm = 17, bridgeMm = 18, cheekMm = 132, templeMm = 126, heightMm = 186, openEyes = true, yaw = 0 } = {}) {
  const pxPerMm = 0.0044; // واحد نرمال (نسبت به عرض تصویر) به ازای هر میلی‌متر ⇒ PD ≈ ۲۸٪ عرض
  const pts = new Array(478).fill(0).map(() => null);
  const cxp = 0.5,
    cyp = 0.46;
  const rad = (roll * Math.PI) / 180;
  const put = (i, xmm, ymm, zmm = 0) => {
    // چرخشِ سر حول محور عمود بر صورت
    const x = xmm * Math.cos(yaw) + zmm * Math.sin(yaw);
    const z = -xmm * Math.sin(yaw) + zmm * Math.cos(yaw);
    const rx = x * Math.cos(rad) - ymm * Math.sin(rad);
    const ry = x * Math.sin(rad) + ymm * Math.cos(rad);
    pts[i] = { x: (cxp + rx * pxPerMm) / 1, y: cyp + ry * pxPerMm, z: z * pxPerMm };
  };
  const px = (mm) => mm * pxPerMm;
  // مردمک‌ها
  const eyeY = 0;
  put(LM.irisL, -pdMm / 2, eyeY, -14);
  put(LM.irisR, pdMm / 2, eyeY, -14);
  put(473, pdMm / 2, eyeY, -14);
  // گوشه‌های چشم
  put(LM.eyeOuterL, -pdMm / 2 - 8, eyeY + 1);
  put(LM.eyeInnerL, -pdMm / 2 + 15.5, eyeY + 1);
  put(LM.eyeOuterR, pdMm / 2 + 8, eyeY + 1);
  put(LM.eyeInnerR, pdMm / 2 - 15.5, eyeY + 1);
  // پلک‌ها
  for (const [up, lo, sgn] of [[159, 145, -1], [386, 374, 1]]) {
    const h = openEyes ? 5.5 : 1.1;
    put(up, sgn * pdMm / 2, eyeY - h);
    put(lo, sgn * pdMm / 2, eyeY + h);
  }
  // شقیقه/پیشانی/گونه/فک
  put(LM.templeL, -templeMm / 2, -22);
  put(LM.templeR, templeMm / 2, -22);
  put(LM.browL, -templeMm / 2 + 2, -40);
  put(LM.browR, templeMm / 2 - 2, -40);
  put(LM.cheekL, -cheekMm / 2, 14);
  put(LM.cheekR, cheekMm / 2, 14);
  put(LM.jawL, -cheekMm / 2 + 8, 70);
  put(LM.jawR, cheekMm / 2 - 8, 70);
  put(LM.chin, 0, heightMm / 2, -18);
  put(LM.top, 0, -heightMm / 2, 6);
  // بینی
  put(LM.noseBridgeTop, 0, 6, -20);
  put(LM.noseBridgeL, -bridgeMm / 2, 8, -16);
  put(LM.noseBridgeR, bridgeMm / 2, 8, -16);
  put(LM.bridgeLoL, -bridgeMm / 2 - 1, 20, -22);
  put(LM.bridgeLoR, bridgeMm / 2 + 1, 20, -22);
  put(LM.noseBridgeLow, 0, 22, -26);
  put(LM.noseTip, 0, 32, -34);
  put(LM.noseAlarL, -noseMm / 2, 30, -24);
  put(LM.noseAlarR, noseMm / 2, 30, -24);
  put(LM.noseSideL, -noseMm / 2 - 1.5, 24, -22);
  put(LM.noseSideR, noseMm / 2 + 1.5, 24, -22);
  // دهان
  put(LM.mouthL, -24, 62, -14);
  put(LM.mouthR, 24, 62, -14);
  put(LM.lipUpper, 0, 58, -18);
  put(LM.lipLower, 0, 68, -18);
  // بقیهٔ نقاط روی کرهٔ فیبوناچی (پشتِ صورت) تا سطحِ مش یکپارچه باشد
  const N = 478,
    ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    if (pts[i]) continue;
    const yy = 1 - (i / (N - 1)) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = ga * i;
    put(i, Math.cos(th) * rr * 88, yy * 96, 20 - Math.sin(th) * rr * 88);
  }
  void px;
  return pts;
}

test("interpupillaryPx و measureFrame: PD واقعی از قطر عنبیه", () => {
  const lms = head({ pdMm: 63 });
  const irisPx = 11.7 * 0.0044 * W; // px در تصویر
  const m = measureFrame(lms, { W, irisDiaPx: irisPx });
  assert.ok(Math.abs(m.pd - 63) < 1.2, "PD: " + m.pd);
  assert.ok(Math.abs(m.pdMono.l - 31.5) < 1.5, "PD تک‌چشمی چپ: " + m.pdMono.l);
  assert.ok(Math.abs(m.pdMono.r - 31.5) < 1.5, "PD تک‌چشمی راست: " + m.pdMono.r);
  assert.ok(Math.abs(m.bridge - 18) < 1.5, "عرض پل بینی: " + m.bridge);
  assert.ok(Math.abs(m.canthi - 32) < 1.5, "فاصلهٔ گوشه‌های داخلی چشم: " + m.canthi);
  assert.ok(Math.abs(m.noseW - 17) < 1.5, "پهنای بینی: " + m.noseW);
  assert.ok(Math.abs(m.cheek - 132) < 2, "پهنای گونه: " + m.cheek);
  assert.ok(Math.abs(m.height - 186) < 3, "ارتفاع صورت: " + m.height);
});

test("frameQuality: چهار حالتِ راهنمای کاربر را تشخیص می‌دهد", () => {
  const irisPx = 11.7 * 0.0044 * W;
  const good = frameQuality(head(), { W, H });
  assert.ok(good.ok, "سرِ صاف باید قبول شود: " + JSON.stringify(good.reasons));
  assert.ok(good.score >= 90, "امتیاز: " + good.score);
  assert.ok(good.frontality > 0.8);

  const far = head();
  for (const p of far) {
    p.x = 0.5 + (p.x - 0.5) * 0.2;
    p.y = 0.46 + (p.y - 0.46) * 0.2;
  }
  assert.ok(frameQuality(far, { W, H }).reasons.includes("closer"), "دور بودن ⇒ closer");

  const turned = head({ yaw: 0.55 });
  assert.ok(frameQuality(turned, { W, H }).reasons.includes("frontal"), "چرخیدن ⇒ frontal");

  const blinked = head({ openEyes: false });
  assert.ok(frameQuality(blinked, { W, H }).reasons.includes("eyes"), "پلک بسته ⇒ eyes");

  const tilted = head({ roll: 22 });
  assert.ok(frameQuality(tilted, { W, H }).reasons.includes("level"), "کجی سر ⇒ level");

  const noFace = frameQuality([], { W, H });
  assert.equal(noFace.ok, false);
  assert.deepEqual(noFace.reasons, ["noface"]);
});

test("robust: داده‌های پرت را حذف می‌کند", () => {
  const clean = Array.from({ length: 40 }, () => 63 + (Math.random() - 0.5) * 0.4);
  const dirty = [...clean, 78, 51, 82];
  const a = robust(clean);
  const b = robust(dirty);
  assert.ok(Math.abs(a.value - 63) < 0.5, "میانه: " + a.value);
  assert.ok(Math.abs(b.value - 63) < 0.6, "با داده‌های پرت هم باید همان باشد: " + b.value);
  assert.ok(b.confidence < a.confidence, "اطمینان باید کم شود");
  assert.equal(robust([]).n, 0);
});

test("FaceScan: سه مرحله و گزارش نهایی", () => {
  const irisPx = 11.7 * 0.0044 * W;
  const scan = new FaceScan({ need: 20 });
  scan.start(0);
  const lms = head({ pdMm: 63 });
  const ctx = { W, H, irisDiaPx: irisPx, fps: 30 };
  // نخست چند فریم تا مرحلهٔ جای‌گیری
  let out = null;
  for (let i = 0; i < 10; i++) out = scan.push(lms, { ...ctx, t: i * 33 });
  assert.equal(out.stage, "still", "باید به مرحلهٔ بی‌حرکتی برسد: " + out.stage);
  for (let i = 10; i < 30; i++) out = scan.push(lms, { ...ctx, t: i * 33 });
  assert.equal(out.stage, "measure", "باید به مرحلهٔ اندازه‌گیری برسد: " + out.stage);
  assert.ok(out.progress > 0.2 && out.progress < 1, "پیشرفت: " + out.progress);
  for (let i = 30; i < 60; i++) out = scan.push(lms, { ...ctx, t: i * 33 });
  assert.equal(out.stage, "done");
  assert.equal(out.progress, 1);
  const r = out.report;
  assert.ok(r && r.frames >= 20, "تعداد فریم: " + (r && r.frames));
  assert.ok(Math.abs(r.pd - 63) < 1.5, "PD نهایی: " + r.pd);
  assert.ok(Math.abs(r.pdMono.l - 31.5) < 1.5, "PD تک‌چشمی: " + r.pdMono.l);
  assert.ok(Math.abs(r.bridge - 18) < 2, "پل: " + r.bridge);
  assert.ok(Math.abs(r.temple - 126) < 2, "شقیقه: " + r.temple);
  assert.ok(r.quality > 70, "کیفیت کلی: " + r.quality);
  assert.ok(r.confidence.pd > 70, "اطمینان PD: " + r.confidence.pd);
  assert.ok(["oval", "oblong", "round", "square"].includes(r.shape), "شکل: " + r.shape);
});

test("FaceScan: فریم‌های بد کنار گذاشته می‌شوند", () => {
  const irisPx = 11.7 * 0.0044 * W;
  const scan = new FaceScan({ need: 12 });
  scan.start(0);
  const good = head();
  const bad = head({ openEyes: false });
  let t = 0;
  for (let i = 0; i < 8; i++) out_push(scan, good, { W, H, irisDiaPx: irisPx, fps: 30, t: (t += 33) });
  for (let i = 0; i < 40; i++) {
    out_push(scan, i % 2 ? bad : good, { W, H, irisDiaPx: irisPx, fps: 30, t: (t += 33) });
    if (scan.done) break;
  }
  function out_push(s, l, c) {
    return s.push(l, c);
  }
  assert.equal(scan.stage, "done");
  // نیمی از فریم‌ها پلک بسته بود ⇒ باید دور ریخته شده باشند
  assert.ok(scan.samples.length <= 13, "فریم‌های خراب نباید وارد گزارش شوند: " + scan.samples.length);
  assert.ok(Math.abs(scan.report.pd - 63) < 1.5, "PD: " + scan.report.pd);
});

test("buildScanMesh: مثلث‌های یک‌طرفه و نرمالِ واحد", () => {
  const lms = head();
  const { mesh, points, scale } = headMeshFromLandmarks(lms, { W, irisDiaPx: 11.7 * 0.0044 * W });
  assert.ok(points.length === 478);
  assert.ok(scale > 0);
  assert.ok(mesh.triangles > 300, "تعداد مثلث: " + mesh.triangles);
  assert.equal(mesh.positions.length, mesh.vertices * 3);
  assert.ok(mesh.vertices > 200 && mesh.vertices <= 478, "رأس‌های فشرده: " + mesh.vertices);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const L = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    assert.ok(L > 0.9 && L < 1.1, "نرمالِ واحد نیست: " + L);
  }
  // مقیاس میلی‌متری: فاصلهٔ دو مردمک باید ۶۳ میلی‌متر باشد
  const a = points[LM.irisL],
    b = points[LM.irisR];
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 63) < 1.5, "مقیاس میلی‌متری: " + Math.hypot(a.x - b.x, a.y - b.y));
  const small = buildScanMesh([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], { maxEdge: 0.5 });
  assert.equal(small.indices.length, 0, "بدون همسایه ⇒ بدون مثلث");
});

test("headMeshFromLandmarks: سرِ کج تراز می‌شود", () => {
  const lms = head({ roll: 18 });
  const { points, rollDeg } = headMeshFromLandmarks(lms, { W, irisDiaPx: 11.7 * 0.0044 * W });
  assert.ok(Math.abs(rollDeg - 18) < 0.5, "زاویهٔ خام: " + rollDeg);
  const a = points[LM.irisL],
    b = points[LM.irisR];
  assert.ok(Math.abs(b.y - a.y) < 0.4, "پس از تراز، چشم‌ها هم‌ترازند: " + (b.y - a.y));
  assert.ok(a.x < 0 && b.x > 0, "محورِ x معکوس شد (چپ/راستِ مختصاتِ سه‌بعدی)");
});

test("suggestSize: اندازهٔ فریم از روی اسکن", () => {
  const s = suggestSize({ temple: 126, bridge: 18 }, ["48", "50", "52", "54"]);
  assert.equal(s.size, "54", "عرض فریم ۱۳۴ ⇒ ۵۴: " + s.size);
  assert.ok(Math.abs(s.lensW - 57.6) < 1.2, "عرض عدسی: " + s.lensW);
  assert.ok(Math.abs(s.dbn - 17.3) < 1, "پل (استاندارد ۱۸): " + s.dbn);
  assert.equal(suggestSize(null), null);
});

test("interpupillaryPx با مدلِ بدونِ عنبیه هم کار می‌کند", () => {
  const lms = head().slice(0, 468);
  assert.ok(interpupillaryPx(lms) > 0);
  const m = measureFrame(lms, { W, irisDiaPx: 11.7 * 0.0044 * W });
  assert.ok(m.pd > 40 && m.pd < 90, "PD: " + m.pd);
});
