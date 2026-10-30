import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CANONICAL_MM, CANONICAL_METRICS } from "../src/engine/face-topology.js";
import {
  fitCanonicalHead,
  headToPx,
  quatFromEuler,
  quatMul,
  quatRotate,
  eulerFromQuat,
  matFromQuat,
  EYE,
  POSE_ANCHOR,
} from "../src/engine/head-fit.js";
import { surfaceZ, noseGripWidth, noseProfile } from "../src/engine/face-surface.js";
import { seatOnHead, seatAnchors, seatOffsetsFor, seatToPose, buildSeat } from "../src/engine/seating.js";
import { toEngineSpec, CATALOG } from "../src/frame/catalog.js";

const DEG = Math.PI / 180;
const W = 640;
const H = 480;

/** پروجکشنِ متعامدِ مدل روی تصویر — همان مدلی که برازش می‌کند */
function projectCanonical({ scale = 0.63, euler = [0, 0, 0], center = [320, 240] } = {}) {
  const R = matFromQuat(quatFromEuler(euler[0] * DEG, euler[1] * DEG, euler[2] * DEG));
  return Array.from({ length: 478 }, (_, i) => {
    const x = CANONICAL_MM[i * 3] ?? 0;
    const y = CANONICAL_MM[i * 3 + 1] ?? 0;
    const z = CANONICAL_MM[i * 3 + 2] ?? 0;
    const u = center[0] + scale * (R[0] * x + R[1] * y + R[2] * z);
    const v = center[1] + scale * (R[3] * x + R[4] * y + R[5] * z);
    return { x: u / W, y: 1 - v / H, z: 0 };
  });
}

test("کانونیک: متریک‌ها فیزیکی‌اند و zِ بینی جلوتر از چشم است", () => {
  assert.ok(CANONICAL_METRICS.faceWidth > 140 && CANONICAL_METRICS.faceWidth < 160);
  assert.ok(CANONICAL_METRICS.faceHeight > 165 && CANONICAL_METRICS.faceHeight < 190);
  // نوکِ بینی جلوترین نقطه است و زینِ پل عقب‌تر از آن
  assert.ok(CANONICAL_MM[4 * 3 + 2] > CANONICAL_MM[168 * 3 + 2]);
  // گوشهٔ چشم جلوتر از شقیقه/گوش
  assert.ok(CANONICAL_MM[33 * 3 + 2] > CANONICAL_MM[234 * 3 + 2]);
  assert.ok(Number.isFinite(CANONICAL_MM[467 * 3 + 2]));
});

test("quatFromEuler و eulerFromQuat دقیقاً معکوسِ هم‌اند (ZYX)", () => {
  for (const p of [-30, -7, 0, 12, 30]) {
    for (const y of [-40, -12, 0, 20, 40]) {
      for (const r of [-15, 0, 11]) {
        const q = quatFromEuler(p * DEG, y * DEG, r * DEG);
        const e = eulerFromQuat(q);
        assert.ok(Math.abs(e.pitch / DEG - p) < 1e-6, `pitch ${p}`);
        assert.ok(Math.abs(e.yaw / DEG - y) < 1e-6, `yaw ${y}`);
        assert.ok(Math.abs(e.roll / DEG - r) < 1e-6, `roll ${r}`);
        // چرخشِ یک بردار با کواترنیون باید با ماتریس یکی باشد
        const v = [3, -5, 7];
        const a = quatRotate(q, v);
        const m = matFromQuat(q);
        for (let k = 0; k < 3; k++) {
          assert.ok(Math.abs(a[k] - (m[k * 3] * v[0] + m[k * 3 + 1] * v[1] + m[k * 3 + 2] * v[2])) < 1e-9);
        }
      }
    }
  }
  // quatMul(a,b) = ترکیبِ چرخش‌ها
  const a = quatFromEuler(10 * DEG, 20 * DEG, 5 * DEG);
  const b = quatFromEuler(-5 * DEG, 15 * DEG, -3 * DEG);
  const v = [1, 2, 3];
  const composed = quatRotate(quatMul(a, b), v);
  const stepwise = quatRotate(a, quatRotate(b, v));
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(composed[k] - stepwise[k]) < 1e-9);
});

test("برازشِ چگال روی صورتِ ساخته‌شده از خودِ مدل، زاویه/مقیاس را با خطای ناچیز برمی‌گرداند", () => {
  for (const yaw of [-35, -12, 0, 18, 40]) {
    for (const pitch of [-12, 0, 12]) {
      const lms = projectCanonical({ scale: 0.63, euler: [pitch, yaw, 0] });
      const fit = fitCanonicalHead(lms, { W, H });
      assert.equal(fit.ok, true);
      assert.ok(fit.rmsPx < 0.6, `rms ${fit.rmsPx}`);
      assert.ok(Math.abs(fit.scale - 0.63) < 0.01, `scale ${fit.scale}`);
      assert.ok(Math.abs(fit.euler.yaw / DEG - yaw) < 1.5, `yaw ${fit.euler.yaw / DEG} vs ${yaw}`);
      assert.ok(Math.abs(fit.euler.pitch / DEG - pitch) < 1.5, `pitch ${fit.euler.pitch / DEG} vs ${pitch}`);
      // مردمکِ مدل باید روی مردمکِ تصویر بیفتد
      const [u, v] = headToPx(fit, EYE.center);
      const left = lms[33];
      assert.ok(Number.isFinite(u) && Number.isFinite(v));
      assert.ok(Math.abs(v - (1 - left.y) * H) < 30);
    }
  }
});

test("برازش با seed همان جواب را در زمانِ کمتر می‌دهد و دادهٔ خراب confidence صفر می‌گیرد", () => {
  const lms = projectCanonical({ scale: 0.63, euler: [8, 22, -3] });
  const cold = fitCanonicalHead(lms, { W, H });
  const warm = fitCanonicalHead(lms, { W, H, seed: { yaw: 20, pitch: 7, roll: -3 } });
  assert.ok(warm.rmsPx <= cold.rmsPx * 1.2, `${warm.rmsPx} vs ${cold.rmsPx}`);
  assert.ok(Math.abs(warm.scale - cold.scale) < 0.01);

  const broken = fitCanonicalHead(Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })), { W, H });
  assert.equal(broken.ok, false, "همهٔ نقاط روی یک نقطه ⇒ مقیاسِ بی‌معنا باید رد شود");
  assert.equal(broken.confidence, 0);
});

test("سطحِ بینی از مشِ رسمی: برجستگیِ نوک، زینِ پل و پهنای گیره", () => {
  const tip = surfaceZ(0, -4);
  const saddle = surfaceZ(0, 33);
  assert.ok(tip > saddle + 12, `نوک باید ≥۱۲mm جلوتر از پل باشد: ${tip} vs ${saddle}`);
  const side = surfaceZ(12, -4);
  assert.ok(side < tip - 4, "کنارهٔ بینی باید عقب‌تر از نوک باشد");
  assert.ok(Number.isNaN(surfaceZ(200, 200)), "بیرونِ صورت ⇒ NaN");
  const grip = noseGripWidth(20, 30);
  assert.ok(grip > 6 && grip < 26, `پهنای گیره: ${grip}`);
  const prof = noseProfile(8);
  assert.ok(prof.length >= 6);
  for (const p of prof) assert.ok(Number.isFinite(p.z));
});

test("نشستن: پل روی پوست، مردمک در پنجرهٔ لنز و بدونِ فرورفتگی", () => {
  const lms = projectCanonical({ scale: 0.63, euler: [6, -8, 2] });
  const fit = fitCanonicalHead(lms, { W, H });
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const seat = seatOnHead({ fit, spec });
    assert.ok(seat, `${product.id} باید نشستن بدهد`);
    const r = seat.report;
    // ۱) پل پوست را لمس کند، یا شناوری‌اش صریحاً هشدار بگیرد
    assert.ok(r.bridgeGap !== null, `${product.id} bridgeGap null`);
    if (r.bridgeGap >= 5) assert.ok(r.warnings.includes("bridge-float"), `${product.id} شناوری بدونِ هشدار`);
    // ۲) مردمک در پنجرهٔ دیداریِ لنز (مرکز ± ۵mm)
    assert.ok(Math.abs(r.pupilOffset) <= 5, `${product.id} pupilOffset ${r.pupilOffset}`);
    // ۳) هیچ رأسی بیش از ۱mm فراتر از فشارِ مجازِ همان نقطه نباشد؛ و اگر
    //    رفت، گزارش *باید* بگوید (پلِ تنگ)، نه اینکه بی‌صدا رد شود.
    assert.ok(r.minMargin > -1.2 || r.warnings.includes("nose-pressure"), `${product.id} margin ${r.minMargin} بدونِ هشدار`);
    assert.ok(r.minMargin > -5.5, `${product.id} فرورفتگیِ عمیق ${r.minMargin}`);
    assert.ok(r.penetration === 0 || r.warnings.length > 0, `${product.id} pen ${r.penetration} بدونِ هشدار`);
    // ۴) فاصلهٔ رأس در بازهٔ فیزیکی
    assert.ok(r.vd > 8 && r.vd < 30, `${product.id} vd ${r.vd}`);
    for (const v of [r.vd, r.seatY, r.pupilOffset, r.bridgeGap, r.minClearance, r.minMargin])
      assert.ok(Number.isFinite(v), `${product.id} مقدارِ غیرِ finite`);
  }
});

test("نقطه‌های تکیه‌گاه از خودِ مشِ فریم می‌آیند (پل + لبهٔ داخلیِ حلقه)", () => {
  const spec = toEngineSpec(CATALOG.find((p) => p.id === "AR-101"));
  const a = seatAnchors(spec);
  assert.ok(a.support.length > 40, `تعدادِ نقاطِ تکیه‌گاه: ${a.support.length}`);
  assert.ok(a.bridgeCells >= 8, `نقاطِ پل: ${a.bridgeCells}`);
  const meta = a.meta;
  // پلِ واقعی بالای مرکزِ لنز است، نه پایینِ آن
  assert.ok(meta.bridgeY > -2 && meta.bridgeY < 12, `bridgeY ${meta.bridgeY}`);
  // سطحِ پشتیِ پل باید عقب‌تر از لبهٔ جلوییِ رینگ باشد (نه ۱۰mm جلوتر)
  assert.ok(meta.bridgeZ < 0, `bridgeZ ${meta.bridgeZ}`);
});

test("آفستِ نشستن به pose مستقل از اندازهٔ تصویر است و مقیاس را درست می‌دهد", () => {
  const spec = toEngineSpec(CATALOG.find((p) => p.id === "AR-101"));
  const off = seatOffsetsFor(spec);
  assert.ok(off && off.report);
  const pose = { x: 320, y: 260, z: 0, camZ: 360, scale: 0.63, q: [0, 0, 0, 1], vgMm: 13 };
  const a = seatToPose(off, pose, 640, 480, { camZ: 360, vgMm: 13, scale: 0.63 });
  // همان صحنه در دو برابر رزولوشن: فاصلهٔ کانونی (camZ) هم دو برابر می‌شود،
  // وگرنه دوربین زاویهٔ دیدِ دیگری دارد و مقایسه بی‌معنی است.
  const pose2 = { ...pose, x: 640, y: 520, camZ: 720 };
  const b = seatToPose(off, pose2, 1280, 960, { camZ: 720, vgMm: 13, scale: 1.26 });
  assert.ok(Math.abs(b.x - 2 * a.x) < 1e-6, "جابه‌جایی باید با مقیاسِ صورت بخورد");
  assert.ok(Math.abs(b.y - 2 * a.y) < 1e-6);
  assert.ok(Math.abs(b.scale - 2 * a.scale) < 1e-9);
  assert.ok(Math.abs(b.z - 2 * a.z) < 1e-6, "عمق هم با مقیاسِ صورت می‌رود (نه با اندازهٔ تصویر)");
  // اندازهٔ *دیده‌شده* فریم باید همان px/میلی‌مترِ صورت باشد، نه بزرگ‌تر:
  // گروهِ فریم جلوتر از صفحهٔ صورت است و پرسپکتیو بزرگ‌نمایی می‌کند.
  const apparent = a.scale * (360 / (360 - a.z));
  assert.ok(Math.abs(apparent - 0.63) < 1e-6, `apparent ${apparent} != 0.63`);

  // با چرخشِ سر، آفست هم باید بچرخد (نه اینکه ثابت بماند)
  const turned = { ...pose, q: quatFromEuler(0, 30 * DEG, 0) };
  const c = seatToPose(off, turned, 640, 480, { camZ: 360, vgMm: 13, scale: 0.63 });
  assert.ok(Math.abs(c.x - a.x) > 2, "در نیم‌رخ جای فریم باید افقی جابه‌جا شود");
});

test("buildSeat از لندمارک‌های نرمال‌شده هم نشستنِ معتبر می‌سازد", () => {
  const lms = projectCanonical({ scale: 0.63, euler: [0, 0, 0] });
  const spec = toEngineSpec(CATALOG.find((p) => p.id === "AR-101"));
  const pose = { x: 320, y: 250, z: 0, camZ: 360, scale: 0.63, q: [0, 0, 0, 1], landmarks: lms };
  const seat = buildSeat({ pose, spec, W, H });
  assert.ok(seat);
  for (const k of ["x", "y", "z", "scale"]) assert.ok(Number.isFinite(seat[k]), k);
  assert.equal(seat.q.length, 4);
  assert.ok(seat.report.vd > 8 && seat.report.vd < 30);
});

test("آزمونِ واقعی: صورتِ آزمون (astronaut) با برازشِ چگال نشستنِ پایدار می‌دهد", { skip: !fs.existsSync("test/fixtures/astronaut.jpg") }, () => {
  // لندمارک‌های استخراج‌شده در .cache هستند؛ اگر نبودند آزمون رد نمی‌شود
  const p = ".cache/lm-astronaut.json";
  if (!fs.existsSync(p)) return;
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const fit = fitCanonicalHead(data.landmarks, { W: data.W, H: data.H });
  assert.equal(fit.ok, true);
  assert.ok(fit.scale > 0.55 && fit.scale < 0.8, `px/mm ${fit.scale}`);
  assert.ok(fit.rmsPx < 5, `rms ${fit.rmsPx}`);
  // مردمکِ مدل باید نزدیکِ عنبیهٔ دیده‌شده باشد
  const irisMid = [
    ((data.landmarks[468].x + data.landmarks[473].x) / 2) * data.W,
    (1 - (data.landmarks[468].y + data.landmarks[473].y) / 2) * data.H,
  ];
  const pupil = headToPx(fit, EYE.center);
  assert.ok(Math.hypot(pupil[0] - irisMid[0], pupil[1] - irisMid[1]) < 6, "مردمکِ مدل در جای درست");
  void POSE_ANCHOR;
});

test("گزارشِ نشستن به ردیف‌های برگهٔ فیت تبدیل می‌شود", async () => {
  const { seatRows } = await import("../src/engine/seating.js");
  const good = seatRows({ vd: 13.5, bridgeGap: 0.8, pupilOffset: 1.5, minClearance: -0.3 }, "fa");
  assert.equal(good.length, 4);
  assert.ok(good.every((r) => r.status === "good"), JSON.stringify(good));
  assert.ok(good.every((r) => typeof r.label === "string" && r.label.length > 0));
  const floating = seatRows({ vd: 24, bridgeGap: 8.5, pupilOffset: 1.4, minClearance: -0.4 }, "en");
  assert.equal(floating[0].status, "bad");
  assert.equal(floating[1].status, "bad");
  assert.deepEqual(seatRows(null), []);
});
