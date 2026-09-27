/** عکس محصول → خطوط عدسی (بدون Blender) */
import test from "node:test";
import assert from "node:assert/strict";
import { BG_DIST, bboxOf, bridgeSplit, frameFromImage, guessShape, inkMask } from "../src/frame/photogram.js";
import { buildFrame, normalizeSpec } from "../src/frame/geometry.js";
import { lensOutline } from "../src/frame/shapes.js";

const W = 600;
const H = 240;

/** عکس ساختگی: دو عدسی (حفره) با فریم پیرامونشان، روی پس‌زمینهٔ شفاف */
function synthetic({ rimPx = 14, gapPx = 40, lensW = 190, lensH = 120, opaqueBg = false } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  const cx = W / 2;
  const cy = H / 2;
  const put = (x, y, r, g, b, a) => {
    const i = (y * W + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  };
  if (opaqueBg) for (let i = 0; i < W * H; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255; }
  const box = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        // گوشه‌ها گرد
        const rx = x1 - x0, ry = y1 - y0, rr = 26;
        const dx = Math.max(x - (x1 - rr), x0 + rr - x, 0);
        const dy = Math.max(y - (y1 - rr), y0 + rr - y, 0);
        if (Math.hypot(dx, dy) > rr) continue;
        put(x, y, 40, 34, 30, 255);
      }
  };
  const rightOuterX0 = cx + gapPx / 2, leftOuterX1 = cx - gapPx / 2;
  box(rightOuterX0, cy - lensH / 2 - rimPx, rightOuterX0 + lensW + 2 * rimPx, cy + lensH / 2 + rimPx);
  box(leftOuterX1 - lensW - 2 * rimPx, cy - lensH / 2 - rimPx, leftOuterX1, cy + lensH / 2 + rimPx);
  // پل
  box(cx - gapPx / 2 - 6, cy - lensH / 2 - rimPx, cx + gapPx / 2 + 6, cy - lensH / 2 + 6);
  // حفرهٔ عدسی‌ها (پس‌زمینه/شفاف)
  const hole = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (opaqueBg) put(x, y, 255, 255, 255, 255); else put(x, y, 0, 0, 0, 0);
  };
  hole(rightOuterX0 + rimPx, cy - lensH / 2, rightOuterX0 + rimPx + lensW, cy + lensH / 2);
  hole(leftOuterX1 - rimPx - lensW, cy - lensH / 2, leftOuterX1 - rimPx, cy + lensH / 2);
  return { width: W, height: H, data };
}

test("inkMask: هم alpha و هم رنگ پس‌زمینه را می‌شناسد", () => {
  const t = synthetic();
  const m1 = inkMask(W, H, t.data);
  let ink = 0;
  for (const v of m1) ink += v;
  assert.ok(ink > 12000 && ink < W * H * 0.6, "مساحت فریم منطقی نیست: " + ink);
  assert.equal(m1[2], 0, "گوشهٔ خالی باید پس‌زمینه باشد");

  const o = synthetic({ opaqueBg: true });
  const m2 = inkMask(W, H, o.data);
  assert.ok(m2[2] === 0, "پس‌زمینهٔ سفید نباید جوهر باشد");
  const cy = (H / 2) | 0;
  assert.equal(m2[cy * W + ((W / 2 + 20) | 0)], 1, "فریم تیره روی سفید باید جوهر باشد");
  assert.ok(BG_DIST > 20, "آستانهٔ رنگ نباید خیلی سخت‌گیرانه باشد");
});

test("bbox و split: قاب درست و وسطِ پل", () => {
  const t = synthetic();
  const m = inkMask(W, H, t.data);
  const box = bboxOf(m, W, H);
  assert.ok(box.w > 400 && box.w <= W, "پهنای قاب: " + box.w);
  assert.ok(box.h > 100 && box.h < H, "ارتفاع قاب: " + box.h);
  const split = bridgeSplit(m, W, H, box);
  assert.ok(Math.abs(split - W / 2) < 24, "پل باید وسط باشد: " + split);
});

test("frameFromImage: میلی‌مترها را برمی‌گرداند و هندسه می‌سازد", () => {
  const rimPx = 14,
    gapPx = 40,
    lensWpx = 190,
    lensHpx = 120;
  const t = synthetic({ rimPx, gapPx, lensW: lensWpx, lensH: lensHpx });
  const r = frameFromImage(t, { lensW: 52, samples: 180 });
  assert.equal(r.ok, true, "رد شد: " + r.reason);
  assert.ok(Math.abs(r.dbn - ((gapPx + 2 * rimPx) / lensWpx) * 52) < 1.6, "پل: " + r.dbn);
  assert.ok(Math.abs(r.lensW - 52) < 1.5, "عرض عدسی: " + r.lensW);
  assert.ok(Math.abs(r.lensH - (lensHpx / lensWpx) * 52) < 2, "ارتفاع عدسی: " + r.lensH);
  assert.ok(r.rimW > 2 && r.rimW < 8, "ضخامت رینگ: " + r.rimW);
  assert.ok(r.totalWidth > 105 && r.totalWidth < 150, "پهنای کل: " + r.totalWidth);
  assert.equal(r.shape, "custom");
  assert.ok(r.lensPathR.length >= 24 && r.lensPathL.length >= 24);
  for (const p of r.lensPathR) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.ok(r.match > 80, "پوشش نمونه‌گیری: " + r.match);

  const built = buildFrame({ ...normalizeSpec({ size: "52-18-145", lensW: r.lensW, lensH: r.lensH, dbn: r.dbn, rimW: r.rimW }), lensPath: r.lensPathR, lensPathL: r.lensPathL, lensPathR: r.lensPathR, shape: "custom" });
  assert.ok(built.meta.tris > 3000, "هندسهٔ دنبالی‌شده خالی است");
  assert.ok(built.parts.some((p) => p.name.startsWith("rimR") || p.name.startsWith("rimL")), "رینگ دور عدسی ساخته نشد");
  for (const i of built.roles.lens.position) assert.ok(Number.isFinite(i));
});

test("قوس بالا پایین‌تر از قوس پیشانی نیست (چشم‌انداز گربه‌ای)", () => {
  const t = synthetic({ lensH: 130 });
  const r = frameFromImage(t, { lensW: 52 });
  const top = Math.max(...r.lensPathR.map((p) => p.y));
  const bottom = Math.min(...r.lensPathR.map((p) => p.y));
  assert.ok(top > 0 && bottom < 0 && Math.abs(top + bottom) < 30, "خط عدسی نسبت به مرکز کج است: " + top + "/" + bottom);
  assert.ok(guessShape(r.lensPathR) !== undefined);
});

test("ورودی خراب نباید برنامه را بیندازد", () => {
  const blank = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < blank.length; i += 4) blank[i] = 255;
  const r = frameFromImage({ width: W, height: H, data: blank }, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty");
  const tiny = frameFromImage({ width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) }, {});
  assert.equal(tiny.ok, false);
});

test("شکل‌های واقعیِ کاتالوگ با حدس‌گر درست دسته می‌شوند", () => {
  const wide = lensOutline({ shape: "browline", lensW: 54, lensH: 38 }, 1, 120);
  assert.ok(["browline", "rectangle", "geometric", "shield", "square", "brow"].includes(guessShape(wide)), guessShape(wide));
  const circle = lensOutline({ shape: "round", lensW: 46, lensH: 46 }, 1, 120);
  assert.ok(["round", "roundmetal", "oval", "panto"].includes(guessShape(circle)), guessShape(circle));
});

test("bridgeSplit scans integer columns when the search window has fractional bounds", () => {
  const w = 100, h = 20, mask = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) mask[y * w + 45] = 0;
  const box = { x0: 20, x1: 79, y0: 0, y1: 19, w: 60, h: 20, cx: 49.5, cy: 9.5 };
  assert.equal(bridgeSplit(mask, w, h, box), 45);
});

/* ── عکس واقعیِ گوشی (میز چوبی، نور محیط، سایه) ───────────────────── */
import { appearanceOf, closeMask, foregroundMask, templeFromSidePhoto, traceOverlay } from "../src/frame/photogram.js";
import { phonePhoto, sidePhoto } from "./fixtures/frame-photo.mjs";

/** اندازه‌های واقعیِ فیکسچر: عرض عدسی ۲۱۰ پیکسل برابر ۵۲ میلی‌متر */
const MM = 52 / 210;

test("عکس گوشیِ تمام‌رخ: خط عدسی از داخل عکس و اندازه‌های واقعی", () => {
  const img = phonePhoto({ tilt: 0 });
  const seg = foregroundMask(img.width, img.height, img.data);
  assert.equal(seg.mode, "otsu", "جداسازی باید اوتسو باشد نه پرکردنِ کنارِ کادر");
  assert.equal(seg.holes, 2, "باید دو حفرهٔ عدسی پیدا شود");
  const r = frameFromImage(img, { lensW: 52 });
  assert.equal(r.ok, true, "رد شد: " + r.reason);
  assert.equal(r.source, "holes");
  assert.ok(Math.abs(r.deskewDeg) < 0.4, "عکس صاف است: " + r.deskewDeg);
  assert.ok(Math.abs(r.lensW - 52) < 1.2, "عرض عدسی: " + r.lensW);
  assert.ok(Math.abs(r.lensH - 130 * MM) < 2, "ارتفاع عدسی: " + r.lensH);
  assert.ok(Math.abs(r.dbn - 44 * MM) < 1.2, "پل: " + r.dbn);
  assert.ok(Math.abs(r.rimW - 18 * MM) < 1.2, "ضخامت رینگ: " + r.rimW);
  assert.ok(r.match >= 85, "کیفیت ردیابی: " + r.match);
  const look = appearanceOf(r);
  assert.equal(look.lens, "clear", "عدسی شفاف باید تشخیص داده شود");
  assert.equal(look.material, "acetate");
  // رنگِ واقعیِ فریم: #2e221c
  const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(look.color.slice(i, i + 2), 16));
  assert.ok(Math.abs(cr - 46) < 26 && Math.abs(cg - 34) < 26 && Math.abs(cb - 28) < 26, "رنگ: " + look.color);
  const ov = traceOverlay(r);
  assert.ok(ov && ov.right.length > 40 && ov.left.length > 40, "پیش‌نمایشِ ترسیم باید دو خط داشته باشد");
});

test("عکس کجِ گوشی: زاویهٔ تراز و اندازه‌ها پس از چرخش", () => {
  for (const tilt of [4, -7]) {
    const r = frameFromImage(phonePhoto({ tilt }), { lensW: 52 });
    assert.equal(r.ok, true, "رد شد: " + r.reason);
    assert.ok(Math.abs(r.deskewDeg - tilt) < 0.6, "زاویهٔ تراز " + tilt + " ⇒ " + r.deskewDeg);
    assert.ok(Math.abs(r.lensW - 52) < 1.6, "عرض عدسی در تیلت " + tilt + ": " + r.lensW);
    assert.ok(Math.abs(r.dbn - 44 * MM) < 1.6, "پل در تیلت " + tilt + ": " + r.dbn);
  }
});

test("میزِ خاکستری هم مثل چوب کار می‌کند", () => {
  const r = frameFromImage(phonePhoto({ tilt: 3, desk: "grey" }), { lensW: 52 });
  assert.equal(r.ok, true, "رد شد: " + r.reason);
  assert.equal(r.source, "holes");
  assert.ok(Math.abs(r.lensW - 52) < 1.6, "عرض عدسی: " + r.lensW);
  assert.ok(r.match >= 80, "کیفیت: " + r.match);
});

test("عدسی تیره: از لبهٔ بیرونی و با هشدارِ کیفیت پایین", () => {
  const r = frameFromImage(phonePhoto({ lensDark: true }), { lensW: 52 });
  assert.equal(r.ok, true, "رد شد: " + r.reason);
  assert.equal(r.source, "silhouette", "حفره‌ای نیست ⇒ باید از سایهٔ بیرونی ساخته شود");
  assert.ok(Math.abs(r.lensW - 52) < 2, "عرض عدسی: " + r.lensW);
  assert.ok(Math.abs(r.lensH - 130 * MM) < 4, "ارتفاع عدسی: " + r.lensH);
  assert.ok(r.match < 85, "کیفیت باید پایین گزارش شود: " + r.match);
  assert.equal(appearanceOf(r).lens, "photo", "عدسی تیره = فتوتایپ");
});

test("عددِ چاپیِ پل، مقیاس را اصلاح می‌کند", () => {
  const hint = Math.round(44 * MM * 10) / 10;
  const r = frameFromImage(phonePhoto({ tilt: 0 }), { lensW: 52, dbn: hint });
  assert.equal(r.dbn, hint, "وقتی کاربر پل را می‌داند، همان را می‌پذیریم");
  assert.ok(Math.abs(r.lensW - 52) < 1.5, "مقیاس نباید به‌هم بخورد: " + r.lensW);
});

test("عکس جانبی: طول دسته از روی نسبتِ تصویر", () => {
  const side = templeFromSidePhoto(sidePhoto({}), { armPx: 168, templeLen: 145 });
  assert.equal(side.ok, true, "رد شد: " + side.reason);
  assert.ok(Math.abs(side.templeLen - 145) < 10, "طول دسته: " + side.templeLen);
  assert.ok(side.confidence > 60, "اطمینان: " + side.confidence);
});

test("closeMask حلقهٔ نازک را می‌بندد بی‌آنکه فریم را بخورد", () => {
  const img = phonePhoto({});
  const seg = foregroundMask(img.width, img.height, img.data);
  const count = (m) => m.reduce((a, b) => a + b, 0);
  const before = count(seg.mask);
  const copy = new Uint8Array(seg.mask);
  assert.equal(closeMask(copy, img.width, img.height), true, "حلقهٔ رینگ باید بسته شود");
  const after = count(copy);
  assert.ok(after >= before, "بستنِ حفره نباید جوهر کم کند");
  assert.ok(after - before < before * 0.28, "رشدِ بیش از حد: " + (after - before) / before);
});
