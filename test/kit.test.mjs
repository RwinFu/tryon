/**
 * kit.test.mjs — تستِ خطِّ تولیدِ «۳ عکس → فریم آماده»
 *
 * سه لایه را جداگانه می‌سنجد:
 *   ۱) matte.js    حذف پس‌زمینه، ماندنِ داخلِ عدسی، حذفِ نویز و سایه
 *   ۲) kit.js      اندازه‌گیری، رخِ دسته، چفت‌کردن و کنترلِ کیفیت
 *   ۳) decals.js   نشستنِ بافت روی هندسهٔ واقعی (بدون WebGL؛ فقط ریاضیِ مش)
 *
 * تصویرها مصنوعی و قطعی‌اند (بدون فایل خارجی) تا تست در هر جایی سبز باشد.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { cutout, isBlank, suppressShadow, signedDistance } from "../src/frame/matte.js";
import { buildFrameKit, templeProfile, applyFix, rotate90, flipX } from "../src/frame/kit.js";
import { buildDecals } from "../src/frame/decals.js";
import { buildFrame } from "../src/frame/geometry.js";

/* ── ابزارِ ساختِ تصویر ───────────────────────────────────────────────── */
const blank = (w, h, bg = [255, 255, 255]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = bg[0];
    d[i + 1] = bg[1];
    d[i + 2] = bg[2];
    d[i + 3] = 255;
  }
  return { width: w, height: h, data: d };
};
const put = (im, x, y, c) => {
  const p = (y * im.width + x) * 4;
  im.data[p] = c[0];
  im.data[p + 1] = c[1];
  im.data[p + 2] = c[2];
  im.data[p + 3] = 255;
};

/** فریمِ استاتِ ساده: رویهٔ تیره، دو حفرهٔ عدسیِ سفید، پل وسط */
function frontPhoto({ w = 600, h = 300, lens = [95, 265, 108, 192], frame = [60, 540, 90, 210] } = {}) {
  const im = blank(w, h);
  for (let y = frame[2]; y <= frame[3]; y++)
    for (let x = frame[0]; x <= frame[1]; x++) {
      const inLens = ((x > lens[0] && x < lens[1]) || (x > w - lens[1] && x < w - lens[0])) && y > lens[2] && y < lens[3];
      put(im, x, y, inLens ? [255, 255, 255] : [32, 34, 38]);
    }
  // پل
  for (let y = 120; y <= 175; y++) for (let x = lens[1]; x <= w - lens[1]; x++) put(im, x, y, [32, 34, 38]);
  return im;
}

/** دستهٔ مصنوعی: نوارِ افقی، کلفت در لولا، باریک در نوک، با خمِ پشتِ گوش */
function templePhoto({ w = 700, h = 160, hingeLeft = true, drop = 30, thick0 = 26, thick1 = 14 } = {}) {
  const im = blank(w, h, [250, 250, 250]);
  for (let x = 40; x < w - 40; x++) {
    const t = hingeLeft ? (x - 40) / (w - 80) : 1 - (x - 40) / (w - 80);
    const thick = thick0 + (thick1 - thick0) * t;
    const mid = 60 + Math.round(drop * Math.pow(t, 2.2));
    for (let dy = -Math.round(thick / 2); dy <= Math.round(thick / 2); dy++) {
      const y = mid + dy;
      if (y >= 0 && y < h) put(im, x, y, [40, 42, 46]);
    }
  }
  return im;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۱) مات‌گیری
 * ───────────────────────────────────────────────────────────────────────── */

test("matte: داخلِ عدسی شفاف می‌ماند و پس‌زمینه حذف می‌شود", () => {
  const im = frontPhoto();
  // نویز در گوشه + سایهٔ ملایم زیر فریم
  for (let y = 5; y < 14; y++) for (let x = 5; x < 14; x++) put(im, x, y, [20, 20, 20]);
  for (let y = 211; y < 222; y++) for (let x = 65; x < 535; x++) put(im, x, y, [222, 222, 219]);

  const out = cutout(im);
  assert.equal(isBlank(out.image), false);
  assert.ok(out.meta.dropped >= 1, "نویز باید حذف شود");
  assert.ok(out.meta.holesKept >= 2, "داخلِ دو عدسی باید باز بماند");

  const at = (x, y) => out.image.data[((y - out.box.y0) * out.image.width + (x - out.box.x0)) * 4 + 3];
  assert.equal(at(180, 150), 0, "مرکزِ عدسی باید شفاف باشد");
  assert.equal(at(200, 95), 255, "روی رینگ باید کدر باشد");
  assert.ok(out.image.width < im.width, "برش باید تنگ‌تر از تصویر اصلی باشد");
});

test("matte: فاصلهٔ علامت‌دار درونِ سوراخ منفی است", () => {
  const w = 40,
    h = 40;
  const mask = new Uint8Array(w * h);
  for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) if (x < 14 || x > 26 || y < 14 || y > 26) mask[y * w + x] = 1;
  const sd = signedDistance(mask, w, h);
  assert.ok(sd[20 * w + 20] < 0, "مرکزِ حفره باید منفی باشد");
  assert.ok(sd[10 * w + 20] > 0, "روی نوار باید مثبت باشد");
});

test("matte: سایهٔ هم‌رنگ با پس‌زمینه حذف می‌شود، ولی قطعهٔ تیره نه", () => {
  const w = 60,
    h = 20;
  const im = blank(w, h);
  for (let y = 6; y < 12; y++) for (let x = 10; x < 50; x++) put(im, x, y, [30, 30, 32]); // قطعهٔ مشکی
  for (let y = 12; y < 15; y++) for (let x = 12; x < 48; x++) put(im, x, y, [200, 200, 200]); // سایه
  // آلفا: قطعه و سایه کدر، بقیه شفاف (همان خروجیِ مرحلهٔ ماسک)
  const alpha = new Float32Array(w * h);
  for (let y = 6; y < 15; y++) for (let x = 10; x < 50; x++) alpha[y * w + x] = 1;
  const { removed } = suppressShadow(im.data, w, h, alpha, [255, 255, 255]);
  assert.ok(removed > 0, "سایه باید تا حدی حذف شود");
  // قطعه (سطر ۸) همچنان کدر است
  assert.ok(alpha[8 * w + 30] > 0.9, "خودِ قطعه نباید بُریده شود");
});

/* ─────────────────────────────────────────────────────────────────────────
 *  ۲) رخِ دسته
 * ───────────────────────────────────────────────────────────────────────── */

test("templeProfile: لولا را می‌شناسد و عکسِ برعکس را برمی‌گرداند", () => {
  const cut = cutout(templePhoto({ hingeLeft: true }), { pieces: 1 });
  const a = templeProfile(cut.image, { templeLen: 145 });
  assert.ok(a.ok);
  assert.equal(a.flipped, false, "لولا در چپ است؛ نباید برگردد");
  assert.ok(Math.abs(a.lengthMm - 145) < 1, `طول باید همان ۱۴۵mm باشد، شد ${a.lengthMm}`);

  const cut2 = cutout(templePhoto({ hingeLeft: false }), { pieces: 1 });
  const b = templeProfile(cut2.image, { templeLen: 145 });
  assert.ok(b.ok);
  assert.equal(b.flipped, true, "لولا در راست بود؛ باید برگردد");
  assert.ok(Math.abs(a.taper - b.taper) < 0.2, `نسبتِ باریک‌شوندگی دو جهت باید نزدیک باشد (${a.taper} / ${b.taper})`);
  assert.ok(Math.abs(a.earDropMm - b.earDropMm) < 4, `افتِ دو جهت باید نزدیک باشد (${a.earDropMm} / ${b.earDropMm})`);
});

test("templeProfile: عکسِ عمودی را می‌چرخاند و مقیاس را از طولِ چاپی می‌گیرد", () => {
  const horiz = templePhoto({ hingeLeft: true });
  const vert = rotate90(horiz, 1);
  assert.equal(vert.width, horiz.height);
  const a = templeProfile(cutout(horiz, { pieces: 1 }).image, { templeLen: 150 });
  const b = templeProfile(cutout(vert, { pieces: 1 }).image, { templeLen: 150 });
  assert.ok(b.ok && b.rotated, "عمودی باید چرخانده شود");
  assert.ok(Math.abs(a.lengthMm - b.lengthMm) < 2, `طولِ افقی/عمودی یکی است (${a.lengthMm} / ${b.lengthMm})`);
});

test("flipX تصویر را آینه می‌کند و ابعاد را نگه می‌دارد", () => {
  const im = templePhoto({ hingeLeft: true });
  const f = flipX(im);
  assert.equal(f.width, im.width);
  assert.equal(f.height, im.height);
  // ستونِ x باید همان سطرهایِ جوهر را در ستونِ آینه‌شده داشته باشد
  const inkRows = (img, x) => {
    const rows = [];
    for (let y = 0; y < img.height; y++) if (img.data[(y * img.width + x) * 4] < 200) rows.push(y);
    return rows.join(",");
  };
  const a = inkRows(im, 60);
  const b = inkRows(f, im.width - 1 - 60);
  assert.equal(a, b, "ستونِ آینه‌شده باید همان سطرهای جوهر را داشته باشد");
  assert.notEqual(a, inkRows(f, 60), "ستونِ ثابت نباید بی‌تغییر مانده باشد (دسته نامتقارن است)");
});

/* ─────────────────────────────────────────────────────────────────────────
 *  ۳) خطِ تولید
 * ───────────────────────────────────────────────────────────────────────── */

test("buildFrameKit: سه عکس → فریمِ آماده با اندازه‌های معقول", () => {
  const kit = buildFrameKit(
    {
      front: frontPhoto(),
      templeR: templePhoto({ hingeLeft: true }),
      templeL: templePhoto({ hingeLeft: false }),
    },
    { lensW: 52, dbn: 18, templeLen: 145, name: "تست" },
  );
  assert.ok(kit.ok, "ساخت باید موفق شود: " + JSON.stringify(kit.qa));
  assert.ok(!kit.qa.some((q) => q.level === "fail"), "هیچ بررسی نباید مردود شود: " + JSON.stringify(kit.qa));

  assert.ok(kit.spec.lensW > 30 && kit.spec.lensW < 66, "عرض عدسی معقول: " + kit.spec.lensW);
  assert.ok(kit.spec.dbn > 8 && kit.spec.dbn < 28, "پل معقول: " + kit.spec.dbn);
  assert.equal(kit.spec.templeLen, 145, "طولِ دسته همان عددِ چاپی");
  assert.ok(kit.spec.earDrop >= 0 && kit.spec.earDrop < 25, "افت معقول: " + kit.spec.earDrop);
  assert.ok(kit.spec.lensPath?.length > 20, "خطِ عدسی باید استخراج شود");
  assert.ok(kit.decals.front && kit.decals.templeL && kit.decals.templeR, "هر سه بافت باید باشند");
  assert.ok(kit.decals.front.wMm > 60 && kit.decals.front.wMm < 220, "پهنای بافت معقول: " + kit.decals.front.wMm);
  assert.match(kit.product.size, /^\d+□\d+-\d+$/);
  assert.equal(kit.product.decals.front, `assets/frames/${kit.product.id}-front.png`);
});

test("buildFrameKit: با فقط عکسِ جلو هم خروجی می‌دهد (دسته فرضی)", () => {
  const kit = buildFrameKit({ front: frontPhoto() }, { lensW: 52 });
  assert.ok(kit.ok);
  assert.equal(kit.spec.templeLen, 145, "بدون عکسِ دسته، ۱۴۵mm فرض می‌شود");
  assert.ok(kit.qa.some((q) => q.id === "temple.none" && q.level === "warn"));
  assert.ok(!kit.decals.templeL && !kit.decals.templeR);
});

test("buildFrameKit: بدون عکسِ جلو، خطا و پیشنهاد می‌دهد", () => {
  const kit = buildFrameKit({ templeR: templePhoto() });
  assert.equal(kit.ok, false);
  assert.equal(kit.reason, "no-front");
  assert.ok(kit.qa.some((q) => q.level === "fail"));
});

test("applyFix: تغییرِ عرضِ عدسی، خطِ ترسیم‌شده و بافت را هم‌مقیاس می‌کند", () => {
  const kit = buildFrameKit({ front: frontPhoto(), templeR: templePhoto(), templeL: templePhoto({ hingeLeft: false }) }, { lensW: 52 });
  const before = kit.decals.front.wMm;
  const pathBefore = kit.spec.lensPath[0];
  applyFix(kit, { lensW: 60 });
  assert.equal(kit.spec.lensW, 60);
  const k = 60 / 52;
  assert.ok(Math.abs(kit.decals.front.wMm - before * k) < 0.6, "بافت باید هم‌مقیاس شود");
  const p = kit.spec.lensPath[0];
  const fx = Array.isArray(p) ? p[0] : p.x;
  const bx = Array.isArray(pathBefore) ? pathBefore[0] : pathBefore.x;
  assert.ok(Math.abs(fx - bx * k) < 0.6, "خطِ عدسی باید هم‌مقیاس شود");
  assert.match(kit.product.size, /^60□/);
});

test("applyFix: جنس/پرداخت/رنگ به محصول هم منتقل می‌شود", () => {
  const kit = buildFrameKit({ front: frontPhoto() }, { lensW: 52 });
  applyFix(kit, { material: "metal", finish: "gold", color: "#b08d57" });
  assert.equal(kit.spec.material, "metal");
  assert.equal(kit.product.material, "metal");
  assert.equal(kit.product.finish, "gold");
  assert.equal(kit.product.color, "#b08d57");
});

/* ─────────────────────────────────────────────────────────────────────────
 *  ۴) نشستنِ بافت روی هندسه (بدون WebGL)
 * ───────────────────────────────────────────────────────────────────────── */

test("decals: بافتِ جلو در محدودهٔ هندسه و روی سطحِ جلوی آن است", () => {
  const kit = buildFrameKit({ front: frontPhoto(), templeR: templePhoto(), templeL: templePhoto({ hingeLeft: false }) }, { lensW: 52, templeLen: 145 });
  const built = buildFrame({ ...kit.spec });
  const paths = built.parts.filter((p) => p.path && p.path.length > 2).map((p) => ({ name: p.name, role: p.role, path: p.path, sw: p.sw }));
  const meshes = buildDecals(THREE, kit.decals, { paths, spec: kit.spec, quality: "high" });
  assert.ok(meshes.length >= 3, "سه بافت (جلو + دو دسته) باید ساخته شود: " + meshes.length);

  const front = meshes.find((m) => m.name === "decalFront");
  assert.ok(front);
  const pos = front.geometry.getAttribute("position");
  let minZ = Infinity,
    maxZ = -Infinity,
    nan = 0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (!Number.isFinite(z) || !Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i))) nan++;
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  assert.equal(nan, 0, "هیچ مقدارِ نامعلومی در رأس‌ها نیست");

  // همهٔ رأس‌ها باید جلویِ میانگینِ فریم باشند و از جعبهٔ فریم بیرون نزنند
  const [minX, minY, minZb] = built.bbox.min;
  const [maxX, maxY, maxZb] = built.bbox.max;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i);
    assert.ok(x >= minX - 14 && x <= maxX + 14, `بیرون‌زدگیِ افقی: ${x}`);
    assert.ok(y >= minY - 14 && y <= maxY + 14, `بیرون‌زدگیِ عمودی: ${y}`);
  }
  assert.ok(maxZ >= maxZb - 6, "بافتِ جلو باید نزدیکِ جلویی‌ترین سطحِ فریم باشد");
  assert.ok(minZ > minZb, "بافت نباید تا انتهای فریم عقب برود");
  void minY;
});

test("decals: نوارِ دسته در امتدادِ مسیرِ دسته است (و نه شناور در فضا)", () => {
  const kit = buildFrameKit({ front: frontPhoto(), templeR: templePhoto(), templeL: templePhoto({ hingeLeft: false }) }, { lensW: 52, templeLen: 145 });
  const built = buildFrame({ ...kit.spec });
  const paths = built.parts.filter((p) => p.path && p.path.length > 2).map((p) => ({ name: p.name, role: p.role, path: p.path, sw: p.sw }));
  const meshes = buildDecals(THREE, kit.decals, { paths, spec: kit.spec });
  const ribbon = meshes.find((m) => m.name === "decalTempleR");
  assert.ok(ribbon, "نوارِ دستهٔ راست باید ساخته شود");
  // مسیرِ کامل = دسته + نوکِ دسته (همان‌طور که decals.js می‌چسباندشان)
  const templePath = [...(paths.find((p) => p.name === "templeR")?.path || []), ...(paths.find((p) => p.name === "tipR")?.path || [])];
  assert.ok(templePath.length > 4);

  const pos = ribbon.geometry.getAttribute("position");
  // فاصله تا «پاره‌خط‌های» مسیر (مسیرِ دسته در هندسه کم‌نقطه است؛ فاصلهٔ تا رأس معیار نیست)
  const distToPath = (v) => {
    let best = Infinity;
    for (let i = 1; i < templePath.length; i++) {
      const a = new THREE.Vector3(templePath[i - 1].x, templePath[i - 1].y, templePath[i - 1].z);
      const b = new THREE.Vector3(templePath[i].x, templePath[i].y, templePath[i].z);
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, v.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
      best = Math.min(best, v.distanceTo(a.clone().add(ab.multiplyScalar(t))));
    }
    return best;
  };
  let worst = 0;
  for (let i = 0; i < pos.count; i += 7) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    worst = Math.max(worst, distToPath(v));
  }
  const reach = kit.spec.templeT / 2 + kit.spec.templeW / 2 + 0.2;
  assert.ok(worst <= reach, `نوار نباید از دسته بیرون بزند (بدترین ${worst.toFixed(2)}mm، مجاز ${reach.toFixed(2)}mm)`);

  // نوارِ سمتِ راست در نیمهٔ مثبتِ x است
  let sumX = 0;
  for (let i = 0; i < pos.count; i++) sumX += pos.getX(i);
  assert.ok(sumX / pos.count > 0, "نوارِ راست باید در سمتِ x مثبت باشد");
});
