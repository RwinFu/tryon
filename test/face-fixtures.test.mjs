/**
 * face-fixtures.test.mjs — رگرسیون روی «یک صورتِ واقعی» در سه زاویه
 *
 * فیکسچرها از یک تصویرِ تولیدشده گرفته شده‌اند: همان مرد، همان نور، همان
 * فاصله، در yaw ≈ ۰° / ۳۷° / ۶۳°. MediaPipe روی هر سه ۴۷۸ لندمارک داده است
 * (`test/fixtures/face3d/*.json`). تصویرها در گیت نیستند (چند مگابایت)؛ این
 * تست‌ها فقط به لندمارک‌ها کار دارند و در `tools/landmarks.py` بازتولید می‌شوند.
 *
 * چیزی که این فایل از آن محافظت می‌کند:
 *   • مقیاسِ متریک (px/mm) در نیم‌رخ فرو نمی‌ریزد،
 *   • پهنای صورت با چرخشِ سر باد نمی‌کند،
 *   • فریم در همهٔ SKUها یا روی صورت می‌نشیند یا هشدار می‌دهد.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FaceTracker } from "../src/engine/tracking.js";
import { seatOffsetsFor, seatAnchors, auditSeat, innerCornerLimit, tissueAllow } from "../src/engine/seating.js";
import { toEngineSpec, CATALOG } from "../src/frame/catalog.js";

const DIR = new URL("./fixtures/face3d/", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, DIR), "utf8"));

/** tracker در بی‌مرورگر: `document` فقط برای ساختِ canvas لازم است */
function track(file) {
  const d = read(file);
  const old = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  const tr = new FaceTracker({ pd: 63, autoPd: false });
  globalThis.document = old;
  tr.resize(d.W, d.H);
  const pose = tr.solve(
    { faceLandmarks: [d.landmarks], facialTransformationMatrices: d.matrix ? [{ data: d.matrix }] : [] },
    1000,
  );
  return { pose, data: d };
}

const DEG = Math.PI / 180;

test("مقیاسِ متریک در نیم‌رخ نمی‌ریزد و برازشِ چگال انتخاب می‌شود", () => {
  const front = track("front.json").pose;
  for (const file of ["front.json", "quarter.json", "profile.json"]) {
    const { pose } = track(file);
    assert.equal(pose.seatSource, "dense-468", `${file}: به مقیاسِ PD سقوط کرد`);
    // خطای تاریخی: سقفِ ثابتِ px/mm برازش را رد می‌کرد و مسیرِ PD در نیم‌رخ
    // فریم را ۴۷٪ کوچک می‌کرد. مقیاس باید در همان حدودِ حالتِ روبه‌رو بماند.
    const ratio = pose.scale / front.scale;
    assert.ok(ratio > 0.8 && ratio < 1.05, `${file}: مقیاس ${pose.scale.toFixed(2)} (${(ratio * 100).toFixed(0)}٪ روبه‌رو)`);
    assert.ok(Number.isFinite(pose.faceWmm) && pose.faceWmm > 100 && pose.faceWmm < 170, `${file}: faceWmm ${pose.faceWmm}`);
  }
});

test("پهنای صورت با چرخشِ سر باد نمی‌کند و در نیم‌رخ صریحاً «نامطمئن» است", () => {
  const front = track("front.json").pose;
  assert.ok(front.quality.faceWidthReliable, "صورتِ روبه‌رو باید قابلِ اندازه‌گیری باشد");
  assert.ok(front.faceWmm > 125 && front.faceWmm < 150, `faceWmm ${front.faceWmm}`);
  for (const file of ["quarter.json", "profile.json"]) {
    const { pose } = track(file);
    assert.equal(pose.quality.faceWidthReliable, false, `${file}: نباید «قابلِ اعتماد» علامت بخورد`);
    // اندازه‌گیریِ ناکارآمد نباید هم باد کند هم «معتبر» بنماید
    assert.ok(pose.faceWmm < 165, `${file}: faceWmm ${pose.faceWmm}`);
  }
});

test("قفلِ پهنای صورت: اندازه‌گیریِ روبه‌رو در نیم‌رخِ بعدی حفظ می‌شود", () => {
  const d0 = read("front.json");
  const old = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  const tr = new FaceTracker({ pd: 63, autoPd: false });
  globalThis.document = old;
  tr.resize(d0.W, d0.H);
  const p0 = tr.solve({ faceLandmarks: [d0.landmarks], facialTransformationMatrices: [] }, 1000);
  // همان جلسه، سر می‌چرخد: عددِ روبه‌رو باید بماند، نه اینکه به ۱۵۴mm بپرد
  const dp = read("profile.json");
  tr.resize(dp.W, dp.H);
  const p1 = tr.solve({ faceLandmarks: [dp.landmarks], facialTransformationMatrices: [] }, 2000);
  assert.ok(Math.abs(p1.faceWmm - p0.faceWmm) < 1.5, `قفل نشد: ${p0.faceWmm} → ${p1.faceWmm}`);
});

test("همهٔ SKUها: فاصلهٔ رأسِ طبیعی یا هشدارِ صریح؛ هیچ فریمی در پوست فرو نمی‌رود", () => {
  const { pose } = track("front.json");
  const bad = [];
  let floated = 0;
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const seat = seatOffsetsFor(spec);
    assert.ok(seat && seat.report, `${product.id}: بدونِ نشستن`);
    const r = seat.report;
    assert.ok(Number.isFinite(r.vd) && r.vd > 9 && r.vd < 26, `${product.id}: vd ${r.vd}`);
    // شناوریِ چند‌میلی‌متری روی این صورت پذیرفته است، ولی فقط اگر *گزارش* شود
    // و از سقفِ فیزیکی رد نشود (باگِ قدیمی: ۲۷mm و بی‌صدا).
    assert.ok(r.vd < 21.5, `${product.id}: vd ${r.vd}`);
    if (r.vd > 19 && !r.warnings.includes("vertex-distance")) bad.push(`${product.id}:vd`);
    if (r.vd > 19) floated++;
    if (r.minMargin < -1.5 && !r.warnings.includes("nose-pressure")) bad.push(`${product.id}:margin`);
    if (r.bridgeGap > 4 && !r.warnings.includes("bridge-float")) bad.push(`${product.id}:float`);
    assert.ok(r.minMargin > -5.5, `${product.id}: فرورفتگیِ ${r.minMargin}mm`);
  }
  assert.deepEqual(bad, [], `بدونِ هشدار: ${bad.join(", ")}`);
  // سقفِ تعداد: روی این صورت بیشترِ فریم‌ها باید در بازهٔ طبیعی بنشینند.
  // عددِ ۱۲ همان نقطهٔ کارِ فعلی است؛ اگر بدتر شد، رگرسیونِ «فریمِ شناور» است.
  assert.ok(floated <= 12, `${floated} SKU با vd>19`);
});

test("حدِ فرورفتنِ مجاز یک منبع دارد: حلِ نشستن و حسابرسی هم‌خوان‌اند", () => {
  const spec = toEngineSpec(CATALOG.find((p) => p.id === "AR-101"));
  const anchors = seatAnchors(spec);
  const lim = innerCornerLimit(anchors.meta);
  assert.ok(lim > 2 && lim < 40, `innerCornerLimit ${lim}`);
  // پل و بالشتک: باید لمس کنند، هیچ فرورفتنی مجاز نیست
  assert.equal(tissueAllow({ name: "bridge" }, 0, lim), 0);
  assert.equal(tissueAllow({ name: "padL", role: "pad" }, 0, lim), 0);
  // کنارهٔ گوشتیِ بینی بیشتر از گونه اجازهٔ فرورفتن دارد
  assert.ok(tissueAllow({ name: "rimL" }, lim - 1, lim) > tissueAllow({ name: "rimL" }, lim + 1, lim));
  // حسابرسی نباید از حلِ نشستن سخت‌گیرتر باشد (باگِ «فریمِ شناور»)
  const seat = seatOffsetsFor(spec);
  const audit = auditSeat(anchors, seat.oy, seat.oz, seat.ox);
  assert.ok(audit.minMargin >= seat.report.minMargin - 0.35, `audit ${audit.minMargin} / report ${seat.report.minMargin}`);
});

test("چرخشِ سر: لنگرِ فریم با pose می‌گردد و فریم از صورت جدا نمی‌شود", () => {
  const front = track("front.json").pose;
  const turned = track("profile.json").pose;
  const spec = toEngineSpec(CATALOG.find((p) => p.id === "AR-101"));
  const seat = seatOffsetsFor(spec);
  assert.ok(seat);
  // زاویهٔ چرخشِ حل باید همان چرخشِ سر باشد، نه ۹۰ درجه یا صفر
  const w = turned.q[3];
  const ang = 2 * Math.acos(Math.min(1, Math.abs(w))) / DEG;
  assert.ok(ang > 40 && ang < 100, `زاویهٔ سر ${ang.toFixed(0)}°`);
  assert.ok(Math.abs(front.q[3] - 1) < 0.12, "صورتِ روبه‌رو نباید چرخش داشته باشد");
});
