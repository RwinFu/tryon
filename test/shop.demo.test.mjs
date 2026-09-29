/** End-to-end رفتار دمو فروشگاه در DOM مرورگر شبیه‌سازی‌شده. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("دموی فروشگاه کاتالوگ، دکمهٔ پرو کنار هر فریم، فیلتر و منوی موبایل را اجرا می‌کند", async () => {
  const dom = new JSDOM(read("index.html"), {
    url: "https://shop.test/tryon/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const catalog = JSON.parse(read("products.json"));
  const products = Array.isArray(catalog) ? catalog : catalog.products || catalog.items;
  window.fetch = async (url) => {
    assert.equal(new URL(url).href, "https://shop.test/tryon/products.json");
    return { ok: true, json: async () => products };
  };
  window.console.error = (...args) => assert.fail(`بارگذاری کاتالوگ شکست خورد: ${args.join(" ")}`);
  window.eval(read("site/shop.js"));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  const cards = [...window.document.querySelectorAll(".pcard")];
  assert.equal(cards.length, products.length, "تمام فریم‌های کاتالوگ در صفحه دیده نمی‌شوند");
  for (const card of cards) {
    const button = card.querySelector("[data-tryon-open][data-tryon-sku]");
    assert.ok(button, "برای یک فریم دکمهٔ پرو و SKU متناظر وجود ندارد");
    assert.match(button.getAttribute("aria-label"), /^پرو مجازی /, "دکمه نام دسترس‌پذیر ندارد");
    const sourceLink = card.querySelector(".sourceLink");
    assert.ok(sourceLink && /^https:\/\//.test(sourceLink.href), "لینک منبع محصول باید HTTPS باشد");
    assert.equal(sourceLink.rel, "noopener noreferrer", "پیوند خارجی باید در برابر tabnabbing ایمن باشد");
    assert.match(card.querySelector(".assetNote")?.textContent || "", /پیش‌نمایش/);
    const sku = card.querySelector(".frameMark")?.textContent;
    const product = products.find((item) => String(item.sku || item.id) === sku);
    assert.ok(product, "کارت باید با رکورد مدل واقعی متناظر باشد");
    assert.equal(card.querySelector(".material")?.textContent.trim(), product.composition);
  }
  assert.equal(cards[0].querySelector("[data-tryon-sku]").dataset.tryonSku, String(products[0].sku || products[0].id));

  const search = window.document.getElementById("productSearch");
  search.value = products[0].name;
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  const variants = products.filter((product) => product.name === products[0].name);
  assert.equal(window.document.querySelectorAll(".pcard").length, variants.length, "جست‌وجوی نام مدل، رنگ‌های همان مدل را نشان نمی‌دهد");

  search.value = products[0].modelCode;
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(window.document.querySelectorAll(".pcard").length, 1, "جست‌وجوی کد رنگ/مدل فیلتر نمی‌کند");
  assert.equal(window.document.querySelector(".pcard [data-tryon-sku]").dataset.tryonSku, String(products[0].sku || products[0].id));

  const menu = window.document.getElementById("menuToggle");
  const nav = window.document.getElementById("primaryNav");
  menu.click();
  assert.equal(menu.getAttribute("aria-expanded"), "true");
  assert.ok(nav.classList.contains("is-open"), "منوی موبایل باز نشد");
  nav.querySelector("a").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(menu.getAttribute("aria-expanded"), "false", "انتخاب پیوند، منوی موبایل را نبست");
  assert.ok(!nav.classList.contains("is-open"));
  dom.window.close();
});
