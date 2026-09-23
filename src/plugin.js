/**
 * plugin.js — نقطهٔ ورود عمومی افزونه (window.TryOn)
 *
 * سه روش نصب، از ساده به کامل:
 *  ۱) بدون کدنویسی: <script src="tryon.js" data-tryon-products="/tryon/products.json" defer>
 *     + <div data-tryon></div> روی صفحهٔ محصول  یا  <button data-tryon-open data-tryon-sku="AR-104">
 *  ۲) Shopify / WooCommerce: TryOn.fromShopify(product, metafield) / TryOn.fromWoo(p, meta)
 *  ۳) API: TryOn.init({...}) و اتصال رویدادها به سبد خرید و آنالیتیکس
 *
 * هیچ‌چیز در این فایل به سرور نیاز ندارد؛ همه‌چیز سمت مرورگر.
 */
import { VirtualTryOn, DEFAULT_CONFIG } from "./ui/widget.js";
import { CATALOG, CATALOG_BY_ID, toEngineSpec, FACE_SHAPES } from "./frame/catalog.js";
import { buildFrame } from "./frame/geometry.js";
import { frameKey } from "./frame/index.js";
import { FINISHES } from "./frame/materials.js";
import { renderThumbnails, renderStill } from "./engine/thumbs.js";
import { frameFromImage, guessShape } from "./frame/photogram.js";
import { exportGLB } from "./frame/glb.js";
import { fitReport, fitScore, recommend, classifyShape, faceShapeMetrics } from "./engine/fit.js";
import { guessColorHex, isColorOption, pickSizeOption } from "./frame/colornames.js";

export const VERSION = "2.0.0";

const instances = new Set();

/* ─────────────────────────── ابزار پیکربندی ─────────────────────────── */

function deepMerge(a, b) {
  const o = { ...a };
  for (const k in b) {
    const v = b[k];
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) o[k] = deepMerge(o[k], v);
    else o[k] = v;
  }
  return o;
}

/** کلیدهایی که باید رشته بمانند (شمارهٔ واتساپ/SKU نباید عدد شود) */
const STRINGY = /^(sku|whatsapp|url|name|tagline|lang|theme|mode|quality|baseURL|products|brand)$/;

/** مقدار attribute → نوع واقعی (true/false/عدد/JSON) */
export function coerceAttr(v, key) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (!STRINGY.test(key || "") && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[{[]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch (e) {
      return v;
    }
  }
  return v;
}

const FLAT = ["mode", "lang", "theme", "quality", "products", "sku", "watermark", "deepLink", "baseURL"];
const BRAND = { name: "name", brand: "name", accent: "accent", whatsapp: "whatsapp", tagline: "tagline", url: "url" };

/**
 * data-tryon-* → شیء پیکربندی. یک منبع برای هر دو: تگ <script> و المان میزبان.
 *   data-tryon-mode="overlay"      → { mode: "overlay" }
 *   data-tryon-accent="#d8b478"    → { brand: { accent: "#d8b478" } }
 *   data-tryon-cart="whatsapp"     → { cart: { mode: "whatsapp" } }
 *   data-tryon-config='{…}'        → JSON کامل (برای موارد خاص)
 */
export function tryonAttrs(dataset = {}) {
  const out = {};
  for (const [k, raw] of Object.entries(dataset)) {
    if (!k.startsWith("tryon") || k === "tryonConfig" || raw === undefined || raw === "") continue;
    const key = k.slice(5).replace(/^[A-Z]/, (c) => c.toLowerCase());
    const v = coerceAttr(raw, key);
    if (BRAND[key]) {
      out.brand = out.brand || {};
      out.brand[BRAND[key]] = v;
    } else if (key === "cart") out.cart = { mode: v };
    else if (key === "fit") out.features = { fitSheet: v };
    else if (key === "hair") out.features = { hairLayer: v };
    else if (FLAT.includes(key)) out[key] = v;
  }
  if (dataset.tryonConfig) {
    try {
      return deepMerge(typeof dataset.tryonConfig === "string" ? JSON.parse(dataset.tryonConfig) : dataset.tryonConfig, out);
    } catch (e) {
      console.warn("[TryOn] data-tryon-config معتبر نیست:", e.message);
    }
  }
  return out;
}

/** تگی که تنظیمات سراسری روی آن است: config → currentScript → هر script با data-tryon-* */
function scriptTag() {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return null;
  const byConfig = doc.querySelector("script[data-tryon-config]");
  if (byConfig) return byConfig;
  if (doc.currentScript && doc.currentScript.dataset && Object.keys(doc.currentScript.dataset).some((k) => k.startsWith("tryon")))
    return doc.currentScript;
  const all = doc.querySelectorAll ? doc.querySelectorAll("script[data-tryon-products],script[data-tryon-accent],script[data-tryon-lang],script[data-tryon-whatsapp],script[data-tryon-theme],script[data-tryon-brand],script[data-tryon-quality],script[data-tryon-mode]") : [];
  for (const s of all) if (s.dataset && Object.keys(s.dataset).some((k) => k.startsWith("tryon"))) return s;
  return null;
}

function readScriptConfig() {
  try {
    const s = scriptTag();
    if (!s) return {};
    return tryonAttrs(s.dataset || {});
  } catch (e) {
    return {};
  }
}

/* ─────────────────────────── ساخت نمونه ─────────────────────────── */

/** ساخت/نصب یک نمونهٔ پرو مجازی. @returns نمونهٔ API (open/close/select/…) */
export function init(config = {}) {
  if (typeof document === "undefined") throw new Error("TryOn.init: این افزونه در مرورگر کار می‌کند (بدون DOM).");
  const cfg = { ...config };
  let el = cfg.element || (typeof cfg.mount === "string" ? document.querySelector(cfg.mount) : cfg.mount);
  if (el && !(el instanceof VirtualTryOn)) {
    const wrap = document.createElement("virtual-tryon");
    wrap.style.cssText = "position:relative;display:block;width:100%;height:100%;min-height:100%";
    const radius = getComputedStyle(el).borderRadius;
    if (radius && radius !== "0px") wrap.style.borderRadius = radius;
    el.appendChild(wrap);
    el = wrap;
  }
  if (!el) {
    el = document.createElement("virtual-tryon");
    el.style.cssText = "position:fixed;inset:0;z-index:2147483000";
    document.body.appendChild(el);
  }
  el.configure({ ...cfg, mount: undefined, element: undefined, mountButton: cfg.mountButton || null });
  el.__vt = true;
  instances.add(el);

  const api = {
    version: VERSION,
    el,
    get quality() {
      return el.quality || el.cfg.quality;
    },
    get products() {
      return el.products || [];
    },
    get current() {
      return el.product;
    },
    open: () => el.open(),
    close: () => el.close(),
    toggle: () => (el.hidden ? el.open() : el.close()),
    select: (id) => el.selectProduct(id),
    setVariant: (i) => el.setVariant(i),
    setProducts: (list) => el.setProducts(list),
    fitReport: () => el.fitRows || [],
    fitScore: () => fitScore(el.fitRows || []),
    measurements: () =>
      el.pose ? { pd: el.pose.pdMm, faceW: el.pose.faceWmm, faceH: el.pose.faceHmm, nose: el.pose.noseWmm } : null,
    screenshot: () => el.snapshot(),
    on: (n, f) => el.on(n, f),
    off: (n, f) => el.off(n, f),
    destroy: () => {
      instances.delete(el);
      try {
        el.disconnectedCallback();
      } catch (e) {}
      el.remove();
    },
  };
  el.dispatchEvent(new CustomEvent("tryon:init", { detail: { config: cfg }, bubbles: true }));
  return api;
}

/** جاسازی خودکار از روی data-attributeها (نصب بدون کدنویسی) */
export function autoEmbed(root) {
  const doc = root || (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.querySelectorAll !== "function") return []; // Node/SSR: بی‌خطر
  const made = [];
  let overlay = null;
  const globalCfg = (typeof window !== "undefined" && window.__TRYON__) || readScriptConfig();

  for (const host of doc.querySelectorAll("[data-tryon]:not([data-tryon-done])")) {
    host.setAttribute("data-tryon-done", "1");
    // اولویت: attributeهای خود المان ← پیکربندی سراسری ← پیش‌فرض افزونه
    const local = tryonAttrs(host.dataset || {});
    const cfg = deepMerge({ ...globalCfg, mode: "inline" }, local);
    const api = init({ ...cfg, mount: host });
    if (local.sku) filterBySku(api, local.sku);
    made.push(api);
  }

  for (const btn of doc.querySelectorAll("[data-tryon-open]")) {
    if (btn.__vtBound) continue;
    btn.__vtBound = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const sku = btn.dataset ? btn.dataset.tryonSku : undefined;
      const target = btn.getAttribute ? btn.getAttribute("data-tryon-target") : null;
      const hostEl = target ? doc.querySelector(target) : null;
      // data-tryon-target → همان نمونهٔ inline داخل مقصد؛ وگرنه یک overlay مشترک (دکمهٔ کنار هر عینک)
      let api = hostEl ? made.find((a) => hostEl.contains(a.el)) : null;
      if (hostEl && !api) api = init({ ...globalCfg, mode: "inline", mount: hostEl });
      if (!api) {
        api = overlay && overlay.el.isConnected ? overlay : (overlay = init({ ...globalCfg, mode: "overlay" }));
      }
      if (sku) {
        filterBySku(api, sku);
        api.select(sku);
      }
      if (hostEl) hostEl.scrollIntoView?.({ behavior: "smooth", block: "center" });
      api.open();
      if (typeof document !== "undefined")
        document.dispatchEvent(new CustomEvent("tryon:open", { detail: { sku: sku || null, source: btn } }));
    });
  }
  return made;
}

/** با SKU/id داده شود، لیست را به همان مدل + شبیه‌هایش محدود می‌کند */
function filterBySku(api, sku) {
  const p = CATALOG_BY_ID.get(String(sku));
  if (p) api.setProducts([p, ...CATALOG.filter((x) => x.shape === p.shape && x.id !== p.id).slice(0, 5)]);
}

/* ─────────────────────────── نگاشت فروشگاه‌ها ─────────────────────────── */

const money = (v) => {
  if (typeof v === "number") return v;
  const n = Number(String(v === undefined || v === null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** رنگ‌ها را از گزینه‌های محصول می‌سازد (Shopify options / Woo attributes) */
function colorsFromOptions(options = [], variants = [], terms = []) {
  const list = (options && options.length ? options : terms) || [];
  const opt = list.find((o) => isColorOption(o.name)) || list.find((o) => /^(title|رنگ‌بندی)$/i.test(o.name || ""));
  const values = (opt && (opt.values || (opt.terms && opt.terms.map((t) => t.name)))) || [];
  if (!values.length) return null;
  return values.slice(0, 12).map((v) => {
    const name = typeof v === "string" ? v : v.name;
    const va = (variants || []).find((x) => String(x.title || x.name || "").toLowerCase().includes(String(name).toLowerCase()));
    const out = { name, color: guessColorHex(name) };
    if (va && va.available === false) out.soldOut = true;
    if (va && va.featured_image && va.featured_image.src) out.image = va.featured_image.src;
    else if (va && va.image && va.image.src) out.image = va.image.src;
    if (va && va.sku) out.sku = va.sku;
    return out;
  });
}

function sizeFromOptions(options = []) {
  const opt = (options || []).find((o) => pickSizeOption(o.name));
  if (!opt || !opt.values || !opt.values[0]) return undefined;
  return String(opt.values[0]).replace(/\s+/g, " ").trim();
}

/** نگاشت محصول Shopify → اسکیمای افزونه (metafield: custom.tryon_frame = JSON) */
export function fromShopify(product, frameJson) {
  const meta = typeof frameJson === "string" ? JSON.parse(frameJson || "{}") : frameJson || {};
  const v = (product && product.variants && product.variants[0]) || {};
  const colors = colorsFromOptions(product.options, product.variants);
  const size = sizeFromOptions(product.options);
  return {
    id: String(product.id != null ? product.id : v.sku != null ? v.sku : product.handle),
    sku: v.sku,
    name: product.title,
    brand: product.vendor,
    price: money(v.price != null ? v.price : product.price),
    priceMax: money(product.price_max),
    currency: product.price_currency || (product.price && product.price.currency_code) || product.currency_code,
    url: product.handle ? "/products/" + product.handle : undefined,
    images: (product.images || []).slice(0, 5).map((i) => i.src),
    available: product.available,
    ...(colors ? { colors } : {}),
    ...(size ? { size } : {}),
    ...meta, // متافیلد همیشه برنده است: shape/size/spec/lens/…
  };
}

/** نگاشت محصول WooCommerce → اسکیمای افزونه (متا: _tryon_frame) */
export function fromWoo(p, meta) {
  const frame = typeof meta === "string" ? JSON.parse(meta || "{}") : meta || (p && p._tryon_frame) || {};
  const attrs = p.attributes || [];
  const colors = colorsFromOptions([], p.variations, attrs);
  const sizeAttr = attrs.find((a) => pickSizeOption(a.name));
  return {
    id: String(p.id),
    sku: p.sku || (p.variations && p.variations[0] && p.variations[0].sku),
    name: p.name,
    price: money(p.price),
    currency: p.currency_code || "IRT",
    url: p.permalink,
    images: (p.images || []).map((i) => i.src),
    onSale: !!p.on_sale,
    ...(colors ? { colors } : {}),
    ...(sizeAttr && sizeAttr.terms && sizeAttr.terms[0] && sizeAttr.terms[0].name ? { size: sizeAttr.terms[0].name } : {}),
    ...frame,
  };
}

/* ─────────────────────────── سطح عمومی ─────────────────────────── */

export {
  VirtualTryOn,
  DEFAULT_CONFIG,
  CATALOG,
  CATALOG_BY_ID,
  toEngineSpec,
  buildFrame,
  frameKey,
  FINISHES,
  FACE_SHAPES,
  renderThumbnails,
  renderStill,
  frameFromImage,
  guessShape,
  exportGLB,
  guessColorHex,
  isColorOption,
  fitReport,
  fitScore,
  recommend,
  classifyShape,
  faceShapeMetrics,
  VERSION as version,
};

/** window.TryOn — تنها چیزی که یک فروشگاه لازم دارد (همه‌چیز از همین یک شیء) */
const api = {
  version: VERSION,
  VERSION,
  // نصب
  init,
  mount: init,
  autoEmbed,
  // داده و پیش‌فرض‌ها
  CATALOG,
  catalog: CATALOG,
  CATALOG_BY_ID,
  DEFAULT_CONFIG,
  FINISHES,
  FACE_SHAPES,
  instances,
  // اتصال به فروشگاه
  fromShopify,
  fromWoo,
  guessColorHex,
  isColorOption,
  tryonAttrs,
  // موتور (برای سفارشی‌سازی و ساخت کاتالوگ)
  toEngineSpec,
  buildFrame,
  frameKey,
  renderThumbnails,
  renderStill,
  frameFromImage,
  guessShape,
  exportGLB,
  fitReport,
  fitScore,
  recommend,
  classifyShape,
  faceShapeMetrics,
};

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
if (isBrowser) {
  window.TryOn = window.TryOn || api;
  const go = () => {
    try {
      autoEmbed(document);
    } catch (e) {
      console.error("[TryOn] autoEmbed:", e);
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", go, { once: true });
    // اسکریپت‌های تزریقی/async: اگر اسلات از قبل در DOM است، معطل DOMContentLoaded نمانیم
    queueMicrotask(() => {
      try {
        if (document.querySelector("[data-tryon],[data-tryon-open]")) go();
      } catch (e) {}
    });
  } else go();
}

export default api;
