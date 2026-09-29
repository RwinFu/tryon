/** تست‌های هندسه: هر فریم کاتالوگ باید سالم، بی‌NaN و در محدودهٔ واقعی باشد */
import test from "node:test";
import assert from "node:assert/strict";
import { buildFrame, normalizeSpec } from "../src/frame/geometry.js";
import { CATALOG, toEngineSpec } from "../src/frame/catalog.js";
import { SHAPE_KEYS, lensOutline, offsetOutline, outlineBounds } from "../src/frame/shapes.js";

const realBounds = { lensW: [36, 70], lensH: [22, 64], dbn: [11, 27], templeLen: [100, 165], totalWidth: [96, 170] };

test("catalog: همهٔ فریم‌ها سالم ساخته می‌شوند", () => {
  for (const p of CATALOG) {
    const built = buildFrame(toEngineSpec(p));
    const roles = Object.keys(built.roles);
    assert.ok(roles.includes("lens"), p.id + " عدسی ندارد");
    assert.ok(roles.includes("frame") || roles.includes("metal"), p.id + " بدنه ندارد");
    for (const [role, g] of Object.entries(built.roles)) {
      for (const i of [0, 1, 2]) {
        assert.ok(Number.isFinite(g.position[i]), `${p.id}/${role}: مختصات NaN`);
      }
      assert.ok(g.position.every(Number.isFinite), `${p.id}/${role}: NaN در موقعیت`);
      assert.ok(g.normal.every(Number.isFinite), `${p.id}/${role}: NaN در نرمال`);
      assert.ok(g.index.every((v) => v >= 0 && v < g.vertexCount), `${p.id}/${role}: ایندکس خارج از بازه`);
    }
    const [w, h, d] = built.meta.size;
    assert.ok(w > 115 && w < 175, `${p.id}: پهنای غیرمنطقی ${w.toFixed(1)}mm`);
    assert.ok(h > 22 && h < 70, `${p.id}: ارتفاع غیرمنطقی ${h.toFixed(1)}mm`);
    assert.ok(d > 100 && d < 190, `${p.id}: عمق غیرمنطقی ${d.toFixed(1)}mm`);
    assert.ok(built.meta.tris > 700 && built.meta.tris < 60000, `${p.id}: تعداد مثلث نامناسب`);
  }
});

test("کاتالوگ به مدل‌های نام‌گذاری‌شده و منبع قابل بازبینی وصل است", () => {
  assert.equal(CATALOG.length, 28);
  assert.equal(new Set(CATALOG.map((p) => p.id)).size, CATALOG.length, "شناسهٔ کاتالوگ تکراری است");
  for (const p of CATALOG) {
    assert.ok(p.modelCode, `${p.id}: کد مدل ثبت نشده`);
    assert.match(p.sourceUrl || "", /^https:\/\//, `${p.id}: منبع امن/ثبت‌شده ندارد`);
    assert.ok(["manufacturer", "retailer"].includes(p.sourceType), `${p.id}: نوع منبع نامعتبر است`);
    assert.equal(p.modelAssetStatus, "procedural-preview", `${p.id}: نباید هندسهٔ تخمینی را مدل رسمی جا بزند`);
    if (p.lensHSource !== "manufacturer") assert.match(p.lensHSource || "", /^(estimated|retailer)$/);
  }
});

test("اندازه‌ها با سایز چاپی فروشنده یکی است", () => {
  for (const p of CATALOG.filter((x) => x.size)) {
    const spec = normalizeSpec(toEngineSpec(p));
    const [lens, bridge, temple] = String(p.size).split(/[^0-9.]+/).filter(Boolean).map(Number);
    assert.equal(spec.lensW, lens, p.id + " عرض عدسی");
    assert.equal(spec.dbn, bridge, p.id + " پل");
    assert.equal(spec.templeLen, temple, p.id + " دسته");
    assert.equal(spec.totalWidth, +(2 * lens + bridge).toFixed(1), p.id + " پهنای کل");
  }
});

test("خط لنز: بسته، بدون خودبرشِ فاحش، و قرینهٔ چپ/راست", () => {
  for (const shape of SHAPE_KEYS) {
    const R = lensOutline({ shape, lensW: 52, lensH: 44 }, 1, 160);
    const L = lensOutline({ shape, lensW: 52, lensH: 44 }, -1, 160);
    assert.equal(R.length, 160);
    const dims = outlineBounds(R);
    assert.ok(Math.abs(dims.w - 52) < 1e-8, `${shape}: lensW باید اندازهٔ چاپی بماند (${dims.w})`);
    assert.ok(Math.abs(dims.h - 44) < 1e-8, `${shape}: lensH باید اندازهٔ چاپی بماند (${dims.h})`);
    for (let i = 0; i < R.length; i++) {
      assert.ok(Math.abs(-L[i].x - R[i].x) < 1e-6, shape + ": آینهٔ x");
      assert.ok(Math.abs(L[i].y - R[i].y) < 1e-6, shape + ": ارتفاع قرینه نیست");
    }
    // داخل‌بری باید مسیر را کوچک‌تر کند و نقاط کم‌نشدنی نباشد
    const inner = offsetOutline(R, 4);
    const area = (pts) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      }
      return Math.abs(a) / 2;
    };
    assert.ok(area(inner) < area(R) * 0.95, shape + ": داخل‌بری اثر نکرد");
    assert.ok(area(inner) > area(R) * 0.15, shape + ": مسیر داخلی منفجر شد");
    const outer = offsetOutline(R, -3.5);
    assert.ok(area(outer) > area(R) * 1.05, shape + ": آفست منفی باید contour بیرونی را بزرگ کند");
  }
});

test("شکل‌دهنده‌های سیلوئت اندازهٔ چاپیِ عدسی را تغییر نمی‌دهند", () => {
  const cases = [
    { shape: "aviator", topWide: 1.16, teardrop: 0.44, bottomNarrow: 0.22 },
    { shape: "cateye", topWide: 1.12, catAmp: 0.42, catWidth: 0.4 },
    { shape: "shield", topWide: 1.14, bottomShift: -0.04 },
    { shape: "wayfarer", topWide: 1.1 },
  ];
  for (const spec of cases) {
    const dims = outlineBounds(lensOutline({ lensW: 62, lensH: 54, ...spec }, 1, 220));
    assert.ok(Math.abs(dims.w - 62) < 1e-8, `${spec.shape}: عرض خروجی ${dims.w}mm`);
    assert.ok(Math.abs(dims.h - 54) < 1e-8, `${spec.shape}: ارتفاع خروجی ${dims.h}mm`);
  }
});

test("قالب‌های مختلف واقعاً شکل‌های متفاوت می‌دهند", () => {
  const ratio = (shape) => {
    const pts = lensOutline({ shape, lensW: 52 }, 1, 200);
    const ys = pts.map((p) => p.y), xs = pts.map((p) => Math.abs(p.x));
    return (Math.max(...ys) - Math.min(...ys)) / (2 * Math.max(...xs));
  };
  const set = new Set(SHAPE_KEYS.map(ratio).map((v) => v.toFixed(2)));
  assert.ok(set.size >= 9, "شکل‌ها به اندازهٔ کافی متمایز نیستند: " + set.size);
});

test("سبک‌های half/brow/rimless واقعاً فرق دارند", () => {
  const names = (style) => buildFrame({ shape: "square", style, size: "52-18-145" }).parts.map((p) => p.name);
  const tris = (style) => buildFrame({ shape: "square", style, size: "52-18-145" }).meta.tris;
  const solidFrontTris = (style) => buildFrame({ shape: "square", style, size: "52-18-145" }).roles.frame?.index.length / 3 || 0;
  assert.ok(solidFrontTris("half") < solidFrontTris("full"), "نیم‌فریم باید سطح فریمِ جامدِ کمتری از تمام‌فریم داشته باشد");
  assert.ok(tris("rimless") < tris("half"), "فریم‌لس باید سبک‌ترین باشد");
  assert.ok(names("half").some((n) => n.startsWith("cord")), "نیم‌فریم بدون سیم زیر عدسی");
  assert.ok(names("brow").some((n) => n.startsWith("lowrim")), "ابرویی بدون رینگ زیرین");
  assert.ok(!names("rimless").some((n) => /^(rim|lowrim|cord|end)/.test(n)), "فریم‌لس نباید دور عدسی یا سرپل داشته باشد");
  assert.ok(names("rimless").some((n) => n.startsWith("hinge")), "فریم‌لس باید لولا داشته باشد");
});

test("مدل‌های ترکیبی، جنس پل/دسته/لولا را از هم مستقل نگه می‌دارند", () => {
  const cartier = CATALOG.find((p) => p.id === "AR-123");
  const cartierSpec = toEngineSpec(cartier);
  assert.equal(cartierSpec.material, "metal");
  assert.equal(cartierSpec.bridgeMaterial, "accent");
  assert.equal(cartierSpec.templeMaterial, "acetate");
  const built = buildFrame(cartierSpec);
  assert.equal(built.parts.find((part) => part.name === "bridge")?.role, "accent");
  assert.equal(built.parts.find((part) => part.name === "templeR")?.role, "frame");
  assert.equal(built.parts.find((part) => part.name === "endR")?.role, "metal");

  const police = buildFrame(toEngineSpec(CATALOG.find((p) => p.id === "AR-118")));
  assert.equal(police.parts.find((part) => part.name === "templeR")?.role, "frame");
});

test("محدودهٔ فیزیکی پارامترها حفظ می‌شود", () => {
  for (const p of CATALOG) {
    const spec = normalizeSpec(toEngineSpec(p));
    for (const [k, [lo, hi]] of Object.entries(realBounds)) {
      if (spec[k] === undefined) continue;
      assert.ok(spec[k] >= lo && spec[k] <= hi, `${p.id}: ${k}=${spec[k]} خارج از ${lo}..${hi}`);
    }
  }
});
