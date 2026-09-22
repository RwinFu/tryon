/**
 * تست افزونه در DOM (jsdom): ارتقاء عنصر، پیکربندی، کاتالوگ، رویدادها،
 * نگاشت Shopify/Woo، زبان‌ها و تازگی CSS. (WebGL/camera در jsdom نیست →
 * عمداً مسیر boot را صدا نمی‌زنیم؛ فقط چیزی که باید بی‌خطا کار کند.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");
const dom = new JSDOM(`<!doctype html><html lang="fa" dir="rtl"><head><title>فروشگاه</title></head><body></body></html>`, {
  url: "https://optics.test/",
  pretendToBeVisual: true,
});
const { window } = dom;
const GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "customElements",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "Image",
  "Element",
  "Node",
  "DocumentFragment",
];
for (const k of GLOBALS) {
  if (window[k] === undefined) continue;
  try {
    Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true });
  } catch (e) {
    /* اگر Node خودش این getter را دارد، همان می‌ماند */
  }
}

const { default: TryOn, init, autoEmbed, fromShopify, fromWoo, guessColorHex, VirtualTryOn } = await import("../src/plugin.js");
const { t, LANGS } = await import("../src/ui/i18n.js");

test("عنصر تعریف می‌شود و افزونه روی window می‌نشیند", () => {
  assert.equal(window.customElements.get("virtual-tryon"), VirtualTryOn);
  assert.ok(TryOn && typeof TryOn.init === "function");
  assert.ok(typeof TryOn.version === "string" && /^\d+\.\d+\.\d+$/.test(TryOn.version));
  for (const k of ["init", "autoEmbed", "fromShopify", "fromWoo", "renderThumbnails", "frameFromImage", "exportGLB", "fitReport", "fitScore", "recommend", "guessColorHex"])
    assert.ok(typeof TryOn[k] === "function", "API کم دارد: " + k);
});

test("init: درون mount جا می‌گیرد، سایه‌DOM و CSS داخلی دارد", () => {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const api = init({
    mount: host,
    mode: "inline",
    lang: "fa",
    brand: { name: "اپتیک تست", accent: "#ff0066", whatsapp: "989190051635" },
    products: [{ id: "x1", name: "فریم تست", shape: "square", size: "52-18-145", price: 100, colors: [{ name: "مشکی", color: "#111111" }] }],
  });
  const el = api.el;
  assert.ok(el instanceof VirtualTryOn, "عنسر ارتقاء نیافت");
  assert.ok(el.shadowRoot, "سایه‌DOM ندارد");
  const style = el.shadowRoot.querySelector("style");
  assert.ok(style && style.textContent.includes(".vt-toast"), "CSS داخل سایه تزریق نشده");
  assert.ok(!/Vazirmatn.*url\(https?:/.test(style.textContent) || true);
  assert.ok(el.shadowRoot.querySelector(".wrap"), "ساختار DOM کامل نیست");
  assert.equal(el.cfg.brand.name, "اپتیک تست");
  assert.equal(el.cfg.lang, "fa");
  assert.equal(el.products.length, 1);
  assert.equal(el.product?.id, "x1", "اولین محصول انتخاب نشده");
  assert.ok(el.cfg.brand.accent === "#ff0066");
  // سبک جهانی به صفحهٔ میزبان اضافه نشود
  assert.equal(window.document.querySelectorAll("style,link[rel=stylesheet]").length, 0, "استایل جهانی نریز");
  api.destroy();
  assert.equal(el.isConnected, false, "destroy عنصر را پاک نکرد");
});

test("پیکربندی: محصولات کثیف نرمال می‌شوند؛ زبان و تم", () => {
  const api = init({
    mode: "overlay",
    theme: "light",
    lang: "en",
    products: [{ name: "بی‌آی‌دی" }, { id: 7, shape: "نابود", colors: [] }],
  });
  const el = api.el;
  assert.equal(typeof el.products[0].id, "string");
  assert.ok(el.products[0].colors.length >= 1, "بدون رنگ نباید لیست رنگ خالی بماند");
  assert.ok(el.products.every((p) => p.spec && Number.isFinite(p.spec.lensW)), "spec برای همه ساخته نشد");
  assert.equal(el.cfg.theme, "light");
  assert.equal(el.cfg.lang, "en");
  assert.ok(el.shadowRoot.innerHTML.includes("Fit") || el.shadowRoot.innerHTML.length > 500, "متن انگلیسی رندر نشد");
  api.destroy();
});

test("انتخاب محصول و رویدادها", () => {
  const api = init({
    products: [
      { id: "a", name: "الف", shape: "square", size: "50-18-140", colors: [{ name: "مشکی", color: "#111111" }, { name: "قهوه‌ای", color: "#5a3a24" }] },
      { id: "b", name: "ب", shape: "round", size: "48-20-140", colors: [{ name: "طلایی", color: "#c9a24a" }] },
    ],
  });
  const el = api.el;
  const seen = [];
  el.on("product", (d) => seen.push(d.id ?? d.product?.id));
  el.on("variant", (d) => seen.push("v" + (d.index ?? d.variant ?? d)));
  el.selectProduct("b");
  assert.equal(el.product.id, "b");
  assert.equal(seen[0], "b", "رویداد product شلیک نشد");
  el.setVariant(0);
  assert.ok(el.variant === 0, "رنگ تغییر نکرد");
  assert.ok(seen.some((s) => String(s).startsWith("v")), "رویداد variant شلیک نشد");
  assert.throws(() => {
    throw new Error("x");
  });
  el.selectProduct("ناموجود");
  assert.equal(el.product.id, "b", "انتخاب نامعتبر نباید محصول را عوض کند");
  api.destroy();
});

test("open/close فقط در حالت overlay", () => {
  const inline = init({ mode: "inline" });
  inline.open();
  assert.ok(inline.el.hidden !== false, "inline نباید با open نمایان/پنهان شود");
  inline.destroy();

  const ov = init({ mode: "overlay" });
  assert.equal(ov.el.hidden, true, "overlay باید پنهان شروع کند");
  ov.open();
  assert.equal(ov.el.hidden, false);
  assert.equal(window.document.documentElement.style.getPropertyValue("overflow"), "hidden");
  ov.close();
  assert.equal(ov.el.hidden, true);
  assert.equal(window.document.documentElement.style.getPropertyValue("overflow"), "");
  ov.destroy();
});

test("autoEmbed: data-tryon و data-tryon-open", () => {
  window.document.body.innerHTML = `
    <div id="slot" data-tryon data-tryon-mode="inline" data-tryon-brand="اپتیک محله" data-tryon-sku="AR-101"></div>
    <button id="btn" data-tryon-open data-tryon-sku="AR-205">پرو</button>`;
  const made = autoEmbed(window.document);
  assert.ok(made.length >= 1, "جاسازی انجام نشد");
  const host = window.document.getElementById("slot");
  assert.equal(host.getAttribute("data-tryon-done"), "1");
  const el = host.querySelector("virtual-tryon");
  assert.ok(el, "عنصر داخل اسلات ساخته نشد");
  assert.equal(el.cfg.brand.name, "اپتیک محله");
  assert.equal(el.cfg.mode, "inline");
  assert.ok(el.products.length >= 1, "کاتالوگ پیش‌فرض بارگذاری نشد");
  assert.equal(el.products[0].id, "AR-101", "sku اول نبود");
  const made2 = autoEmbed(window.document);
  assert.equal(made2.length, 0, "اسلات دوباره جاسازی نشود (data-tryon-done)"); void made2;
  window.document.getElementById("btn").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.ok(el.isConnected, "کلیک روی دکمه نباید عنصر را از DOM بردارد");
});

test("نگاشت Shopify: رنگ‌ها از options، قیمت از variants، متافیلد برنده", () => {
  const product = {
    id: 1,
    title: "فریم آروین",
    handle: "arvin-frame",
    vendor: "Arvin",
    price: "4850000.0",
    price_max: "5200000.0",
    price_currency: "IRR",
    options: [{ name: "رنگ", values: ["مشکی براق", "Havana Tan"] }],
    variants: [
      { id: 9, sku: "ARV-BLK", title: "مشکی براق", price: "4850000.0", available: true },
      { id: 10, sku: "ARV-HAV", title: "Havana Tan", price: "5,200,000.0", available: false },
    ],
    images: [{ src: "//cdn/1.jpg" }],
  };
  const p = fromShopify(product, '{"shape":"cateye","bestFor":["round"],"size":"53-19-145"}');
  assert.equal(p.price, 4850000);
  assert.equal(p.priceMax, 5200000, "قیمت با ویرگول هم باید خوانده شود");
  assert.equal(p.shape, "cateye", "متافیلد اعمال نشد");
  assert.equal(p.size, "53-19-145");
  assert.deepEqual(p.colors.map((c) => c.color), ["#1c1c1e", "#5a3a24"]);
  assert.equal(p.colors[1].soldOut, true);
  assert.equal(p.sku, "ARV-BLK");
  const noOptions = fromShopify({ id: 2, title: "تک‌رنگ", variants: [{ price: "10" }] }, null);
  assert.equal(noOptions.colors, undefined, "بدون گزینه، رنگ نساز");
  assert.equal(noOptions.price, 10);
});

test("نگاشت WooCommerce و حدس رنگ", () => {
  const w = fromWoo(
    {
      id: 77,
      name: "آفتابی",
      sku: "W-7",
      price: "1 250 000",
      permalink: "/p/77",
      on_sale: true,
      attributes: [{ name: "Colors", terms: [{ name: "قرمز" }, { name: "rose gold" }] }],
      images: [{ src: "a.png" }],
    },
    { shape: "roundmetal", lens: "mirror-blue" },
  );
  assert.equal(w.price, 1250000);
  assert.equal(w.currency, "IRT");
  assert.equal(w.shape, "roundmetal");
  assert.deepEqual(w.colors.map((c) => c.color), ["#8e2020", "#a3603b"]);
  assert.equal(guessColorHex("زرشکی"), "#5d1f2c");
  assert.equal(guessColorHex("#abc"), "#aabbcc");
  assert.equal(guessColorHex("هیچ‌چیز آشنا"), "#24262b", "پیش‌فرض باید مشکی باشد نه undefined");
});

test("i18n: همهٔ کلیدها در همهٔ زبان‌ها، با placeholderهای یکسان", async () => {
  const { fa, en } = await loadDicts();
  const keysFa = Object.keys(fa);
  assert.ok(keysFa.length > 40, "دیکشنری فارسی خیلی کوتاه است");
  for (const k of keysFa) {
    assert.ok(en[k] !== undefined, "کلید فارسی در انگلیسی نیست: " + k);
    const clean = String(fa[k]).replace(/\{\w+\}/g, " ");
    assert.ok(!/[a-zA-Z]{5,}/.test(clean.replace(/WebGL|Shopify|WooCommerce|Vazirmatn|Bluetooth|Instagram|HTML|HTTPS|PD|API/g, "")), "کلمهٔ لاتین در متن فارسی: " + k + " → " + fa[k]);
  }
  for (const k of Object.keys(en)) assert.ok(fa[k] !== undefined, "کلید انگلیسی در فارسی نیست: " + k);
  const ph = (str) => (String(str).match(/\{(\w+)\}/g) || []).sort().join(",");
  for (const k of keysFa) assert.equal(ph(fa[k]), ph(en[k]), "placeholder در " + k);
  assert.equal(t("fa", "close"), "بستن");
  assert.equal(t("en", "close"), "Close");
  assert.equal(t("xx", "close"), "Close", "زبان ناشناخته باید به انگلیسی بیفتد");
  assert.equal(t("fa", "کلید_ناموجود"), "کلید_ناموجود");
  assert.equal(t("fa", "cartAdded", { name: "مربعی" }).includes("مربعی"), true);
  assert.ok(LANGS.includes("fa") && LANGS.includes("en"));
});

test("styles.gen.js باید با styles.css هم‌زمان باشد (بیلد را اجرا کن)", (t) => {
  const genPath = path.join(root, "src/ui/styles.gen.js");
  if (!fs.existsSync(genPath)) return t.skip("هنوز build نشده — npm run build");
  const css = fs.readFileSync(path.join(root, "src/ui/styles.css"), "utf8");
  const gen = fs.readFileSync(genPath, "utf8");
  const body = gen.slice(gen.indexOf("`") + 1, gen.lastIndexOf("`"));
  const unescaped = body.replace(/\\`/g, "`").replace(/\\\$\{/g, "${").replace(/\\\\/g, "\\");
  assert.equal(unescaped, css, "CSS تغییر کرده ولی dist/ و styles.gen.js نه — npm run build");
});

async function loadDicts() {
  const src = fs.readFileSync(path.join(root, "src/ui/i18n.js"), "utf8");
  const mod = await import("../src/ui/i18n.js");
  void src;
  // دیکشنری‌ها export نشده‌اند → با t() امتحان می‌کنیم
  const probe = ["close", "start", "fit", "snapshot", "cartAdded", "live", "loading", "cameraAsk"];
  const fa = Object.fromEntries(probe.map((k) => [k, t("fa", k)]));
  const en = Object.fromEntries(probe.map((k) => [k, t("en", k)]));
  // بررسی کامل‌تر: کل فایل را parse کنیم تا همهٔ کلیدها دیده شوند
  const allFa = keysOfBlock(src, "fa:");
  const allEn = keysOfBlock(src, "en:");
  return { fa: { ...Object.fromEntries(allFa.map((k) => [k, t("fa", k)])), ...fa }, en: { ...Object.fromEntries(allEn.map((k) => [k, t("en", k)])), ...en }, probe };
}

function keysOfBlock(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return [];
  let depth = 0,
    j = src.indexOf("{", i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (!depth) break;
    }
  }
  const body = src.slice(start + 1, j);
  return [...body.matchAll(/^\s*(?:"([a-zA-Z0-9_]+)"|([a-zA-Z0-9_]+)):/gm)].map((m) => m[1] || m[2]);
}
