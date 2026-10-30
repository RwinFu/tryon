/**
 * تستِ شِلِ رابط (jsdom): چیدمانِ خلوت یک قرارداد است، نه سلیقه.
 * هر عنصری که از دید مشتری حذف شده باید همان‌جا بماند حذف‌شده؛ و هر چیزی
 * که مانده (قفسه، ریل، حکمِ فیت، سبد) باید با داده کار کند.
 *
 * docs/UI-SPEC.md §۲ — آزمونِ پذیرشِ ۶.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><html lang="fa" dir="rtl"><head><title>فروشگاه</title></head><body></body></html>`, {
  url: "https://optics.test/",
  pretendToBeVisual: true,
});
const { window } = dom;
window.requestIdleCallback = () => 0;
Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
for (const k of ["window", "document", "navigator", "HTMLElement", "customElements", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Image", "Element", "Node"]) {
  if (window[k] === undefined) continue;
  try {
    Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true });
  } catch {
    /* Node خودش این getter را دارد */
  }
}

const { init } = await import("../src/plugin.js");

const PRODUCTS = [
  { id: "AR-101", name: "Wayfarer", brand: "Arvin", shape: "square", size: "50-22-150", price: 1850, currency: "تومان", colors: [{ name: "مشکی", color: "#111" }, { name: "عسلی", color: "#8a5a2b" }] },
  { id: "AR-104", name: "Round", brand: "Arvin", shape: "round", size: "48-19-140", price: 2100, currency: "تومان" },
];

const shell = (extra = {}) => init({ mode: "inline", lang: "fa", products: PRODUCTS, ...extra });

test("شِلِ پیش‌فرض فقط قفسه و صحنه است؛ کنترل‌های اضافی ساخته نمی‌شوند", () => {
  const api = shell();
  const q = (sel) => api.el.shadowRoot.querySelector(sel);
  assert.ok(q(".stage"), "صحنه نیست");
  assert.ok(q(".shelf"), "قفسه نیست");
  assert.ok(q("#rail"), "ریل فریم‌ها نیست");
  assert.ok(q("#addToCart"), "دکمهٔ سبد نیست");
  assert.ok(q("#pName") && q("#pPrice") && q("#pFit"), "ردیفِ نام/قیمت/فیت نیست");
  // آن‌چه حذف شد نباید برگردد
  for (const gone of ["#openFit", "#sheet", ".camTools", ".tryControls", "#zoomIn", "#zoomOut", "#indoor", "#outdoor", "#actions", "#snapshot", "#scanBtn", "#pdIn"]) {
    assert.equal(q(gone), null, "عنصرِ حذف‌شده برگشته: " + gone);
  }
  // گیت: دو اقدام و هیچ مرحلهٔ شماره‌دار
  assert.ok(q("#start"), "دکمهٔ شروع نیست");
  assert.ok(q("#photoStart"), "راهِ عکس نیست");
  assert.equal(api.el.shadowRoot.querySelectorAll(".steps div").length, 0, "مرحله‌های ۱/۲/۳ برگشته‌اند");
  api.destroy();
});

test("ریل: کارت‌ها فقط تصویر دارد و انتخاب، نام/قیمت/رنگ را عوض می‌کند", () => {
  const api = shell();
  const root = api.el.shadowRoot;
  const cards = [...root.querySelectorAll(".card")];
  assert.equal(cards.length, PRODUCTS.length, "تعداد کارت با کاتالوگ نمی‌خواند");
  for (const c of cards) assert.equal(c.querySelector("em"), null, "برچسبِ متنیِ روی کارت برگشته");
  assert.equal(cards[0].getAttribute("aria-pressed"), "true");
  assert.match(root.querySelector("#pName").textContent, /Wayfarer/);
  assert.match(root.querySelector("#pPrice").textContent, /۱٬۸۵۰|1,850/);
  cards[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(cards[1].getAttribute("aria-pressed"), "true");
  assert.equal(cards[0].getAttribute("aria-pressed"), "false");
  assert.equal(api.el.product.id, "AR-104");
  assert.match(root.querySelector("#pName").textContent, /Round/);
  api.destroy();
});

test("حکمِ فیت: یک خط با رنگِ درست، بدون برگه", () => {
  const api = shell();
  const el = api.el;
  const line = el.shadowRoot.querySelector("#pFit");
  assert.equal(line.dataset.state, "idle");
  assert.ok(line.querySelector("em").textContent.length > 0, "خطِ فیت خالی است");
  const cases = [
    [["verdictGood", "good"], "good", "اندازه"],
    [["verdictCheck", "warn"], "warn", "تنگ"],
    [["verdictOff", "bad"], "bad", "معلوم"],
  ];
  for (const [state, attr, word] of cases) {
    el.fitState = state;
    el.setFitLine();
    assert.equal(line.dataset.state, attr);
    assert.match(line.querySelector("em").textContent, new RegExp(word));
  }
  assert.equal(el.shadowRoot.querySelector("#sheet"), null, "برگهٔ فیت در شِلِ پیش‌فرض ساخته شد");
  api.destroy();
});

test("پنل‌های اختیاری فقط با فلگ ساخته می‌شوند و کار می‌کنند", () => {
  const api = shell({ features: { fitSheet: true } });
  const el = api.el;
  const sheet = el.shadowRoot.querySelector("#sheet");
  assert.ok(sheet, "برگهٔ فیت با فلگ ساخته نشد");
  assert.ok(el.shadowRoot.querySelector("#specGrid"), "خانه‌های مشخصات نیست");
  assert.equal(el.openSheet(true), true);
  assert.ok(sheet.classList.contains("open"), "برگه باز نشد");
  assert.equal(el.openSheet(false), false);
  assert.ok(!sheet.classList.contains("open"));
  // اسکن بدون فلگ: هیچ ظرفی برای نتیجه نیست و فراخوانی بی‌خطر است
  assert.equal(el.shadowRoot.querySelector("#shapeBox"), null);
  assert.doesNotThrow(() => el.runFaceScan());
  api.destroy();
});

test("سبد: یک دکمه، یک رویداد", () => {
  const api = shell();
  const el = api.el;
  const seen = [];
  el.on("cart", (item) => seen.push(item));
  el.shadowRoot.querySelector("#addToCart").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(seen.length, 1, "رویدادِ سبد نیامد");
  assert.equal(seen[0].id, "AR-101");
  api.destroy();
});

test("با فلگِ سبد خاموش، دکمه پنهان می‌شود", () => {
  const api = shell({ features: { cart: false } });
  const cta = api.el.shadowRoot.querySelector("#addToCart");
  assert.ok(cta.hidden, "دکمهٔ سبد با فلگِ خاموش پنهان نشد");
  api.destroy();
});
