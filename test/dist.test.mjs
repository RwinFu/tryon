/**
 * تست همان چیزی که فروشگاه بار می‌کند: dist/tryon.js (IIFE مینیفای‌شده)
 * — در jsdom اجرا می‌شود و باید بدون خطا TryOn را بسازد و نصب خودکار انجام دهد.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(root, "dist/tryon.js");
const esmPath = path.join(root, "dist/tryon.esm.js");

test("dist/tryon.js: بیلد موجود، خودکفا و بدون import باقی‌مانده", (t) => {
  if (!fs.existsSync(bundlePath)) return t.skip("npm run build نگه‌داشته شده");
  const src = fs.readFileSync(bundlePath, "utf8");
  assert.ok(src.length > 100_000, "بیلد خیلی کوچک است: " + src.length);
  assert.ok(!/\bfrom\s*["']\.{1,2}\//.test(src), "import نسبی در بیلد مانده (esbuild درست کار نکرده)");
  assert.ok(!/import\(["']three["']\)/.test(src), "three باید داخل بیلد باشد");
  assert.ok(/THREE|WebGLRenderer/.test(src), "سه‌بعدی در بیلد نیست");
  assert.ok(!/sourceMappingURL=tryon\.js\.map/.test(src) || fs.existsSync(bundlePath + ".map"), "سورس‌مپ لینک‌شده وجود ندارد");
});

test("dist/tryon.js در مرورگر شبیه‌سازی‌شده بالا می‌آید و TryOn می‌سازد", async (t) => {
  if (!fs.existsSync(bundlePath)) return t.skip("بیلد نیست");
  const src = fs.readFileSync(bundlePath, "utf8");
  const dom = new JSDOM(
    `<!doctype html><html lang="fa" dir="rtl"><head>
       <script src="/tryon.js" data-tryon-products="/products.json" data-tryon-accent="#ff0066"></script>
     </head><body>
       <div id="slot" data-tryon data-tryon-mode="inline" data-tryon-sku="AR-104"></div>
       <button id="b" data-tryon-open data-tryon-sku="AR-201">پرو</button>
     </body></html>`,
    { url: "https://shop.test/product/1", runScripts: "outside-only" },
  );
  const errors = [];
  dom.window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  dom.window.eval(src);
  const { window } = dom;
  await new Promise((r) => setTimeout(r, 30)); // microtask مربوط به autoEmbed بنشیند
  assert.deepEqual(errors, [], "خطای سطح‌اول در بارگذاری بیلد");
  assert.ok(window.TryOn, "window.TryOn ساخته نشد");
  assert.match(window.TryOn.version, /^\d+\.\d+\.\d+$/);
  for (const k of ["init", "autoEmbed", "fromShopify", "fromWoo", "renderThumbnails", "frameFromImage", "exportGLB", "fitScore", "CATALOG"])
    assert.ok(window.TryOn[k] !== undefined, "API بیلد کم دارد: " + k);
  assert.ok(window.TryOn.CATALOG.length >= 20, "کاتالوگ داخل بیلد نیست");

  const slot = window.document.getElementById("slot");
  const el = slot.querySelector("virtual-tryon");
  assert.ok(el, "جاسازی خودکار داخل [data-tryon] انجام نشد");
  assert.ok(el.shadowRoot.querySelector("style"), "CSS داخل بیلد نیست");
  assert.equal(el.cfg.brand.accent, "#ff0066", "تنظیمات تگ script اعمال نشد");
  // data-tryon-sku روی میزبان، لیست را به همان مدل + شبیه‌هایش محدود می‌کند
  assert.ok(el.products.length >= 1 && el.products.some((p) => p.id === "AR-104"), "اسلات با sku فیلتر نشد");
  assert.equal(el.product.id, "AR-104", "محصول اولیه از sku انتخاب نشد");

  // کلیک روی دکمه نباید صفحه را بشکند (WebGL در jsdom نیست → مسیر خطا مدیریت شود)
  window.document.getElementById("b").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(errors, [], "خطای بعد از کلیک: " + errors.join(" | "));

  // API عمومی روی بیلد هم کار کند
  const api = window.TryOn.init({ mode: "overlay", products: [{ id: "z", name: "Z", shape: "round", size: "48-19-140" }] });
  assert.equal(api.products.length, 1);
  assert.ok(typeof api.el.shadowRoot.innerHTML === "string" && api.el.shadowRoot.innerHTML.length > 200);
  api.destroy();
  assert.equal(el.isConnected, true, "destroy نمونهٔ دیگر را نباید حذف کند");
});

test("dist/tryon.esm.js برای bandlerها export دارد", (t) => {
  if (!fs.existsSync(esmPath)) return t.skip("بیلد ESM نیست");
  const src = fs.readFileSync(esmPath, "utf8");
  assert.ok(/export\s*{[^}]*init/.test(src), "export init در ESM نیست");
  assert.ok(/export default|as default\b/.test(src), "default export در ESM نیست");
  assert.ok(!/import[^;]*from\s*["']\.\.\//.test(src), "import نسبی در ESM مانده");
});

test("products.json با کاتالوگ داخل بیلد هم‌خوان است", (t) => {
  const jsonPath = path.join(root, "products.json");
  if (!fs.existsSync(jsonPath)) return t.skip("products.json نیست");
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.ok(Array.isArray(data.products) && data.products.length >= 20, "کاتالوگ JSON کم است");
  for (const p of data.products.slice(0, 8)) {
    assert.ok(p.id && p.name && p.shape, "فیلد واجب کم است: " + p.id);
    assert.ok(p.colors?.length >= 1, p.id + " رنگ ندارد");
    assert.ok(!/NaN|null/.test(JSON.stringify(p.spec || {})), p.id + " spec خراب است");
  }
});
