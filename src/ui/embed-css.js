/**
 * embed-css.js — تنها CSS سراسری افزونه: دکمهٔ آمادهٔ «پرو مجازی» (.tryon-btn)
 * هم لودر و هم باندل اصلی آن را یک بار تزریق می‌کنند (id="tryon-embed-css").
 * رنگ با --tryon-accent روی :root یا خودِ دکمه قابل تغییر است.
 */
const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 28" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><rect x="3" y="6" width="24" height="17" rx="7"/><rect x="37" y="6" width="24" height="17" rx="7"/><path d="M27 12h10M3 11L0 6M61 11l3-5"/></svg>',
  );

export const EMBED_CSS = `
.tryon-btn{display:inline-flex;align-items:center;justify-content:center;gap:.55em;padding:.66em 1.05em;border-radius:2px;border:1px solid var(--tryon-accent,#1c1916);background:var(--tryon-accent,#1c1916);color:var(--tryon-ink,#f7f4ee);font:inherit;font-weight:700;line-height:1.2;cursor:pointer;white-space:nowrap;text-decoration:none}
.tryon-btn::before{content:"";flex:0 0 auto;width:1.25em;height:1.25em;background:currentColor;-webkit-mask:url("${ICON}") center/contain no-repeat;mask:url("${ICON}") center/contain no-repeat}
.tryon-btn:hover{filter:brightness(1.08)}
.tryon-btn:active{filter:brightness(.94)}
.tryon-btn:focus-visible{outline:2px solid var(--tryon-accent,#1c1916);outline-offset:2px}
.tryon-btn.ghost{background:transparent;color:var(--tryon-accent,#1c1916)}
.tryon-btn.block{display:flex;width:100%}
.tryon-btn.tryon-loading,.tryon-btn[aria-busy="true"]{opacity:.72;cursor:progress;pointer-events:none}
.tryon-btn.tryon-loading::before,.tryon-btn[aria-busy="true"]::before{background:none;-webkit-mask:none;mask:none;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;box-sizing:border-box;animation:tryon-spin .8s linear infinite}
.tryon-loader-status{display:block;margin:.45em 0;color:#a33;font:500 12px/1.6 system-ui,sans-serif}
@keyframes tryon-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.tryon-btn{transition:none}.tryon-btn.tryon-loading::before{animation-duration:1.6s}}
`;

/** یک بار در <head> تزریق می‌شود؛ بی‌خطر در Node/SSR */
export function injectEmbedCss(doc) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d || !d.head || d.getElementById("tryon-embed-css")) return false;
  const s = d.createElement("style");
  s.id = "tryon-embed-css";
  s.textContent = EMBED_CSS;
  d.head.appendChild(s);
  return true;
}
