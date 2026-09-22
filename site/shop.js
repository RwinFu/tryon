/* صفحهٔ نمونهٔ فروشگاه: کارت محصولات + اتصال اعداد فیت به بخش «فیت هوشمند» */
const grid = document.getElementById("grid");
const fmt = new Intl.NumberFormat("fa-IR");

async function loadCatalog() {
  try {
    const r = await fetch("./products.json");
    const data = await r.json();
    return data.products || data;
  } catch (e) {
    return null;
  }
}

function icon(shape) {
  const s = {
    round: '<circle cx="16" cy="14" r="10"/><circle cx="52" cy="14" r="10"/>',
    cateye: '<ellipse cx="16" cy="14" rx="12" ry="8" transform="rotate(-9 16 14)"/><ellipse cx="52" cy="14" rx="12" ry="8" transform="rotate(9 52 14)"/>',
    aviator: '<path d="M5 8h22c0 9-4 15-11 15S5 17 5 8z"/><path d="M39 8h22c0 9-4 15-11 15s-11-6-11-15z"/>',
    rectangle: '<rect x="3" y="7" width="26" height="14" rx="4"/><rect x="39" y="7" width="26" height="14" rx="4"/>',
    square: '<rect x="4" y="5" width="24" height="18" rx="6"/><rect x="40" y="5" width="24" height="18" rx="6"/>',
  };
  return `<svg viewBox="0 0 68 28" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">${
    s[shape] || s.square
  }<path d="M30 12h8" stroke-width="2"/></svg>`;
}

document.addEventListener("tryon:ready", () => document.querySelectorAll(".heroStage .loading").forEach((n) => n.remove()));

(async () => {
  const items = (await loadCatalog()) || [];
  if (!grid) return;
  grid.innerHTML = items
    .slice(0, 8)
    .map(
      (p) => `<article class="pcard">
        <div class="shot" data-shot="${p.id}">${icon(p.shape)}</div>
        <h3>${p.name}</h3>
        <div class="meta">
          <span class="size">${(p.size || "").replace(/[^0-9□×\-. ]/g, "")}</span>
          <span class="price">${p.price ? fmt.format(p.price) + " تومان" : "استعلام قیمت"}</span>
        </div>
        <div class="foot">
          <button data-tryon-open data-tryon-sku="${p.id}">پرو مجازی</button>
          <span class="sw">${(p.colors || [])
            .slice(0, 4)
            .map((c) => `<i style="background:${c.color || "#333"}" title="${c.name || ""}"></i>`)
            .join("")}</span>
        </div>
      </article>`,
    )
    .join("");

  // تامبنیل سه‌بعدی روی هر کارت (از همان هندسهٔ افزونه)
  const TryOn = window.TryOn;
  if (!TryOn?.renderThumbnails) return;
  try {
    const urls = await TryOn.renderThumbnails(items.slice(0, 8), { size: 420 });
    grid.querySelectorAll("[data-shot]").forEach((box, i) => {
      if (!urls[i]) return;
      const img = new Image();
      img.alt = items[i].name;
      img.src = urls[i];
      box.innerHTML = "";
      box.appendChild(img);
    });
  } catch (e) {
    /* آیکن برداری می‌ماند */
  }
})();

// اعداد فیتِ زنده از افزونه
document.addEventListener("tryon:fit", (e) => {
  const d = e.detail || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && v) el.firstChild.textContent = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(v);
  };
  set("mPd", d.pd);
  set("mFace", d.faceW);
  set("mBridge", d.nose);
});
