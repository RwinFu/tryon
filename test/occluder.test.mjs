/**
 * سرِ نامرئی باید دسته‌ها را پشت گونه ببُرد، نه اینکه جلوی عدسی را پاک کند.
 * (باگ: کرهٔ قبلی حدود ۴ سانتی‌متر جلوتر از عدسی بود و عینک اصلاً دیده نمی‌شد.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildFrame } from "../src/frame/geometry.js";
import { CATALOG, toEngineSpec } from "../src/frame/catalog.js";
import { headOccluderParams, insideHead } from "../src/engine/occluder.js";
import { estimatePdMm, IRIS_MM } from "../src/engine/tracking.js";

test("سر نامرئی پشت صفحهٔ چشم است و هیچ نقطهٔ جلوی فریم را نمی‌پوشاند", () => {
  for (const product of CATALOG) {
    const built = buildFrame(toEngineSpec(product));
    assert.ok(built.meta.hingeX > 40, product.id + " hingeX ندارد");
    const head = headOccluderParams({ frameHalfWidth: built.meta.hingeX, faceWmm: 145, vertexDistance: 13 });
    assert.ok(head.front <= -17, product.id + " جلوی سر باید پشت عدسی باشد، نه روی آن");
    assert.ok(head.rx < built.meta.hingeX, product.id + " سر از لولا پهن‌تر است و دسته را هم می‌بلعد");
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

test("صورت پهن‌تر، سر پهن‌تر می‌شود ولی هرگز از لولا رد نمی‌شود", () => {
  const narrow = headOccluderParams({ frameHalfWidth: 80, faceWmm: 120 });
  const wide = headOccluderParams({ frameHalfWidth: 80, faceWmm: 150 });
  const capped = headOccluderParams({ frameHalfWidth: 62, faceWmm: 180 });
  assert.ok(wide.rx > narrow.rx, "صورت پهن‌تر باید سر پهن‌تری بسازد");
  assert.ok(wide.rx < 80 && capped.rx < 62, "سر نباید از لولا پهن‌تر شود");
  assert.ok(narrow.rx >= 48);
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
