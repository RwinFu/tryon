/* تعاملات فروشگاه نمونه: کاتالوگ، فیلتر، دکمه‌های پرو و نمایش اندازه‌گیری زنده */
const grid = document.getElementById("grid");
const searchInput = document.getElementById("productSearch");
const filters = document.getElementById("frameFilters");
const countLabel = document.getElementById("productCount");
const number = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
let catalog = [];
let activeMaterial = "all";

const framePaths = {
  round: '<circle cx="45" cy="39" r="24"/><circle cx="135" cy="39" r="24"/>',
  roundmetal: '<circle cx="45" cy="39" r="24"/><circle cx="135" cy="39" r="24"/>',
  oval: '<ellipse cx="45" cy="39" rx="29" ry="21"/><ellipse cx="135" cy="39" rx="29" ry="21"/>',
  cateye: '<path d="M17 32q28-25 57-7l-6 28q-7 13-24 11-21-2-27-18l-5-12 5-2Z"/><path d="M163 32q-28-25-57-7l6 28q7 13 24 11 21-2 27-18l5-12-5-2Z"/>',
  aviator: '<path d="M16 18h59l-4 31q-4 23-26 23T18 49l-2-31Z"/><path d="M164 18h-59l4 31q4 23 26 23t27-23l2-31Z"/>',
  rectangle: '<rect x="12" y="20" width="65" height="38" rx="11"/><rect x="103" y="20" width="65" height="38" rx="11"/>',
  square: '<path d="M24 16h41q13 0 13 13v18q0 13-13 13H25q-13 0-13-13V29q0-13 12-13Z"/><path d="M156 16h-41q-13 0-13 13v18q0 13 13 13h40q13 0 13-13V29q0-13-12-13Z"/>',
  panto: '<path d="M15 22q29-13 61 0v20q-2 23-29 23-29 0-32-23V22Z"/><path d="M165 22q-29-13-61 0v20q2 23 29 23 29 0 32-23V22Z"/>',
  browline: '<path d="M13 29q32-23 65-5v20q-3 19-29 19-29 0-34-21l-2-13Z"/><path d="M167 29q-32-23-65-5v20q3 19 29 19 29 0 34-21l2-13Z"/>',
  octagon: '<path d="m22 17 42 0 14 14-4 26-13 12-41-3-9-12V29l11-12Z"/><path d="m158 17-42 0-14 14 4 26 13 12 41-3 9-12V29l-11-12Z"/>',
  geometric: '<path d="m21 18 48-2 10 14-7 27-14 12-41-6-8-16 12-29Z"/><path d="m159 18-48-2-10 14 7 27 14 12 41-6 8-16-12-29Z"/>',
  oversize: '<path d="M8 15h63q10 0 10 11v25q0 12-12 15H23Q9 64 7 49l-2-22q0-12 3-12Z"/><path d="M172 15h-63q-10 0-10 11v25q0 12 12 15h46q14-2 16-17l2-22q0-12-3-12Z"/>',
  butterfly: '<path d="M13 24q27-25 63-5l7 18q-5 23-31 24-31 0-39-19l-7-18 7 0Z"/><path d="M167 24q-27-25-63-5l-7 18q5 23 31 24 31 0 39-19l7-18-7 0Z"/>',
  shield: '<path d="M8 20q37-10 78 0l-5 23q-7 25-35 25T12 43L8 20Z"/><path d="M172 20q-37-10-78 0l5 23q7 25 35 25t34-25l4-23Z"/>',
};

function icon(shape) {
  const paths = framePaths[shape] || framePaths.square;
  return `<svg viewBox="0 0 180 82" role="img" aria-label="نمای فریم عینک" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><g>${paths}<path d="M77 31q13-9 26 0" fill="none" stroke-width="2.4"/><path d="M11 30 3 24m166 6 8-6" fill="none" stroke-width="2.4"/></g></svg>`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function safeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#353a3c";
}

function materialLabel(material) {
  return ({ acetate: "استات", metal: "فلزی", titanium: "تیتانیوم" })[material] || "فریم";
}

function priceLabel(price) {
  const amount = Number(price);
  return Number.isFinite(amount) && amount > 0 ? `${money.format(amount)} تومان` : "";
}

function renderCards(items) {
  if (!grid) return;
  grid.setAttribute("aria-busy", "false");
  if (!items.length) {
    grid.innerHTML = '<div class="catalogMessage">برای این جست‌وجو فریمی پیدا نشد. فیلترها را پاک کن یا عبارت دیگری بنویس.</div>';
    return;
  }

  grid.innerHTML = items
    .map((product, index) => {
      const id = String(product.id || product.sku || `frame-${index + 1}`);
      const sku = String(product.sku || product.id || id);
      const colors = Array.isArray(product.colors) ? product.colors.slice(0, 4) : [];
      const swatches = colors
        .map((color) => `<i style="background:${safeColor(color.color)}" title="${escapeHTML(color.name || "رنگ فریم")}" aria-hidden="true"></i>`)
        .join("");
      const size = String(product.size || "").replace(/[^0-9□×\-. ]/g, "");
      const escapedId = escapeHTML(id);
      const escapedName = escapeHTML(product.name || id);
      return `<article class="pcard" data-material="${escapeHTML(product.material || "")}">
        <div class="pcardTop"><span>${escapedId}</span><span class="material">${materialLabel(product.material)}</span></div>
        <div class="shot">${icon(product.shape)}</div>
        <h3>${escapedName}</h3>
        <div class="pcardMeta"><span class="size">${escapeHTML(size || "سایز ثبت نشده")}</span><span class="price">${priceLabel(product.price)}</span></div>
        <div class="productFoot">
          ${swatches ? `<span class="swatches" aria-label="${colors.length} رنگ موجود">${swatches}</span>` : ""}
          <button class="tryon-btn" type="button" data-tryon-open data-tryon-sku="${escapeHTML(sku)}" aria-label="پرو مجازی ${escapedName}">پرو مجازی</button>
        </div>
      </article>`;
    })
    .join("");
}

function applyFilters() {
  const query = (searchInput?.value || "").trim().toLocaleLowerCase("fa-IR");
  const filtered = catalog.filter((product) => {
    const materialOK = activeMaterial === "all" || product.material === activeMaterial;
    const haystack = `${product.name || ""} ${product.id || ""} ${product.sku || ""}`.toLocaleLowerCase("fa-IR");
    return materialOK && (!query || haystack.includes(query));
  });
  renderCards(filtered);
  if (countLabel) countLabel.textContent = `${number.format(filtered.length)} از ${number.format(catalog.length)} فریم`;
}

async function loadCatalog() {
  if (!grid) return;
  try {
    const scriptURL = document.currentScript?.src || new URL("./site/shop.js", location.href).href;
    const catalogURL = new URL("../products.json", scriptURL);
    const response = await fetch(catalogURL, { headers: { accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const products = Array.isArray(data) ? data : data.products || data.items;
    if (!Array.isArray(products) || !products.length) throw new Error("کاتالوگ خالی است");
    catalog = products;
    applyFilters();
  } catch (error) {
    grid.setAttribute("aria-busy", "false");
    grid.innerHTML = '<div class="catalogMessage error">کاتالوگ بارگذاری نشد. آدرس products.json را بررسی و صفحه را دوباره بارگیری کن.</div>';
    if (countLabel) countLabel.textContent = "خطا در کاتالوگ";
    console.error("[TryOn demo] catalog:", error);
  }
}

searchInput?.addEventListener("input", applyFilters);
filters?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-material]");
  if (!button) return;
  activeMaterial = button.dataset.material || "all";
  filters.querySelectorAll("[data-material]").forEach((filter) => {
    const selected = filter === button;
    filter.classList.toggle("is-active", selected);
    filter.setAttribute("aria-pressed", String(selected));
  });
  applyFilters();
});

// اندازه‌های محلیِ دریافتی از افزونه؛ با — شروع می‌شود و فقط بعد از پرو پر می‌شود.
document.addEventListener("tryon:fit", (event) => {
  const data = event.detail || {};
  const setMeasurement = (id, value) => {
    const element = document.getElementById(id);
    if (!element?.firstChild) return;
    const numeric = Number(value);
    element.firstChild.textContent = Number.isFinite(numeric) && numeric > 0 ? number.format(numeric) : "—";
  };
  setMeasurement("mPd", data.pd);
  setMeasurement("mFace", data.faceW);
  setMeasurement("mBridge", data.nose);
  setMeasurement("mHeight", data.faceH);

  const statuses = (data.rows || []).map((row) => row.status);
  const status = document.getElementById("fitStatus");
  const message = document.getElementById("fitMessage");
  if (!status || !message || !statuses.length) return;
  if (statuses.every((value) => value === "good")) {
    status.textContent = "مناسب";
    status.className = "chip";
    message.textContent = "اندازه‌های این فریم با صورتت هم‌خوانی خوبی دارد. برای تصمیم نهایی، فریم را حضوری هم امتحان کن.";
  } else if (statuses.includes("bad")) {
    status.textContent = "نیاز به بررسی";
    status.className = "chip bad";
    message.textContent = "یک یا چند اندازه با صورتت فاصله دارد؛ جزئیات را در برگهٔ فیت داخل پرو ببین.";
  } else {
    status.textContent = "بررسی فیت";
    status.className = "chip warn";
    message.textContent = "یک اندازه نیاز به توجه دارد؛ جزئیات بیشتر در برگهٔ فیت داخل پرو نمایش داده می‌شود.";
  }
});

// منوی کوچک موبایل: قابل استفاده با لمس، صفحه‌کلید و کلیک بیرون.
const menuToggle = document.getElementById("menuToggle");
const primaryNav = document.getElementById("primaryNav");
function closeMenu() {
  if (!menuToggle || !primaryNav) return;
  menuToggle.setAttribute("aria-expanded", "false");
  primaryNav.classList.remove("is-open");
}
menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  primaryNav?.classList.toggle("is-open", open);
});
primaryNav?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("click", (event) => {
  if (primaryNav?.classList.contains("is-open") && !primaryNav.contains(event.target) && !menuToggle?.contains(event.target)) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 760) closeMenu();
}, { passive: true });

void loadCatalog();
