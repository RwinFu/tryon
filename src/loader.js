/**
 * loader.js → dist/tryon-loader.js  (~۲KB)
 *
 * موتور اصلی (dist/tryon.js ≈ ۲۳۸KB gzip، شامل three.js) روی صفحهٔ محصول بار نمی‌شود مگر لازم شود:
 *  - دکمهٔ [data-tryon-open]: با اولین کلیک بار می‌شود (روی دکمه حالت «در حال بارگذاری») و همان کلیک بازپخش می‌شود
 *  - اسلات [data-tryon] (inline): وقتی به دید کاربر نزدیک شد
 *  - در بیکاری مرورگر فقط prefetch می‌شود تا اولین کلیک آنی باشد
 *
 *   <script src="/tryon/dist/tryon-loader.js" data-tryon-products="/tryon/products.json" defer></script>
 *   <button class="tryon-btn" data-tryon-open data-tryon-sku="AR-104">پرو مجازی</button>
 *
 * همهٔ data-tryon-* روی همین تگ، عیناً به موتور اصلی می‌رسد. window.TryOnLoader.load() → Promise<TryOn>
 */
import { injectEmbedCss } from "./ui/embed-css.js";

(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.TryOnLoader) return;
  const me = document.currentScript;
  const customSrc = me && me.getAttribute("data-tryon-src");
  const src = customSrc
    ? new URL(customSrc, me.src || document.baseURI).href
    : me && me.src
      ? new URL("tryon.js", me.src).href
      : new URL("tryon.js", document.baseURI).href;
  let loading = null;

  injectEmbedCss(document);
  if (me && me.getAttribute("data-tryon-accent"))
    document.documentElement.style.setProperty("--tryon-accent", me.getAttribute("data-tryon-accent"));

  function load() {
    if (window.TryOn) return Promise.resolve(window.TryOn);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      // پیکربندی (data-tryon-*) از تگ لودر روی اسکریپت اصلی کپی می‌شود تا همان readScriptConfig آن را بخواند
      if (me) for (const a of Array.from(me.attributes)) if (a.name.indexOf("data-tryon") === 0) s.setAttribute(a.name, a.value);
      s.onload = () => {
        if (!window.TryOn) {
          loading = null;
          s.remove();
          return reject(new Error("TryOn در " + src + " پیدا نشد"));
        }
        document.dispatchEvent(new CustomEvent("tryon:loaded", { detail: window.TryOn }));
        resolve(window.TryOn);
      };
      s.onerror = () => {
        loading = null;
        reject(new Error("بارگذاری ناموفق: " + src));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function clearButtonStatus(btn) {
    btn.__tryonStatus?.remove();
    btn.__tryonStatus = null;
  }

  function showButtonStatus(btn, message) {
    if (!btn.__tryonStatus) {
      const status = document.createElement("span");
      status.className = "tryon-loader-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      btn.insertAdjacentElement("afterend", status);
      btn.__tryonStatus = status;
    }
    btn.__tryonStatus.textContent = message;
  }

  // ── دکمه‌ها: تا پایان بارگذاری، کلیک اول را نگه می‌دارد و سپس بازپخش می‌کند.
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-tryon-open]") : null;
      if (!btn || window.TryOn) return;
      if (btn.__tryonLoading) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      btn.__tryonLoading = true;
      btn.classList.add("tryon-loading");
      btn.setAttribute("aria-busy", "true");
      clearButtonStatus(btn);
      load()
        .then((T) => {
          if (!btn.isConnected) return;
          T.autoEmbed(document); // دکمه‌های فروشگاه ممکن است بعد از بارگذاری HTML ساخته شده باشند.
          btn.classList.remove("tryon-loading");
          btn.removeAttribute("aria-busy");
          btn.__tryonLoading = false;
          btn.click(); // اکنون handler تفویض‌شدهٔ افزونه دکمه را می‌گیرد.
        })
        .catch((err) => {
          btn.classList.remove("tryon-loading");
          btn.removeAttribute("aria-busy");
          btn.__tryonLoading = false;
          showButtonStatus(btn, "پرو مجازی بارگیری نشد؛ برای تلاش دوباره دکمه را بزنید.");
          console.error("[TryOn]", err);
        });
    },
    true,
  );

  // ── اسلات‌های inline: نزدیک دید → بار شود
  function scanHosts() {
    const hosts = document.querySelectorAll("[data-tryon]");
    if (!hosts.length) return;
    if (!("IntersectionObserver" in window)) return void load();
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: "600px" },
    );
    hosts.forEach((h) => io.observe(h));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scanHosts, { once: true });
  else scanHosts();

  // ── prefetch در بیکاری: اولین کلیک بدون انتظار دانلود
  const mode = (me && me.getAttribute("data-tryon-preload")) || "prefetch";
  if (mode !== "none") {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 2500));
    idle(() => {
      if (window.TryOn || loading) return;
      if (mode === "eager") return void load();
      const l = document.createElement("link");
      l.rel = "prefetch";
      l.as = "script";
      l.href = src;
      document.head.appendChild(l);
    });
  }

  window.TryOnLoader = { load, src, version: __VT_VERSION__ };
})();
