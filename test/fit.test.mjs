/** فیت و کاتالوگ: هیچ محصولی نباید با دادهٔ ناقص به مشتری نشان داده شود */
import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG, CATALOG_BY_ID, FACE_SHAPES, toEngineSpec, parseSize } from "../src/frame/catalog.js";
import { SHAPE_KEYS } from "../src/frame/shapes.js";
import { classifyShape, faceShapeMetrics, fitReport, fitScore, recommend, SHAPE_COPY } from "../src/engine/fit.js";

const SHAPES = ["oval", "round", "square", "heart", "diamond", "triangle", "oblong"];
const pose = (o = {}) => ({ pdMm: 64, faceWmm: 142, faceHmm: 108, noseWmm: 18, ...o });

/* ── کاتالوگ ───────────────────────────────────────────────── */
test("کاتالوگ: schema کامل، id یکتا و دادهٔ قابل‌فروش", () => {
  const ids = new Set();
  assert.ok(CATALOG.length >= 20, "برای فروش باید حداقل ۲۰ مدل باشد");
  for (const p of CATALOG) {
    assert.ok(p.id && !ids.has(p.id), "id تکراری یا خالی: " + p.id);
    ids.add(p.id);
    assert.ok(typeof p.name === "string" && p.name.length > 2, p.id + " بی‌نام");
    assert.ok(SHAPE_KEYS.includes(p.shape), p.id + " shape نامعتبر: " + p.shape);
    assert.ok(["full", "half", "brow", "rimless", "clip"].includes(p.style || "full"), p.id + " style");
    assert.ok(["acetate", "metal", "mixed", "titanium"].includes(p.material || "acetate"), p.id + " material");
    assert.ok(p.colors?.length >= 1, p.id + " رنگ ندارد");
    for (const c of p.colors) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(c.color), p.id + " رنگ باید hex باشد: " + c.color);
    }
    assert.ok(parseSize(p.size), p.id + " سایز چاپی نامعتبر: " + p.size);
    const s = toEngineSpec(p);
    assert.ok(s.lensW > 35 && s.lensW < 70, p.id + " lensW");
    assert.ok(s.templeLen > 100 && s.templeLen < 170, p.id + " templeLen");
    if (p.price !== undefined) assert.ok(Number.isFinite(p.price) && p.price > 0, p.id + " price");
    for (const b of p.bestFor || []) assert.ok(SHAPES.includes(b), p.id + " bestFor نامعتبر: " + b);
  }
});

test("CATALOG_BY_ID و parseSize", () => {
  assert.equal(CATALOG_BY_ID.get(CATALOG[0].id), CATALOG[0]);
  assert.deepEqual(parseSize("52□18-145"), { lensW: 52, dbn: 18, temple: 145 });
  assert.deepEqual(parseSize("54-17 140"), { lensW: 54, dbn: 17, temple: 140 });
  assert.equal(parseSize(""), null);
  assert.equal(parseSize("999-99-999"), null, "عدد غیرمنطقی باید رد شود");
});

test("FACE_SHAPES و SHAPE_COPY برای هر شکل صورت متن دارند", () => {
  for (const s of SHAPES) {
    assert.ok(FACE_SHAPES[s]?.label, "برچسب کم است برای " + s);
    assert.ok(SHAPE_COPY[s]?.advice?.length > 60, "متن پیشنهاد کوتاه است برای " + s);
    assert.ok(SHAPE_COPY[s]?.label, "برچسب SHAPE_COPY کم است برای " + s);
    assert.ok(Array.isArray(SHAPE_COPY[s]?.want) && SHAPE_COPY[s].want.length, "want کم است برای " + s);
  }
});

/* ── ریاضی فیت ─────────────────────────────────────────────── */
test("چهار چک فیت پر می‌شوند و سطح‌بندی درست است", () => {
  const rows = fitReport(CATALOG[0], pose(), toEngineSpec(CATALOG[0]));
  assert.deepEqual(
    rows.map((r) => r.key),
    ["width", "decentration", "bridge", "depth"],
  );
  for (const r of rows) {
    assert.ok(["good", "warn", "bad"].includes(r.status), r.key + " status نامعتبر: " + r.status);
    assert.ok(/[0-9]/.test(r.value), r.key + " value باید عدد داشته باشد: " + r.value);
    assert.ok(!/[a-z]{5,}/.test(r.hint), r.key + " نباید کلمهٔ لاتین در متن فارسی باشد: " + r.hint);
  }
  const agg = fitScore(rows);
  assert.ok(agg.score >= 0 && agg.score <= 100);
  assert.ok(["good", "ok", "poor"].includes(agg.level));
  assert.equal(agg.checks.length, 4);
});

test("فریم خیلی پهن یا خیلی باریک رد می‌شود", () => {
  const spec = toEngineSpec(CATALOG[0]);
  const st = (faceW) => fitReport(CATALOG[0], pose({ faceWmm: faceW }), spec).find((r) => r.key === "width").status;
  assert.equal(st(96), "warn");
  assert.equal(st(210), "warn");
  assert.equal(st(138), "good");
  assert.ok(fitScore([{ status: "warn" }]).score < fitScore([{ status: "good" }]).score);
  assert.equal(fitScore([{ status: "bad" }, { status: "warn" }]).level, "poor");
  assert.equal(fitScore([]).level, "unknown");
});

test("دسانتراسیون: اختلاف مرکز عدسی تا مردمک", () => {
  const spec = toEngineSpec(CATALOG[0]); // lensW 52 + dbn 18 → ۷۰ مرکز تا مرکز
  const dec = (pd) => fitReport(CATALOG[0], pose({ pdMm: pd }), spec).find((r) => r.key === "decentration");
  assert.ok(Math.abs(parseFloat(dec(70).value)) < 0.05, dec(70).value);
  assert.equal(dec(70).status, "good");
  assert.ok(Math.abs(Math.abs(parseFloat(dec(64).value)) - 3) < 0.11, dec(64).value);
  assert.equal(dec(50).status, "warn");
});

test("پل باریک روی بینی پهن هشدار می‌دهد", () => {
  const spec = { ...toEngineSpec(CATALOG[0]), dbn: 11 };
  const r = fitReport(CATALOG[0], pose({ noseWmm: 24 }), spec).find((x) => x.key === "bridge");
  assert.equal(r.status, "warn");
  assert.ok(/گونه|high-bridge/.test(r.hint), r.hint);
  const fine = fitReport(CATALOG[0], pose({ noseWmm: 11 }), spec).find((x) => x.key === "bridge");
  assert.equal(fine.status, "good");
});

test("عدسی خیلی بلند برای صورت کوچک هشدار می‌گیرد", () => {
  const spec = { ...toEngineSpec(CATALOG[0]), lensH: 58 };
  assert.equal(fitReport(CATALOG[0], pose({ faceHmm: 96 }), spec).find((r) => r.key === "depth").status, "warn");
  assert.equal(fitReport(CATALOG[0], pose({ faceHmm: 200 }), spec).find((r) => r.key === "depth").status, "good");
});

test("بدون pose یا spec نباید بشکند", () => {
  assert.deepEqual(fitReport(CATALOG[0], null, null), []);
  assert.equal(fitScore(null).level, "unknown");
});

test("توصیه‌گر: برای صورت گرد فریم زاویه‌دار، و محصول فعلی حذف می‌شود", () => {
  const rec = recommend(CATALOG, "round", { exclude: [CATALOG[0].id] });
  assert.equal(rec.length, CATALOG.length, "به هر محصول امتیاز داده می‌شود");
  assert.notEqual(rec[0].id, CATALOG[0].id);
  const top = rec.slice(0, 4).map((p) => p.shape);
  const ok = ["square", "rectangle", "cateye", "browline", "geometric", "aviator"];
  assert.ok(top.every((s) => ok.includes(s)), "برای صورت گرد: " + top.join(","));
  for (const shape of SHAPES) {
    const list = recommend(CATALOG, shape, {});
    assert.ok(list.every((p) => p.id), "خروجی باید خودش محصول باشد");
  }
  const male = recommend(CATALOG, "oval", { gender: "male" });
  assert.ok(male.length >= 3);
  assert.ok(male.every((p) => !p.gender || p.gender !== "female"), "فریم زنانه نباید به آقا پیشنهاد شود");
  assert.equal(recommend(CATALOG, "oval", { gender: "other" }).length, CATALOG.length, "جنسیت ناشناخته نباید لیست را خالی کند");
  const vocab = new Set();
  for (const p of CATALOG) for (const t of [...(p.tags || []), p.shape, p.style, ...(p.bestFor || [])]) vocab.add(t);
  for (const [shape, v] of Object.entries(SHAPE_COPY)) for (const w of v.want) assert.ok(vocab.has(w), shape + ": want مرده → " + w);
});

test("classifyShape: آستانه‌های نسبت‌ها", () => {
  const m = (over = {}) => ({ length: 1.35, forehead: 0.95, jaw: 0.9, symmetry: 0.95, ...over });
  assert.equal(classifyShape(m()), "oval");
  assert.equal(classifyShape(m({ length: 1.62 })), "oblong");
  assert.equal(classifyShape(m({ length: 1.15 })), "round");
  assert.equal(classifyShape(m({ jaw: 0.96, length: 1.3 })), "square");
  assert.equal(classifyShape(m({ forehead: 0.78, jaw: 0.8 })), "diamond");
  assert.equal(classifyShape(m({ forehead: 1.06, jaw: 0.86 })), "heart");
  assert.equal(classifyShape(m({ forehead: 0.86, jaw: 0.99 })), "triangle");
  assert.equal(classifyShape(m({ symmetry: 0.5 })), null, "سر کج نباید نمونه بگیرد");
});

test("faceShapeMetrics: نسبت‌ها از لندمارک‌های ۴۷۸ نقطه‌ای", () => {
  const p = {};
  const put = (i, x, y) => (p[i] = { x, y });
  put(10, 100, 0);
  put(152, 100, 200); // پیشانی تا چانه
  put(234, 40, 110);
  put(454, 160, 110); // گونه‌ها
  put(172, 62, 186);
  put(397, 138, 186); // فک
  put(21, 55, 6);
  put(251, 145, 6); // پیشانی
  put(33, 70, 100);
  put(263, 130, 100); // گوشهٔ چشم
  put(188, 92, 150);
  put(412, 108, 150); // کنار پل بینی، نه شقیقه
  const out = faceShapeMetrics(p);
  assert.ok(Math.abs(out.length - 200 / 120) < 1e-6, "نسبت طول");
  assert.ok(Math.abs(out.jaw - 76 / 120) < 1e-6, "نسبت فک");
  assert.ok(out.symmetry > 0.9, "قرینگی");
  assert.equal(out.faceWpx, 120);
  assert.equal(out.noseW, 16, "پهنای بینی باید کنار پل باشد، نه فاصلهٔ شقیقه‌ها");
});
