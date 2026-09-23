/**
 * widget.js — <virtual-tryon> : کامپوننت قابل جاسازی برای سایت فروشگاه
 *
 * دو حالت:  mode="overlay" (تمام‌صفحه، با دکمهٔ فراخوانی)  |  mode="inline" (کارت داخل صفحهٔ محصول)
 * رویدادها روی عنصر dispatch می‌شوند تا فروشگاه به سبد خرید/آنالیتیکس وصل کند:
 *   tryon:ready · tryon:product · tryon:variant · tryon:snapshot · tryon:cart · tryon:fit · tryon:error
 */
import { Stage } from "../engine/stage.js";
import { FaceTracker } from "../engine/tracking.js";
import { FaceMeshScan, SHAPE_COPY, ShapeScanner, fitReport, recommend } from "../engine/fit.js";
import { CATALOG, toEngineSpec } from "../frame/catalog.js";
import { renderThumbnails } from "../engine/thumbs.js";
import { t } from "../ui/i18n.js";
import cssText from "./styles.gen.js";
import * as THREE from "three";

const ICONS = {
  round: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="3"><circle cx="15" cy="14" r="10"/><circle cx="49" cy="14" r="10"/><path d="M25 11h14"/></g></svg>',
  square: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="3"><rect x="3" y="4" width="24" height="18" rx="5"/><rect x="37" y="4" width="24" height="18" rx="5"/><path d="M27 11h10"/></g></svg>',
  cateye: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="3"><ellipse cx="15" cy="14" rx="12" ry="8" transform="rotate(-9 15 14)"/><ellipse cx="49" cy="14" rx="12" ry="8" transform="rotate(9 49 14)"/><path d="M26 11h12"/></g></svg>',
  aviator: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="3"><path d="M4 6h22c0 9-4 15-11 15S4 15 4 6z"/><path d="M38 6h22c0 9-4 15-11 15s-11-6-11-15z"/><path d="M26 9h12"/></g></svg>',
  rectangle: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="3"><rect x="2" y="7" width="26" height="13" rx="4"/><rect x="36" y="7" width="26" height="13" rx="4"/><path d="M28 12h8"/></g></svg>',
  browline: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="3"><path d="M3 8h24"/><path d="M37 8h24"/><path d="M27 12h10" stroke-width="2"/><path d="M5 8c0 8 4 12 11 12s10-4 10-12M38 8c0 8 3 12 10 12s11-4 11-12" stroke-width="2"/></g></svg>',
  octagon: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="2.6"><path d="M9 5h12l6 6-6 7H9l-6-7z"/><path d="M43 5h12l6 6-6 7H43l-6-7z"/><path d="M27 12h10"/></g></svg>',
  shield: '<svg viewBox="0 0 64 26" width="46" height="19"><g fill="none" stroke="currentColor" stroke-width="3"><path d="M3 7h58c0 8-6 13-29 13S3 15 3 7z"/></g></svg>',
};

export const DEFAULT_CONFIG = {
  brand: { name: "اپتیک آروین", tagline: "پرو مجازی هوشمند عینک", accent: "#d8b478", whatsapp: "", url: "" },
  lang: "fa",
  theme: "auto", // auto | light | dark
  mode: "overlay", // overlay | inline
  products: null, // آرایه یا URL به JSON
  features: {
    faceScan: true,
    hairLayer: true,
    contactShadow: true,
    lightMatch: true,
    thumbnails: true,
    photo: true,
    fitSheet: true,
    snapshot: true,
    cart: true,
    pd: true,
  },
  quality: "auto", // auto | high | lite
  cart: { mode: "event" }, // event | whatsapp | link
  tracking: { vertexDistance: 13, focalScale: 0.75, pd: 63, autoPd: true },
  assets: {},
  mountButton: null,
  watermark: true,
  deepLink: false, // نشانی صفحه را با #f= عوض نکند مگر فروشگاه خودش بخواهد
};

const Native = typeof HTMLElement === "function" ? HTMLElement : class {};

/**
 * عنصر <virtual-tryon> — خودکفا: سایه‌DOM، بدون CSS جهانی، بدون framework.
 * اگر HTMLElement وجود نداشته باشد (SSR/تست) کلاس فقط تعریف می‌ماند.
 */
export class VirtualTryOn extends Native {
  constructor() {
    super();
    this.root = this.attachShadow ? this.attachShadow({ mode: "open" }) : this;
    this.cfg = deepMerge(deepMerge({}, structuredCloneSafe(DEFAULT_CONFIG)), {});
    this.state = "idle";
    this.listeners = new Map();
  }

  /** ورودی اصلی از TryOn.init() */
  configure(cfg = {}) {
    const wasMounted = !!this.cfg.mounted;
    deepMerge(this.cfg, cfg);
    if (!wasMounted) {
      this.cfg.mounted = true;
      this.build();
      return this;
    }
    // پیکربندی بعد از chasب (init_element زودتر به DOM اضافه می‌شود): باید اعمال شود
    if (!this.booted) this.build();
    else {
      this.loadProducts();
      this.buildActions();
    }
    return this;
  }

  connectedCallback() {
    if (!this.cfg.mounted) this.configure({});
  }

  /* ─────────────────────────── ساخت DOM ─────────────────────────── */
  build() {
    const c = this.cfg;
    const L = (k) => t(c.lang, k);
    this.root.innerHTML = `<style>${cssText}</style>
<div class="wrap stage-wrap">
  <div class="stage" part="stage">
    <canvas id="cv"></canvas>
    <canvas id="sh" style="mix-blend-mode:multiply"></canvas>
    <canvas id="gl"></canvas>
    <canvas id="oc"></canvas>
    <canvas id="mesh"></canvas>
    <div class="scanline"></div>
  </div>
  <header class="top">
    <div class="brand">${esc(c.brand.name || "")}<small>${esc(c.brand.tagline || "")}</small></div>
    <div class="topR">
      <div class="status" id="status" data-state="idle"><i></i><span>${L("statusIdle")}</span></div>
      ${c.mode === "overlay" ? '<button class="xbtn" id="close" aria-label="' + L("close") + '">✕</button>' : ""}
    </div>
  </header>
  <div class="hint" id="hint" role="status" aria-live="polite"></div>
  <nav class="dock" part="dock">
    <button class="pull" id="openFit" aria-expanded="false">
      <span><b id="pName">${L("selectFrame")}</b><span id="pFit">${L("fitPending")}</span></span>
      <span class="price" id="pPrice">—</span>
    </button>
    <div class="rail" id="rail" role="listbox" aria-label="${L("frames")}" tabindex="0"></div>
    <div class="swatches" id="swatches"></div>
    <div class="actions" id="actions"></div>
  </nav>
  <section class="sheet" id="sheet" role="dialog" aria-modal="false" aria-labelledby="sheetTitle">
    <h3 id="sheetTitle">${L("fitTitle")}</h3>
    <p class="lead" id="sheetLead">${L("fitLead")}</p>
    <div class="specgrid" id="specGrid"></div>
    <div id="fitRows"></div>
    <div id="pdBox"></div>
    <div id="shapeBox"></div>
    <div class="rowEnd">
      <button class="btn" id="scanBtn">${L("scanFace")}</button>
      <button class="btn primary" id="sheetClose">${L("close")}</button>
    </div>
  </section>
  <section class="gate" id="gate">
    <div class="card2">
      <div class="mark">${ICONS.cateye}</div>
      <h2 data-sub="VIRTUAL FIT STUDIO">${esc(c.brand.name || L("title"))}</h2>
      <p class="sub">${L("gateSub")}</p>
      <p class="gateProd" id="gateProduct" hidden></p>
      <div id="gateBody">
        <div class="steps">
          <div><b>۱</b><span>${L("step1")}</span></div>
          <div><b>۲</b><span>${L("step2")}</span></div>
          <div><b>۳</b><span>${L("step3")}</span></div>
        </div>
        <div id="gateBusy"></div>
        <button class="go" id="start">${L("start")}</button>
        <p class="priv">${L("privacy")}</p>
      </div>
    </div>
  </section>
</div>`;

    this.$ = (id) => this.root.getElementById(id);
    this.el = {
      wrap: this.root.querySelector(".wrap"),
      stage: this.root.querySelector(".stage"),
      cv: this.$("cv"),
      sh: this.$("sh"),
      gl: this.$("gl"),
      oc: this.$("oc"),
      mesh: this.$("mesh"),
      rail: this.$("rail"),
      sw: this.$("swatches"),
      actions: this.$("actions"),
      gate: this.$("gate"),
      hint: this.$("hint"),
      status: this.$("status"),
      sheet: this.$("sheet"),
    };
    this.ctx = {
      cv: this.el.cv.getContext("2d", { alpha: false }),
      sh: this.el.sh.getContext("2d"),
      oc: this.el.oc.getContext("2d"),
      mesh: this.el.mesh.getContext("2d"),
    };
    this.scan = new FaceMeshScan(this.el.mesh);
    this.scanner = new ShapeScanner();

    this.classList.add(c.mode === "inline" ? "mode-inline" : "mode-overlay");
    if (c.brand.accent) {
      this.style.setProperty("--vt-accent", c.brand.accent);
      this.style.setProperty("--vt-accent-2", lighten(c.brand.accent, 0.28));
    }
    this.setAttribute("theme", c.theme);
    this.lang = c.lang;
    if (c.lang === "fa" || c.lang === "ar") this.setAttribute("dir", "rtl");
    this.buildActions();
    this.bindUI();

    this.mount = c.mountButton ? document.querySelector(c.mountButton) : null;
    if (this.mount && c.mode === "overlay") {
      this.mountBtn = this.mount;
      this.mountListener = () => this.open();
      this.mount.addEventListener("click", this.mountListener);
    }
    if (c.mode === "inline") {
      this.el.gate.hidden = false;
    } else {
      this.hidden = true;
    }
    this.loadProducts();
    if (c.theme === "auto") this.detectHostTheme();
  }

  buildActions() {
    const c = this.cfg,
      L = (k) => t(c.lang, k);
    const list = [];
    if (c.features.pd) list.push(["fit", L("fit"), "", "secondary"]);
    if (c.features.faceScan) list.push(["scan", L("faceShape"), "", "secondary"]);
    if (c.features.photo) list.push(["photo", L("photoTry"), "", "secondary"]);
    if (c.features.snapshot) list.push(["snap", L("snapshot"), "", "primary"]);
    if (c.features.cart) list.push(["cart", L("addToCart"), "", "buy"]);
    this.el.actions.innerHTML = list
      .map(
        ([id, label, sub, cls]) =>
          `<button class="btn ${cls}" data-a="${id}">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</button>`,
      )
      .join("");
  }

  detectHostTheme() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "#fff";
      const m = bg.match(/\d+/g);
      if (!m) return;
      const lum = (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
      this.setAttribute("theme", lum > 0.6 ? "light" : "dark");
    } catch (e) {
      /* بی‌خطر */
    }
  }

  /* ─────────────────────────── محصولات ──────────────────────────── */
  async loadProducts() {
    let src = this.cfg.products;
    let items = null;
    if (typeof src === "string") {
      try {
        const r = await fetch(src, { headers: { accept: "application/json" } });
        const data = await r.json();
        items = Array.isArray(data) ? data : data.products || data.items;
      } catch (e) {
        this.emit("error", { where: "products", message: String(e.message || e) });
      }
    } else if (Array.isArray(src) && src.length) items = src;
    this.products = (items && items.length ? items : CATALOG).map((p, i) => ({
      ...p,
      id: String(p.id ?? i + 1),
      colors: p.colors?.length ? p.colors : [{ name: t(this.cfg.lang, "defaultColor") }],
      spec: p.spec && p.spec.lensW ? p.spec : toEngineSpec(p),
    }));
    this.variant = 0;
    this.renderRail();
    this.select(this.firstIndex(), true);
  }

  /** محصول اول: sku پیکربندی → #f=/ ?f= صفحه → ایندکس عددی → ردیف صفر */
  firstIndex() {
    const want = this.cfg.sku || this.cfg.product || deepLinkId();
    if (want) {
      const key = String(want);
      let i = this.products.findIndex((p) => p.id === key || String(p.sku || "") === key || p.name === key);
      if (i < 0 && /^\d+$/.test(key)) i = Math.min(this.products.length - 1, Math.max(0, parseInt(key, 10) - (key.length <= 2 ? 1 : 0)));
      if (i >= 0) return i;
    }
    return 0;
  }

  renderRail() {
    const rail = this.el.rail;
    rail.innerHTML = "";
    this.cards = this.products.map((p, i) => {
      const b = document.createElement("button");
      b.className = "card";
      b.setAttribute("role", "option");
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", p.name || String(p.id));
      b.innerHTML = (ICONS[p.shape] || ICONS.square) + `<em>${esc(p.name || p.id)}</em>`;
      b.addEventListener("click", () => this.select(i));
      rail.appendChild(b);
      return b;
    });
    if (this.cfg.features.thumbnails) this.makeThumbs();
  }

  /** تامبنیل‌ها از همان هندسهٔ سه‌بعدی رندر می‌شوند → فروشگاه لازم نیست عکس محصول آپلود کند */
  async makeThumbs() {
    try {
      // در بیکاری مرورگر؛ اولین رندر/تعامل صفحه معطل ۲۸ تامبنیل سه‌بعدی نمی‌ماند
      await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 120)));
      if (this.dead) return;
      const urls = await renderThumbnails(this.products, { THREE, size: 200, quality: this.cfg.quality === "lite" ? "lite" : "high" });
      this.cards.forEach((c, i) => {
        if (!urls[i]) return;
        const img = new Image();
        img.alt = "";
        img.decoding = "async";
        img.onload = () => {
          const svg = c.querySelector("svg");
          svg && svg.replaceWith(img);
        };
        img.src = urls[i];
      });
    } catch (e) {
      /* آیکن‌های SVG می‌مانند */
    }
  }

  select(i, silent) {
    if (!this.products?.length) return;
    this.byIndex = i;
    this.variant = 0;
    const p = this.products[i];
    this.spec = toEngineSpec(p);
    this.product = p;
    this.cards?.forEach((c, k) => {
      c.setAttribute("aria-pressed", k === i ? "true" : "false");
      c.classList.toggle("rec", !!this.recommended?.includes(String(p.id)));
    });
    if (this.cfg.deepLink && typeof location !== "undefined" && location.hash !== "#f=" + p.id) {
      try {
        history.replaceState(null, "", "#f=" + p.id);
      } catch (e) {}
    }
    this.renderSwatches();
    this.renderMeta();
    this.stage?.setProduct({ ...p, ...(this.variants?.[i ?? this.variant] || this.variants?.[this.variant] || {}) });
    this.rebuildShadow();
    if (!silent) this.emit("product", { id: p.id, product: p });
  }

  setVariant(v) {
    if (!this.variants?.[v]) return;
    this.variant = v;
    [...this.el.sw.children].forEach((b, k) => b.setAttribute("aria-pressed", k === v ? "true" : "false"));
    const p = { ...this.product, ...this.variants[v] };
    this.stage?.setProduct(p);
    this.renderMeta();
    this.emit("variant", { id: this.product.id, variant: this.variants[v], product: p });
  }

  renderSwatches() {
    const p = this.product,
      box = this.el.sw;
    this.variants = p.colors || [];
    box.innerHTML = "";
    if (this.variants.length < 2) {
      box.style.display = "none";
      return;
    }
    box.style.display = "flex";
    this.variants.forEach((v, i) => {
      const b = document.createElement("button");
      b.className = "dot";
      b.title = v.name || "";
      b.setAttribute("aria-label", v.name || "");
      b.setAttribute("aria-pressed", i === this.variant ? "true" : "false");
      b.style.background = v.color || "#33363c";
      b.addEventListener("click", () => this.setVariant(i));
      box.appendChild(b);
    });
  }

  renderMeta() {
    const p = this.product;
    if (!p) return;
    const v = this.variants?.[this.variant] || {};
    this.$("pName").textContent = p.name + (v.name ? " · " + v.name : "");
    const price = p.price;
    this.$("pPrice").innerHTML = price
      ? `${new Intl.NumberFormat(this.lang === "fa" ? "fa-IR" : "en-US").format(price)}<small> ${esc(p.currency || t(this.lang, "toman"))}</small>`
      : esc(p.size || "");
    this.$("pFit").textContent = this.fitSummary || t(this.lang, "fitPending");
    const gp = this.$("gateProduct");
    if (gp) {
      gp.hidden = false;
      gp.innerHTML = `<span>${esc(t(this.lang, "selectedFrame"))}</span><b>${esc(p.name)}${v.name ? " · " + esc(v.name) : ""}</b>${
        p.size ? `<small>${esc(String(p.size))}</small>` : ""
      }`;
    }
    this.renderSpec();
  }

  renderSpec() {
    const box = this.$("specGrid");
    if (!box || !this.spec) return;
    const cells = [
      [this.spec.lensW, t(this.lang, "lensWidth")],
      [this.spec.dbn, t(this.lang, "bridge")],
      [this.spec.templeLen, t(this.lang, "temple")],
      [Math.round(2 * this.spec.lensW + this.spec.dbn), t(this.lang, "totalWidth")],
    ];
    box.innerHTML = cells
      .map(([v, k]) => `<div><b>${v}</b><span>${esc(k)}</span></div>`)
      .join("");
  }

  rebuildShadow() {
    if (!this.stage) return;
    this.stage.shadowPath = this.stage.shadowPath || [];
  }

  /* ─────────────────────────── اتصال موتور ──────────────────────── */
  pickQuality() {
    const cfg = this.cfg;
    return cfg.quality === "auto"
      ? navigator.hardwareConcurrency > 4 && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? "high"
        : "lite"
      : cfg.quality;
  }

  /**
   * گرم‌کردن پیش از «شروع»: کتابخانهٔ MediaPipe + WASM + مدل (≈۱۳MB بار اول، بعداً از کش) در پس‌زمینه
   * بار می‌شود تا وقتی مشتری «شروع» را زد فقط اجازهٔ دوربین بماند. دوربین اینجا باز نمی‌شود (نیاز به کلیک کاربر).
   */
  prewarm() {
    if (this.booted || this.prewarmP) return this.prewarmP;
    const cfg = this.cfg;
    this.THREE = THREE;
    const base = cfg.baseURL || new URL(".", document.baseURI).href.replace(/\/$/, "");
    this.tracker = new FaceTracker({
      baseURL: base,
      assets: cfg.assets,
      pd: cfg.tracking.pd,
      autoPd: cfg.tracking.autoPd !== false,
      vertexDistance: cfg.tracking.vertexDistance,
      focalScale: cfg.tracking.focalScale,
      log: (k, m) => this.emit("log", { k, m }),
    });
    this.prewarmP = this.tracker
      .init((where, msg) => this.starting && this.busy(msg))
      .then(() => this.tracker)
      .catch((e) => {
        this.prewarmP = null; // در boot دوباره تلاش می‌شود
        throw e;
      });
    return this.prewarmP;
  }

  async boot() {
    if (this.booted) return;
    this.booted = true;
    this.starting = true;
    const cfg = this.cfg;
    this.state = "loading";
    this.setStatus("search", t(cfg.lang, "loading"));
    try {
      const initP = this.prewarmP || this.prewarm();
      initP.catch(() => {}); // اگر دوربین زودتر خطا داد، رد شدنِ این یکی unhandled نشود
      this.quality = this.pickQuality();
      // دوربین (اجازهٔ کاربر) موازی با بارگذاری مدل: طولانی‌ترین کارها هم‌زمان
      this.busy(t(cfg.lang, "cameraAsk"));
      const camP = this.tracker.startCamera({ light: this.quality === "lite" });
      this.stage = new Stage({
        canvas: this.el.gl,
        THREE: this.THREE,
        quality: this.quality,
        video: this.tracker.video,
      });
      this.stage.onFrameError = (e) => this.hint(t(cfg.lang, "modelFailed") + " — " + (e?.message || ""), true);
      this.stage.setProduct({ ...this.product, ...(this.variants?.[this.variant] || {}) }, { quality: this.quality });
      await camP;
      this.busy(t(cfg.lang, "loading"));
      await initP;
      this.syncSize();
      this.onResize = this.onResize || (() => this.syncSize());
      window.addEventListener("resize", this.onResize);
      this.busy("");
      this.starting = false;
      this.el.gate.hidden = true;
      this.state = "live";
      this.setStatus("live", t(cfg.lang, "live"));
      this.loop();
      // محیط نوری (PMREM) بعد از اولین فریم: دوربین زودتر دیده می‌شود
      requestAnimationFrame(() => this.stage?.buildEnv());
      if (cfg.features.hairLayer && this.quality !== "lite") setTimeout(() => this.tracker?.initHair?.().catch(() => {}), 4000);
      this.emit("ready", { quality: this.quality, products: this.products.length });
    } catch (e) {
      this.booted = false;
      this.starting = false;
      this.tracker?.stopCamera?.();
      this.state = "error";
      this.setStatus("error", t(cfg.lang, "cameraBlocked"));
      this.showError(e);
      this.emit("error", { where: "boot", message: String(e?.message || e), name: e?.name });
      throw e;
    }
  }

  syncSize() {
    const v = this.tracker?.video;
    if (!v?.videoWidth) return;
    const W = v.videoWidth,
      H = v.videoHeight;
    for (const c of [this.el.cv, this.el.gl, this.el.oc, this.el.sh, this.el.mesh]) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
    }
    this.stage?.resize(W, H);
  }

  busy(msg) {
    const box = this.$("gateBusy");
    if (!box) return;
    box.innerHTML = msg ? `<div class="spin"></div><p class="sub">${esc(msg)}</p>` : "";
  }

  showError(e) {
    const box = this.$("gateBody") || this.root.querySelector(".card2");
    if (!box) return;
    const key = /SecurityError/.test(e?.name || "")
      ? "needHttps"
      : /NotAllowed|Permission/.test(e?.name || "")
        ? "permDenied"
        : /NotFound|DevicesNotFound/.test(e?.name || "")
          ? "noCamera"
          : /NotReadable|TrackStart/.test(e?.name || "")
            ? "busy"
            : "genericError";
    const old = box.querySelector(".err");
    old && old.remove();
    const d = document.createElement("div");
    d.className = "err";
    d.innerHTML = `${esc(t(this.cfg.lang, key))}<code>${esc(String(e?.message || e || "").slice(0, 160))}</code>`;
    box.appendChild(d);
    const start = this.$("start");
    if (start) {
      start.textContent = t(this.cfg.lang, "retry");
      start.disabled = false;
    }
  }

  setStatus(state, text) {
    const s = this.el.status;
    s.dataset.state = state;
    s.querySelector("span").textContent = text;
  }

  hint(text, force) {
    const now = performance.now();
    if (!force && now - (this._hintAt || 0) < 3400) return;
    this._hintAt = now;
    const h = this.el.hint;
    h.textContent = text;
    h.classList.add("show");
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => h.classList.remove("show"), 2600);
  }

  /* ─────────────────────────── حلقهٔ رندر ──────────────────────── */
  loop() {
    if (this.dead) return;
    requestAnimationFrame(() => this.loop());
    const tr = this.tracker,
      v = tr.video;
    if (!v.videoWidth || this.state !== "live") return;
    const now = performance.now();
    this.frames = (this.frames || 0) + 1;

    // تنظیم خودکار کیفیت بر اساس فریم‌ریت واقعی
    if (now - (this.fpsT0 || (this.fpsT0 = now)) > 3600) {
      const fps = (this.frames * 1000) / (now - this.fpsT0);
      this.frames = 0;
      this.fpsT0 = now;
      if (fps < 21 && this.quality === "high") {
        this.quality = "lite";
        this.el.stage.classList.add("lite");
        this.stage.buildEnv();
        this.tracker.segmenter = null;
        this.cfg.features.hairLayer = false;
        this.hint(t(this.cfg.lang, "liteOn"), true);
      }
    }
    if (now - (this.lastDraw || 0) < 1000 / (this.quality === "lite" ? 24 : 30)) return;
    this.lastDraw = now;

    this.ctx.cv.drawImage(v, 0, 0, this.el.cv.width, this.el.cv.height);
    const pose = tr.process(now, now - (this.lastInfer || 0) > 240);
    if (pose) {
      this.pose = pose;
      if (now - (this.lastInfer || 0) > 700 && this.cfg.features.lightMatch) {
        this.lastInfer = now;
        this.stage.matchLight(this.el.cv);
      }
      this.stage.place(pose);
      this.stage.render();
      if (this.cfg.features.contactShadow) {
        const c = this.ctx.sh;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, this.el.sh.width, this.el.sh.height);
        this.stage.drawContactShadow(c, pose, { opacity: this.quality === "lite" ? 0.26 : 0.34, blur: this.quality === "lite" ? 4 : 6.5 });
      }
      this.collect(pose);
      this.maybeHint(pose);
    } else {
      this.stage.hide();
      this.stage.renderer.clear();
      this.ctx.sh.clearRect(0, 0, this.el.sh.width, this.el.sh.height);
      this.setStatus("search", t(this.cfg.lang, "looking"));
    }
    if (pose) this.setStatus("live", t(this.cfg.lang, "live"));

    if (this.cfg.features.hairLayer && tr.segmenter && now - (this.lastSeg || 0) > (this.quality === "lite" ? 260 : 130)) {
      this.lastSeg = now;
      // ماسک مو در بوم جدا؛ روی لایهٔ oc پیکسل‌های واقعی مو از ویدیو کشیده می‌شود (نه لکهٔ سفید)
      this.hairCv = this.hairCv || document.createElement("canvas");
      if (tr.segmentHair(this.hairCv)) this.stage.drawHairLayer(this.ctx.oc, this.hairCv);
      else this.ctx.oc.clearRect(0, 0, this.el.oc.width, this.el.oc.height);
    }
    this.scan.draw(pose);
  }

  maybeHint(pose) {
    const h = pose.quality?.hint;
    if (!h) return;
    const map = {
      closer: t(this.cfg.lang, "hintCloser"),
      frontal: t(this.cfg.lang, "hintFrontal"),
      level: t(this.cfg.lang, "hintLevel"),
      down: t(this.cfg.lang, "hintDown"),
    };
    this.hint(map[h] || "");
  }

  /** تجمیع نمونه‌ها برای فیت و شکل صورت */
  collect(pose) {
    this.samples = this.samples || [];
    if (!this.scanner.active) {
      this.samples.push({
        pd: pose.pdMm,
        faceW: pose.faceWmm,
        faceH: pose.faceHmm,
        nose: pose.noseWmm,
        frontal: pose.quality.frontal,
        t: performance.now(),
      });
      if (this.samples.length > 90) this.samples.shift();
      const fresh = this.samples.filter((s) => performance.now() - s.t < 6000);
      if (fresh.length > 8) {
        const rows = fitReport(this.product, { ...pose, ...avg(fresh, ["faceW", "faceH", "nose"]) }, this.spec);
        const sum = rows.map((r) => r.status);
        const txt = sum.every((s) => s === "good")
          ? t(this.cfg.lang, "fitGreat")
          : sum.includes("warn")
            ? t(this.cfg.lang, "fitCheck")
            : t(this.cfg.lang, "fitOff");
        if (txt !== this.fitSummary) {
          this.fitSummary = txt;
          this.renderMeta();
          this.emit("fit", { rows, pd: pose.pdMm, faceW: fresh.length && avg(fresh, ["faceW"]).faceW });
          this.fitRows = rows;
        }
      }
    } else {
      const px = {};
      for (const i of [10, 152, 234, 454, 172, 397, 21, 251, 33, 263, 127, 356]) px[i] = pose.landmarkPx?.(i) || pose.landmarks[i];
      // لندمارک نرمالایز → پیکسل
      const P = {};
      for (const k in px) P[k] = { x: px[k].x ?? px[k].x, y: px[k].y ?? px[k].y };
      const res = this.scanner.push(P);
      this.scanProgress = res?.progress || 0;
      if (res?.done) {
        this.scan.stop();
        this.faceShape = res;
        this.renderShapeResult(res);
        this.emit("faceshape", res);
      }
    }
  }

  renderShapeResult(res) {
    const info = SHAPE_COPY[res.shape];
    const box = this.$("shapeBox");
    if (!box || !info) return;
    const list = recommend(this.products, res.shape, {}).slice(0, 4);
    this.recommended = list.map((p) => String(p.id));
    box.innerHTML = `<div class="field"><label><span>${esc(t(this.cfg.lang, "yourFace"))}: ${esc(info.label)}</span><b>${res.confidence}%</b></label>
      <p class="lead" style="margin:6px 0 0">${esc(info.advice)}</p></div>
      <div class="rail" id="recRail">${list
        .map(
          (p) =>
            `<button class="card rec" data-pick="${p.id}" style="width:86px"><em>${esc(p.name)}</em></button>`,
        )
        .join("")}</div>`;
    box.querySelectorAll("[data-pick]").forEach((b) => {
      b.addEventListener("click", () => {
        const i = this.products.findIndex((p) => String(p.id) === b.dataset.pick);
        if (i >= 0) this.select(i);
        this.openSheet(true);
      });
    });
    this.cards?.forEach((c, i) => c.classList.toggle("rec", this.recommended.includes(String(this.products[i].id))));
    this.hint(t(this.cfg.lang, "shapeDone") + " · " + info.label, true);
  }

  /* ─────────────────────────── تعامل ────────────────────────────── */
  bindUI() {
    this.$("start").addEventListener("click", () => {
      this.$("start").disabled = true;
      this.$("start").textContent = t(this.cfg.lang, "starting");
      this.boot().catch(() => {});
    });
    // inline: با اولین نشانهٔ قصد (هاور/لمس/فوکوس روی کارت شروع) مدل در پس‌زمینه بار می‌شود
    const intent = () => this.prewarm()?.catch(() => {});
    for (const ev of ["pointerenter", "touchstart", "focusin"]) this.el.gate.addEventListener(ev, intent, { once: true, passive: true });
    this.$("close")?.addEventListener("click", () => this.close());
    this.$("openFit").addEventListener("click", () => this.openSheet());
    this.$("sheetClose").addEventListener("click", () => this.openSheet(false));
    this.$("scanBtn").addEventListener("click", () => this.runFaceScan());
    this.el.actions.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (b) this.action(b.dataset.a);
    });
    this.el.rail.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? (this.dir === "rtl" ? -1 : 1) : e.key === "ArrowLeft" ? (this.dir === "rtl" ? 1 : -1) : 0;
      if (!d) return;
      e.preventDefault();
      this.select(Math.max(0, Math.min(this.products.length - 1, this.byIndex + d)));
      this.cards[this.byIndex].scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.state === "live" && (this.paused = true);
      else if (this.paused && this.booted) {
        this.paused = false;
        this.state = "live";
      }
    });
    window.addEventListener("keydown", (e) => e.key === "Escape" && this.cfg.mode === "overlay" && this.close());
    this.dir = this.getAttribute("dir") || "ltr";
  }

  action(name) {
    const L = (k) => t(this.cfg.lang, k);
    if (name === "snap") return this.snapshot();
    if (name === "cart") return this.addToCart();
    if (name === "scan") return this.runFaceScan();
    if (name === "photo") return this.pickPhoto();
    if (name === "fit") return this.openSheet();
    void L;
  }

  openSheet(force) {
    const s = this.el.sheet;
    const open = force !== undefined ? force : !s.classList.contains("open");
    s.classList.toggle("open", open);
    this.$("openFit").setAttribute("aria-expanded", String(open));
    if (open) this.renderFitSheet();
  }

  renderFitSheet() {
    const rows = this.fitRows || (this.pose && fitReport(this.product, this.pose, this.spec)) || [];
    const box = this.$("fitRows");
    box.innerHTML = rows.length
      ? rows
          .map(
            (r) => `<div class="fitrow"><b>${esc(r.label)}</b><span class="tag" data-status="${r.status}">${
              r.status === "good" ? t(this.cfg.lang, "good") : r.status === "warn" ? t(this.cfg.lang, "warn") : t(this.cfg.lang, "bad")
            }</span><span>${esc(r.value)} — ${esc(r.hint)}</span></div>`,
          )
          .join("")
      : `<div class="fitrow"><span>${esc(t(this.cfg.lang, "fitNeedCamera"))}</span></div>`;
    const pd = this.$("pdBox");
    if (this.cfg.features.pd && !pd.dataset.built) {
      pd.dataset.built = "1";
      pd.innerHTML = `<div class="field"><label for="pdIn">${esc(t(this.cfg.lang, "pdTitle"))}<b id="pdVal"></b></label>
        <input class="num" id="pdIn" type="number" inputmode="decimal" min="45" max="80" step="0.5">
        <label class="switch"><span>${esc(t(this.cfg.lang, "pdAuto"))}<small>${esc(t(this.cfg.lang, "pdAutoHint"))}</small></span>
        <input type="checkbox" id="pdAuto"><i></i></label></div>`;
      const inp = pd.querySelector("#pdIn"),
        auto = pd.querySelector("#pdAuto");
      const sync = () => {
        const v = this.tracker?.pdMm || this.cfg.tracking.pd;
        inp.value = String(v);
        pd.querySelector("#pdVal").textContent = v.toFixed(1) + " mm";
        auto.checked = !this.tracker || this.tracker.autoPd;
        inp.disabled = auto.checked;
      };
      inp.addEventListener("input", () => {
        const v = Math.max(45, Math.min(80, +inp.value || 63));
        if (this.tracker) {
          this.tracker.autoPd = false;
          this.tracker.pdMm = v;
          this.tracker.pdLocked = true;
        }
        this.cfg.tracking.pd = v;
        pd.querySelector("#pdVal").textContent = v.toFixed(1) + " mm";
        sync();
      });
      auto.addEventListener("change", () => {
        if (this.tracker) {
          this.tracker.autoPd = auto.checked;
          if (auto.checked) {
            this.tracker.pdSamples = [];
            this.tracker.pdLocked = false;
          }
        }
        sync();
      });
      this.pdSync = sync;
      sync();
    } else this.pdSync?.();
  }

  runFaceScan() {
    if (!this.pose) return this.hint(t(this.cfg.lang, "needCamera"), true);
    this.scanner.start();
    this.scan.start(3200);
    this.el.stage.classList.add("scanning");
    this.openSheet(true);
    const box = this.$("shapeBox");
    if (box) box.innerHTML = `<div class="field"><label>${esc(t(this.cfg.lang, "scanning"))}<b id="scanPct">0%</b></label></div>`;
    const tick = setInterval(() => {
      const p = box?.querySelector("#scanPct");
      if (p) p.textContent = Math.round((this.scanProgress || 0) * 100) + "%";
      if (!this.scanner.active) {
        clearInterval(tick);
        this.el.stage.classList.remove("scanning");
      }
    }, 120);
    setTimeout(() => {
      clearInterval(tick);
      if (this.scanner.active) {
        this.scanner.active = false;
        this.scan.stop();
        this.el.stage.classList.remove("scanning");
        if (box && !this.faceShape)
          box.innerHTML = `<div class="err">${esc(t(this.cfg.lang, "scanFail"))}</div>`;
      }
    }, 9000);
  }

  /* ─────────────────────────── عکس و خرید ───────────────────────── */
  async snapshot() {
    const v = this.tracker?.video;
    if (!v?.videoWidth) return this.hint(t(this.cfg.lang, "needCamera"), true);
    const W = this.el.cv.width,
      H = this.el.cv.height;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const x = out.getContext("2d");
    x.fillStyle = "#05070a";
    x.fillRect(0, 0, W, H);
    for (const src of [this.el.cv, this.el.sh, this.el.gl, this.el.oc]) {
      x.save();
      x.translate(W, 0);
      x.scale(-1, 1);
      x.drawImage(src, 0, 0, W, H);
      x.restore();
    }
    if (this.cfg.watermark) {
      x.font = `600 ${Math.round(H * 0.022)}px ${getComputedStyle(this).fontFamily || "sans-serif"}`;
      x.textAlign = "right";
      x.shadowColor = "rgba(0,0,0,.75)";
      x.shadowBlur = 10;
      x.fillStyle = "#fff";
      const name = this.product?.name || "";
      x.fillText(`${this.cfg.brand.name || ""}${name ? " · " + name : ""}`, W - H * 0.03, H - H * 0.035);
    }
    const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.92));
    const file = new File([blob], "tryon.jpg", { type: "image/jpeg" });
    this.emit("snapshot", { blob, file, product: this.product });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${this.cfg.brand.name} — ${name}` });
        return;
      }
    } catch (e) {
      /* کاربر لغو کرد */
    }
    const a = document.createElement("a");
    a.download = "tryon.jpg";
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async pickPhoto() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const img = new Image();
      img.onload = async () => {
        const url = img.src;
        this.THREE = this.THREE || THREE;
        if (!this.tracker) {
          const base = this.cfg.baseURL || new URL(".", document.baseURI).href.replace(/\/$/, "");
          this.tracker = new FaceTracker({ baseURL: base, ...this.cfg.tracking, log: () => {} });
          await this.tracker.init();
        }
        this.stage =
          this.stage ||
          new Stage({ canvas: this.el.gl, THREE: this.THREE, quality: "high", video: img, env: true });
        this.tracker.photoMode = true;
        const r = await this.tracker.processImage(img);
        if (!r) return this.hint(t(this.cfg.lang, "noFaceInPhoto"), true);
        this.el.cv.width = r.canvas.width;
        this.el.cv.height = r.canvas.height;
        for (const c of [this.el.gl, this.el.oc, this.el.sh, this.el.mesh]) {
          c.width = r.canvas.width;
          c.height = r.canvas.height;
        }
        this.ctx.cv.drawImage(img, 0, 0);
        this.stage.buildEnv();
        this.stage.setProduct({ ...this.product, ...(this.variants?.[this.variant] || {}) }, { quality: "high" });
        this.stage.resize(r.canvas.width, r.canvas.height);
        this.stage.place(r.pose);
        this.stage.render();
        this.pose = r.pose;
        this.el.gate.hidden = true;
        this.hint(t(this.cfg.lang, "photoOk"), true);
        void url;
      };
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  }

  addToCart() {
    const p = { ...this.product, ...(this.variants?.[this.variant] || {}) };
    const item = {
      id: p.id,
      sku: p.sku || p.id,
      name: p.name,
      color: this.variants?.[this.variant]?.name,
      price: p.price,
      size: p.size,
      url: p.url,
      variant: this.variants?.[this.variant],
    };
    this.emit("cart", item);
    const mode = this.cfg.cart.mode;
    if (mode === "whatsapp" && this.cfg.brand.whatsapp) {
      const txt = t(this.cfg.lang, "waText", {
        name: p.name,
        color: item.color ? ` ${t(this.cfg.lang, "inColor")} ${item.color}` : "",
        price: p.price ? ` ${p.price ? new Intl.NumberFormat(this.lang === "fa" ? "fa-IR" : "en-US").format(p.price) : ""} ${p.currency || t(this.cfg.lang, "toman")}` : "",
      });
      open(`https://wa.me/${this.cfg.brand.whatsapp}?text=${encodeURIComponent(txt)}`, "_blank");
    } else if (mode === "link" && p.url && typeof window !== "undefined") window.location.href = p.url;
    else if (this.cfg.cart.add) this.cfg.cart.add(item);
    else this.toast(t(this.cfg.lang, "cartAdded", { name: p.name }));
  }

  toast(msg) {
    const d = document.createElement("div");
    d.className = "vt-toast";
    d.textContent = msg;
    this.el.stage.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }

  /* ─────────────────────────── API ──────────────────────────────── */
  open() {
    if (this.cfg.mode !== "overlay") return;
    this.hidden = false;
    document.documentElement.style.setProperty("overflow", "hidden", "important");
    this.el.gate.hidden = this.booted;
    if (!this.booted) {
      this.$("start").focus?.();
      this.prewarm()?.catch(() => {}); // مشتری قصدش را نشان داده؛ مدل را از حالا بیاور
    } else if (this.state === "paused") this.resume();
  }
  async resume() {
    try {
      if (!this.tracker.stream) await this.tracker.startCamera({ light: this.quality === "lite" });
      this.syncSize();
      this.state = "live";
      this.setStatus("live", t(this.cfg.lang, "live"));
    } catch (e) {
      this.setStatus("error", t(this.cfg.lang, "cameraBlocked"));
      this.emit("error", { where: "resume", message: String(e?.message || e), name: e?.name });
    }
  }
  close() {
    this.hidden = true;
    document.documentElement.style.removeProperty("overflow");
    if (this.booted && this.tracker) {
      this.tracker.stopCamera(); // چراغ دوربین خاموش شود؛ با open() دوباره روشن می‌شود
      this.state = "paused";
    } else this.state = "idle";
  }
  setProducts(list) {
    this.cfg.products = list;
    this.loadProducts();
  }
  selectProduct(id) {
    const i = this.products?.findIndex((p) => String(p.id) === String(id));
    if (i >= 0) this.select(i);
  }
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent("tryon:" + name, { detail, bubbles: true, composed: true }));
    (this.listeners.get(name) || []).forEach((f) => f(detail));
  }
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const a = this.listeners.get(name) || [];
    this.listeners.set(name, a.filter((f) => f !== fn));
  }
  disconnectedCallback() {
    this.dead = true;
    this.onResize && window.removeEventListener("resize", this.onResize);
    this.mountListener && this.mountBtn?.removeEventListener("click", this.mountListener);
    this.tracker?.dispose();
    this.stage?.dispose();
  }
}

/* ── ابزارها ── */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function lighten(hex, amt) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  let v = m[1];
  if (v.length === 3) v = v.split("").map((c) => c + c).join("");
  const n = parseInt(v, 16);
  const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amt);
  const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amt);
  const b = Math.round((n & 255) + (255 - (n & 255)) * amt);
  return `rgb(${r},${g},${b})`;
}
function avg(list, keys) {
  const out = {};
  for (const k of keys) out[k] = list.reduce((s, i) => s + (i[k] || 0), 0) / (list.length || 1);
  return out;
}
/** #f=AR-101 / #f=3 / ?f=3 — همان قالبی که نسخهٔ قدیمی استفاده می‌کرد */
function deepLinkId() {
  try {
    if (typeof location === "undefined") return null;
    const h = (location.hash || "").match(/[#&]f=([\w.:-]+)/);
    if (h) return h[1];
    const q = new URLSearchParams(location.search || "").get("f");
    return q && /^[\w.:-]+$/.test(q) ? q : null;
  } catch (e) {
    return null;
  }
}

function structuredCloneSafe(o) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(o);
    } catch (e) {}
  }
  return JSON.parse(JSON.stringify(o));
}
function deepMerge(a, b) {
  for (const k in b) {
    const v = b[k];
    if (v === undefined) continue;
    const isPlain = v !== null && typeof v === "object" && !Array.isArray(v) && (v.constructor === Object || Object.getPrototypeOf(v) === null);
    if (isPlain && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) deepMerge(a[k], v);
    else a[k] = Array.isArray(v) ? v.slice() : v;
  }
  return a;
}

if (typeof customElements !== "undefined" && !customElements.get("virtual-tryon"))
  customElements.define("virtual-tryon", VirtualTryOn);
export { VirtualTryOn as TryOnElement };
