/**
 * seat-envelope.test.mjs — قواعدِ فیزیکیِ نشستن (فاصلهٔ رأس، تفکیکِ فشار از انسداد)
 *
 * این فایل از سه باگِ دیداری محافظت می‌کند که همه از یک ریشه می‌آمدند:
 *  ۱. سقف/کفِ فاصلهٔ رأس حساب می‌شد و مصرف نمی‌شد ⇒ فریم تا ۲۱mm از صورت دور
 *     می‌شد («فریمِ شناور»).
 *  ۲. معیارِ فشار روی *همهٔ* رأس‌ها حساب می‌شد، از جمله جایی که بینی در تصویر
 *     جلوی حلقه است ⇒ هشدارِ الکی و جابه‌جاییِ فریم.
 *  ۳. اکلوژنِ صورت فقط دیوارهٔ کناریِ سر بود ⇒ حلقه‌ای که چند میلی‌متر پشتِ
 *     پوستِ بینی است روی بینی کشیده می‌شد («عینکِ فرورفته در صورت»).
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { seatOffsetsFor, seatAnchors, auditSeat, SEAT, tissueAllow, innerCornerLimit } from "../src/engine/seating.js";
import { faceSheetGeometry, createHeadOccluder, headOccluderParams } from "../src/engine/occluder.js";
import { surfaceZ } from "../src/engine/face-surface.js";
import { toEngineSpec, CATALOG } from "../src/frame/catalog.js";
import { CANONICAL_MM } from "../src/engine/face-topology.js";

test("فاصلهٔ رأسِ هر ۲۹ فریم داخلِ پوششِ فیزیکی می‌ماند و مردمک روی مرکزِ عدسی است", () => {
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const seat = seatOffsetsFor(spec);
    assert.ok(seat && seat.report, `${product.id}: بدونِ نشستن`);
    const r = seat.report;
    assert.equal(r.seatMode, "optical-envelope", `${product.id}: مسیرِ نشستن`);
    // پوششِ سخت: هیچ فریمی نباید شناور یا چسبیده به مژه باشد.
    assert.ok(r.vd >= SEAT.vdMin - 0.05 && r.vd <= SEAT.vdMax + 0.05, `${product.id}: vd ${r.vd}`);
    // اگر بینیِ مدل فریم را از سقف جلوتر می‌خواهد، عددِ خام باید گزارش شود.
    assert.ok(Number.isFinite(r.vdNeed) && r.vdNeed > 8, `${product.id}: vdNeed ${r.vdNeed}`);
    if (r.vdNeed > SEAT.vdMax + 0.35) {
      assert.ok(r.warnings.includes("narrow-bridge"), `${product.id}: پلِ تنگ بدونِ هشدار`);
    }
    if (r.vd > 17.4) assert.ok(r.warnings.includes("vertex-distance"), `${product.id}: شناوریِ بی‌هشدار`);
    // مردمک باید نزدیکِ مرکزِ عدسی بماند (خطای دیداریِ اصلی).
    assert.ok(Math.abs(r.pupilOffset - SEAT.pupilLift) <= 0.6, `${product.id}: مردمک ${r.pupilOffset}`);
  }
});

test("فشارِ حامل از انسدادِ طبیعیِ بینی جدا شده و هیچ فریمی در بافت فرو نمی‌رود", () => {
  let occludedSomewhere = 0;
  for (const product of CATALOG) {
    const spec = toEngineSpec(product);
    const seat = seatOffsetsFor(spec);
    const audit = auditSeat(seatAnchors(spec), seat.oy, seat.oz, seat.ox);
    assert.ok(audit.support > 0, `${product.id}: نقطهٔ حامل ندارد`);
    // نقاطِ حاملِ وزن (پل/بالشتک/باندِ بالاییِ حلقه) نباید بیش از فشردگیِ مجاز
    // داخلِ پوست باشند؛ قبلاً همین معیار روی پرهٔ بینیِ جلورونده حساب می‌شد.
    assert.ok(audit.minMargin > -1.0, `${product.id}: فشارِ حامل ${audit.minMargin}`);
    if (audit.occlusion > 0) occludedSomewhere++;
    // حلقهٔ داخلی زیرِ خطِ بینی می‌تواند عقب‌تر از پوست باشد؛ آن انسداد است،
    // نه فشار، و باید جدا شمرده شود.
    assert.equal(audit.penetration, 0, `${product.id}: penetration ${audit.penetration}`);
  }
  assert.ok(occludedSomewhere >= 20, "بینی باید بخشی از حلقهٔ داخلی را بپوشاند");
});

test("مرزِ فشار یک منبع دارد: حل و حسابرسی هم‌خوان‌اند", () => {
  const spec = toEngineSpec(CATALOG.find((p) => p.id === "AR-101"));
  const anchors = seatAnchors(spec);
  const lim = innerCornerLimit(anchors.meta);
  assert.equal(tissueAllow({ name: "bridge" }, 0, lim), 0);
  assert.equal(tissueAllow({ name: "padL", role: "pad" }, 0, lim), 0);
  assert.ok(tissueAllow({ name: "rimL" }, lim - 1, lim) > tissueAllow({ name: "rimL" }, lim + 1, lim));
  const seat = seatOffsetsFor(spec);
  const audit = auditSeat(anchors, seat.oy, seat.oz, seat.ox);
  assert.ok(audit.minMargin >= seat.report.minMargin - 0.35, `audit ${audit.minMargin} / report ${seat.report.minMargin}`);
  // حاشیهٔ خامِ گزارش از مرزِ فشار کمتر است، چون انسدادِ بینی در آن هست.
  assert.ok(audit.minClearance < audit.minMargin, "انسداد باید از فشار جدا بماند");
});

test("ورقهٔ صورتِ اکلوژن از سطحِ واقعیِ پوست ساخته می‌شود و از فرورفتگیِ ۲mm جلوتر است", () => {
  const geo = faceSheetGeometry(THREE);
  const pos = geo.getAttribute("position");
  assert.ok(pos.count > 500, "ورقهٔ صورت خیلی کم‌تراکم است: " + pos.count);
  assert.ok(geo.index && geo.index.count > 1000, "ورقهٔ صورت مثلث ندارد");
  // هر رأسِ معتبر دقیقاً ۰٫۴۵mm عقب‌تر از سطحِ پوستِ همان (x,y) است.
  const valid = geo.userData.valid;
  assert.ok(valid && valid.length === pos.count, "ماسکِ اعتبارِ ورقه پیدا نشد");
  let checked = 0;
  for (let i = 0; i < pos.count && checked < 60; i += 37) {
    if (!valid[i]) continue;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const skin = surfaceZ(x, y);
    if (!Number.isFinite(skin)) continue;
    // هندسه Float32 است؛ تلورانس باید بالای دقتِ تک‌دقتی باشد.
    assert.ok(Math.abs(z - (skin - 0.45)) < 1e-3, `رأسِ ${x},${y}: ${z} در برابر ${skin - 0.45}`);
    checked++;
  }
  assert.ok(checked >= 40, "به‌اندازهٔ کافی رأسِ معتبر بررسی نشد");
  // اگر لبهٔ حلقه ۲mm داخلِ پوستِ کنارِ بینی باشد، ورقه باید جلوی آن بماند
  // (یعنی آن تکه دیده نشود)، وگرنه حلقه روی بینی کشیده می‌شود.
  const tipY = CANONICAL_MM[4 * 3 + 1];
  const skin = surfaceZ(0, tipY);
  let sheetAtTip = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (!valid[i]) continue;
    if (Math.abs(pos.getX(i)) < 1.4 && Math.abs(pos.getY(i) - tipY) < 1.4) sheetAtTip = Math.max(sheetAtTip, pos.getZ(i));
  }
  assert.ok(Number.isFinite(sheetAtTip), "نزدیکِ نوکِ بینی رأس ندارد");
  assert.ok(sheetAtTip > skin - 2, "ورقهٔ بینی فرورفتگیِ ۲mm را نمی‌پوشاند");
});

test("گروهِ سرِ نامرئی ورقهٔ صورت را همراهِ دیوارهٔ سر دارد", () => {
  const occ = createHeadOccluder(THREE, headOccluderParams({ vertexDistance: 13 }));
  const names = occ.children.map((c) => c.name);
  assert.ok(names.includes("occluderHead"), names.join(","));
  assert.ok(names.includes("occluderFace"), names.join(","));
  const face = occ.children.find((c) => c.name === "occluderFace");
  assert.equal(face.material.colorWrite, false, "ورقهٔ صورت نباید رنگ بنویسد");
  assert.equal(face.material.depthWrite, true, "ورقهٔ صورت باید عمق بنویسد");
});
