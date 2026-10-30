/**
 * ear-fit.test.mjs — دسته باید روی سر بلغزد و پشتِ گوش پنهان شود.
 *
 * باگِ گزارش‌شدهٔ کاربر: «دسته از جلوی صورت رد می‌شود / یک سیمِ نازک روی صورت».
 * ریشه: مسیر دسته با عددِ ثابت ساخته می‌شد و پهنای سر از پهنای لولا می‌آمد،
 * پس نه به گوش می‌رسید و نه چیزی می‌توانست پشتِ آن پنهانش کند.
 *
 * این تست‌ها همان قرارداد را قفل می‌کنند:
 *  ۱. طولِ دسته با سایزِ چاپیِ فریم یکی باشد؛
 *  ۲. هیچ نقطه‌ای از دسته داخلِ صورت/گونه نباشد (از جلوی صورت رد نشود)؛
 *  ۳. دنبالهٔ پشتِ گوش کامل داخلِ حجمِ سر/لاله باشد (همیشه پنهان)؛
 *  ۴. مسیر پیوسته باشد (پرشِ ناگهانی = دررفتگیِ مش).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG, toEngineSpec } from "../src/frame/catalog.js";
import { buildFrame } from "../src/frame/geometry.js";
import { specHeadOrigin, seatOffsetsFor } from "../src/engine/seating.js";
import { earAnchor, headBoundaryX, headBoundaryZ, headSideX, templePath, arcLength } from "../src/engine/ear-fit.js";
import { headOccluderParams, insideHead, insideEar } from "../src/engine/occluder.js";
import { surfaceZ } from "../src/engine/face-surface.js";

test("لنگَرِ گوش از خودِ صورت ساخته می‌شود، نه از عددِ دستی", () => {
  const ear = earAnchor();
  assert.ok(ear.canal.x > 70 && ear.canal.x < 90, "کانالِ گوش بیرونِ محدودهٔ سر: " + ear.canal.x);
  assert.ok(ear.canal.z < headBoundaryZ(20) - 15, "کانال باید عقب‌تر از لبهٔ گونه باشد");
  assert.ok(ear.top > ear.canal.y && ear.canal.y > ear.lobe, "ترتیبِ ارتفاعِ گوش");
  assert.ok(ear.top - ear.lobe > 45 && ear.top - ear.lobe < 75, "بلندیِ لالهٔ گوش غیرواقعی: " + (ear.top - ear.lobe).toFixed(1));
  assert.ok(ear.lateral > ear.boundary, "لاله باید بیرون‌تر از جمجمه باشد");
  // دیوارهٔ سر در شقیقه از گوش باریک‌تر است و عقب‌تر باریک می‌شود
  const y = ear.canal.y;
  assert.ok(headSideX(0, y) < headSideX(ear.canal.z, y), "سر از شقیقه به گوش باید پهن‌تر شود");
  void headBoundaryX;
});

test("دستهٔ هر فریم به گوش می‌رسد و طولش با سایزِ چاپی می‌خواند", () => {
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const origin = specHeadOrigin(spec);
    const built = buildFrame(spec, { origin });
    const ear = earAnchor();
    const temple = built.parts.find((p) => p.name === "templeR");
    const tip = built.parts.find((p) => p.name === "tipR");
    assert.ok(temple && tip, product.id + ": دسته ساخته نشد");
    // طولِ واقعیِ مسیر (فریم + دنباله) ≈ templeLen
    const guide = templePath({ side: 1, spec: built.spec, hinge: { x: built.meta.hingeX, y: 6, z: -4 }, origin });
    const len = arcLength(guide);
    assert.ok(
      Math.abs(len - spec.templeLen) < 0.28 * spec.templeLen,
      `${product.id}: طولِ دسته ${len.toFixed(0)}mm با سایزِ ${spec.templeLen}mm نمی‌خواند`,
    );
    // نوکِ دسته باید عقب‌تر از کانالِ گوش باشد (نه روی گونه)
    let tipZ = Infinity;
    const pos = tip.geo.position;
    for (let i = 2; i < pos.length; i += 3) tipZ = Math.min(tipZ, pos[i]);
    assert.ok(tipZ + origin.oz < ear.canal.z, `${product.id}: نوکِ دسته به گوش نمی‌رسد (${(tipZ + origin.oz).toFixed(0)} > ${ear.canal.z})`);
  }
});

test("هیچ نقطه‌ای از دسته از جلوی صورت رد نمی‌شود", () => {
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const origin = specHeadOrigin(spec);
    const built = buildFrame(spec, { origin });
    const ear = earAnchor();
    let worst = Infinity;
    let where = null;
    for (const part of built.parts) {
      if (!/^(temple|tip)/.test(part.name)) continue;
      const pos = part.geo.position;
      for (let i = 0; i < pos.length; i += 3) {
        const yH = pos[i + 1] + origin.oy;
        const zH = pos[i + 2] + origin.oz;
        if (zH > ear.edgeZ - 2) continue; // جلوی گونه: دسته آزاد است
        // یا بیرونِ خطِ صورت است، یا عقب‌تر از پوستِ همان نقطه (پس پنهان)
        const skin = surfaceZ(Math.abs(pos[i]), yH);
        if (Number.isFinite(skin) && zH < skin - 0.5) continue;
        const slack = Math.abs(pos[i]) - headBoundaryX(yH);
        if (slack < worst) {
          worst = slack;
          where = { x: +pos[i].toFixed(1), y: +yH.toFixed(1), z: +zH.toFixed(1) };
        }
      }
    }
    assert.ok(worst > -3, `${product.id}: دسته ${Math.abs(worst).toFixed(1)}mm داخلِ صورت رفت (${JSON.stringify(where)})`);
  }
});

test("دنبالهٔ پشتِ گوش کامل پنهان است (داخلِ حجمِ سر یا لالهٔ گوش)", () => {
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const origin = specHeadOrigin(spec);
    const built = buildFrame(spec, { origin });
    const head = headOccluderParams({ vertexDistance: seatOffsetsFor(spec)?.report?.vd ?? 17, origin });
    const ear = earAnchor();
    let exposed = 0;
    let total = 0;
    for (const part of built.parts) {
      if (!/^(temple|tip)/.test(part.name)) continue;
      const pos = part.geo.position;
      for (let i = 0; i < pos.length; i += 3) {
        const zH = pos[i + 2] + origin.oz;
        if (zH > ear.canal.z - 6) continue; // از جلوی گوش به عقب
        total++;
        const p = { x: pos[i], y: pos[i + 1], z: pos[i + 2] };
        if (!insideHead(p, head) && !insideEar(p, origin)) exposed++;
      }
    }
    assert.ok(total > 20, product.id + ": دنبالهٔ دسته‌ای برای سنجش پیدا نشد");
    assert.equal(exposed, 0, `${product.id}: ${exposed} رأس از دنبالهٔ دسته بیرونِ سر/گوش می‌ماند (از جلوی صورت دیده می‌شود)`);
  }
});

test("مسیرِ دسته پیوسته و بدونِ پرش است", () => {
  const spec = toEngineSpec(CATALOG[0]);
  const origin = specHeadOrigin(spec);
  const built = buildFrame(spec, { origin });
  for (const name of ["templeR", "templeL"]) {
    const part = built.parts.find((p) => p.name === name);
    const path = part.path;
    assert.ok(path.length >= 16, name + ": مسیر کوتاه (" + path.length + ")");
    let maxJump = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      maxJump = Math.max(maxJump, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    assert.ok(maxJump < 14, `${name}: پرشِ ${maxJump.toFixed(1)}mm در مسیر`);
    // تقارنِ چپ/راست
  }
  const R = built.parts.find((p) => p.name === "templeR").path;
  const L = built.parts.find((p) => p.name === "templeL").path;
  assert.equal(R.length, L.length, "مسیرِ چپ و راست باید هم‌طول باشد");
  for (let i = 0; i < R.length; i++) {
    assert.ok(Math.abs(R[i].x + L[i].x) < 0.5, "عدمِ تقارن در x");
    assert.ok(Math.abs(R[i].y - L[i].y) < 0.5, "عدمِ تقارن در y");
    assert.ok(Math.abs(R[i].z - L[i].z) < 0.5, "عدمِ تقارن در z");
  }
});
