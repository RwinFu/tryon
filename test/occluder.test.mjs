/**
 * سرِ نامرئی باید دسته‌ها را پشت گونه ببُرد، نه اینکه جلوی عدسی را پاک کند.
 * (باگ: کرهٔ قبلی حدود ۴ سانتی‌متر جلوتر از عدسی بود و عینک اصلاً دیده نمی‌شد.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildFrame } from "../src/frame/geometry.js";
import { CATALOG, toEngineSpec } from "../src/frame/catalog.js";
import { headOccluderParams, insideHead, wallWidth, headFrontZ } from "../src/engine/occluder.js";
import { earAnchor } from "../src/engine/ear-fit.js";
import { specHeadOrigin } from "../src/engine/seating.js";
import { estimatePdMm, IRIS_MM } from "../src/engine/tracking.js";

test("سر نامرئی پشت صفحهٔ چشم است و هیچ نقطهٔ جلوی فریم را نمی‌پوشاند", () => {
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const built = buildFrame(spec, { origin: specHeadOrigin(spec) });
    assert.ok(built.meta.hingeX > 40, product.id + " hingeX ندارد");
    const head = headOccluderParams({ frameHalfWidth: built.meta.hingeX, faceWmm: 145, vertexDistance: 13, origin: specHeadOrigin(spec) });
    assert.ok(head.front <= -17, product.id + " جلوی سر باید پشت عدسی باشد، نه روی آن");
    let covered = 0;
    for (const part of built.parts) {
      if (/^(temple|tip)/.test(part.name)) continue;
      const pos = part.geo.position;
      for (let i = 0; i < pos.length; i += 3) {
        if (insideHead({ x: pos[i], y: pos[i + 1], z: pos[i + 2] }, head)) covered++;
      }
    }
    assert.equal(covered, 0, product.id + " " + covered + " نقطه از جلوی فریم داخل سر است");
  }
});

test("پهنای سر از پهنای فریم نمی‌آید، از خودِ صورت می‌آید", () => {
  // باگِ قدیمی: سر به پهنای لولا محدود می‌شد (rx < hingeX) و دسته‌ها هرگز پشتِ
  // گوش پنهان نمی‌شدند؛ نتیجه: یک سیمِ نازک از جلوی صورت.
  const narrow = headOccluderParams({ frameHalfWidth: 48, faceWmm: 0, vertexDistance: 13 });
  const wide = headOccluderParams({ frameHalfWidth: 78, faceWmm: 0, vertexDistance: 13 });
  assert.ok(Math.abs(narrow.rx - wide.rx) < 0.01, "پهنای سر نباید به پهنای فریم وابسته باشد");
  assert.ok(narrow.rx > 70, "نیم‌پهنای جمجمه باید نزدیکِ پهن‌ترین جایِ صورت باشد: " + narrow.rx);
  assert.ok(narrow.front <= -17 && wide.front <= -17, "جلوی سر همیشه پشتِ عدسی است");
  // دیوارهٔ سر باید در عمقِ شقیقه باریک‌تر از گوش باشد و در پشتِ سر بسته شود
  const y = 30;
  const templeW = wallWidth(y, headFrontZ() - 10);
  const earW = wallWidth(y, headFrontZ() - 60);
  assert.ok(earW > templeW, `سر باید از شقیقه به گوش پهن‌تر شود: ${templeW.toFixed(1)} → ${earW.toFixed(1)}`);
  // دیواره از جلوی صورت تا گوش یکنوا باز می‌شود (بیضی/جعبهٔ گرد نبود)
  const front = wallWidth(y, headFrontZ() - 1);
  const mid = wallWidth(y, headFrontZ() - 30);
  assert.ok(front < mid && mid < earW, `دیوارهٔ سر باید یکنوا پهن شود: ${front.toFixed(1)} → ${mid.toFixed(1)} → ${earW.toFixed(1)}`);
  assert.ok(front < 40, "جلوی سر باید باریک باشد، نه یک تختهٔ پهن: " + front.toFixed(1));
  const chin = wallWidth(-84, headFrontZ() - 60);
  assert.ok(chin > 4 && chin < wallWidth(0, headFrontZ() - 60) * 0.7, "نزدیکِ چانه باید باریک‌تر از گونه باشد: " + chin.toFixed(1));
  // لالهٔ گوش بیرون‌تر از جمجمه است و دسته روی همان می‌نشیند
  const ear = earAnchor();
  assert.ok(ear.lateral > ear.boundary, "لالهٔ گوش باید بیرون‌تر از خطِ صورت باشد");
});

test("PD از قطر عنبیه حساب می‌شود و به کفِ ۵۲ قفل نمی‌شود", () => {
  // ۵۴ پیکسل بین مردمک‌ها، ۱۰ پیکسل قطر عنبیه → ۵۴ × ۱۱٫۷ / ۱۰
  const pd = estimatePdMm(54, 10);
  assert.ok(Math.abs(pd - (54 * IRIS_MM) / 10) < 0.05, String(pd));
  assert.ok(pd > 58, "فرمول قدیمی همین نسبت را به ۵۲ میلی‌متر می‌چسباند");
  assert.equal(estimatePdMm(0, 10), null);
  assert.equal(estimatePdMm(54, 0), null);
  assert.ok(estimatePdMm(200, 4) <= 78, "باید سقف داشته باشد");
});
