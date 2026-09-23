/**
 * studio.js — استودیوی فریم: «عکس محصول → مدل سه‌بعدی» و ساخت فریم جدید
 * بدون Blender؛ خروجی GLB + PNG + ورودیِ products.json.
 */
import * as THREE from "three";
import { buildFrame } from "../frame/geometry.js";
import { createFrameObject, clearFrameCache } from "../frame/index.js";
import { SHAPE_PRESETS, SHAPE_KEYS, lensOutline, resample, smoothPts } from "../frame/shapes.js";
import { CATALOG, toEngineSpec } from "../frame/catalog.js";
import { exportGLB } from "../frame/glb.js";
import { frameFromImage, guessShape } from "../frame/photogram.js";
import { buildStudioEnvironment } from "../frame/materials.js";

const $ = (s) => document.querySelector(s);
/* ابزارهای کوچک — بالای فایل، چون کدِ سطحِ ماژول (هنگام لود) از آن‌ها استفاده می‌کند
   (const در پایین فایل = Temporal Dead Zone = «Ec is not a function» و صفحهٔ سفید) */
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function fmt(v, u) {
  return v === undefined || v === null ? "—" : String(+Number(v).toFixed(2)) + (u ? " " + u : "");
}
function circlePath(rx, ry, n = 96) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: +(Math.cos(a) * rx).toFixed(2), y: +(Math.sin(a) * ry).toFixed(2) };
  });
}
const state = {
  spec: { ...toEngineSpec(CATALOG[0]), name: CATALOG[0].name },
  finish: CATALOG[0].finish || "polished-black",
  color: CATALOG[0].colors?.[0]?.color || "#22252b",
  metalColor: CATALOG[0].colors?.[0]?.metalColor || "#c9a45e",
  lens: CATALOG[0].lens || "clear",
  yaw: -0.5,
  pitch: 0.16,
  dist: 1.18,
  turn: true,
  bg: "#12161b",
  traced: null,
};

/* ── صحنه ─────────────────────────────────────────────────────────── */
const canvas = $("#view");
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.environment = buildStudioEnvironment(THREE, renderer, { warmth: 0.12 });
const camera = new THREE.PerspectiveCamera(24, 1, 1, 6000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x2d323a, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 1.05);
key.position.set(-1.6, 2.6, 3.4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbfd4ff, 0.35);
fill.position.set(2.4, 0.4, -1.6);
scene.add(fill);
const holder = new THREE.Group();
scene.add(holder);
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(260, 64),
  new THREE.MeshStandardMaterial({ color: 0x0d1013, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.75 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -78;
scene.add(ground);

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

let obj = null;
let rebuildReq = 0;
const currentProductSpec = () => ({ spec: effectiveSpec(), finish: state.finish, color: state.color, lens: state.lens, metalColor: state.metalColor });
/** بازسازی هندسه — چند رویداد اسلایدر در یک فریم، یک بار ساخته می‌شود (کشیدن اسلایدر روان می‌ماند) */
function rebuild() {
  if (rebuildReq) return;
  rebuildReq = requestAnimationFrame(() => {
    rebuildReq = 0;
    rebuildNow();
  });
}
function rebuildNow() {
  const product = currentProductSpec();
  const spec = product.spec;
  if (obj) {
    holder.remove(obj.group);
    obj.dispose();
  }
  clearFrameCache();
  obj = createFrameObject(THREE, product, { quality: "high", occluder: false, envIntensity: 1.15 });
  obj.group.traverse((o) => (o.matrixAutoUpdate = true));
  holder.add(obj.group);
  $("#triCount").textContent = new Intl.NumberFormat("en").format(obj.group.userData.meta.tris);
  $("#sizeOut").textContent = `${(spec.lensW ?? 0)}□${spec.dbn} ${spec.templeLen} · کل ${Math.round(2 * (spec.lensW || 52) + spec.dbn)}mm`;
}
/** فقط رنگ/عدسی: متریال عوض می‌شود، هندسه دست‌نخورده (پیش‌نمایش زندهٔ رنگ بدون مکث) */
function recolor() {
  if (!obj) return rebuild();
  obj.setVariant(currentProductSpec());
}
const effectiveSpec = () => ({ ...state.spec, ...(state.traced || {}) });

function frameCam() {
  if (!obj) return;
  const box = new THREE.Box3().setFromObject(holder);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const d = (sph.radius / Math.sin((camera.fov * Math.PI) / 360)) * state.dist;
  const { yaw, pitch } = state;
  camera.position.set(
    sph.center.x + Math.sin(yaw) * Math.cos(pitch) * d,
    sph.center.y + Math.sin(pitch) * d,
    sph.center.z + Math.cos(yaw) * Math.cos(pitch) * d,
  );
  camera.lookAt(sph.center);
  ground.position.y = box.min.y - 3;
}
renderer.setAnimationLoop((t) => {
  if (state.turn) state.yaw = -0.5 + Math.sin(t / 5200) * 0.72;
  frameCam();
  renderer.render(scene, camera);
});

/* ── کنترل‌ها ─────────────────────────────────────────────────────── */
const CONTROLS = [
  { g: "شکل و فرم" },
  { k: "shape", label: "قالب", type: "select", options: ["custom (از عکس)", ...SHAPE_KEYS] },
  { k: "lensW", label: "عرض عدسی", min: 38, max: 68, step: 0.5, unit: "mm" },
  { k: "lensH", label: "ارتفاع عدسی", min: 24, max: 62, step: 0.5, unit: "mm" },
  { k: "dbn", label: "پل (DBN)", min: 12, max: 26, step: 0.5, unit: "mm" },
  { k: "exp", label: "تیزی گوشه‌ها", min: 1.8, max: 12, step: 0.1, hint: "۲=گرد · ۵=مربعی" },
  { k: "depth", label: "نسبت ارتفاع/عرض", min: 0.5, max: 1.15, step: 0.01 },
  { k: "catAmp", label: "کشیدگی گربه‌ای", min: 0, max: 0.9, step: 0.01 },
  { k: "catWidth", label: "پهنای بال گربه‌ای", min: 0.1, max: 0.9, step: 0.01 },
  { k: "teardrop", label: "تِردراپ (خلبانی)", min: 0, max: 0.55, step: 0.01 },
  { k: "nasalNotch", label: "برش بینی", min: 0, max: 0.5, step: 0.01 },
  { k: "topWide", label: "پهنای بالای لنز", min: 0.85, max: 1.3, step: 0.01 },
  { k: "lensTiltDeg", label: "چرخش لنز", min: -14, max: 14, step: 0.5, unit: "°" },
  { g: "ساختار فریم" },
  { k: "style", label: "حلقه", type: "select", options: ["full", "half", "brow", "rimless"] },
  { k: "rimW", label: "عرض نوار فریم", min: 1.2, max: 8.5, step: 0.1, unit: "mm" },
  { k: "rimT", label: "ضخامت فریم", min: 1, max: 6.5, step: 0.1, unit: "mm" },
  { k: "bevel", label: "پخ/گِردی برش", min: 0, max: 0.5, step: 0.01 },
  { k: "baseCurve", label: "منحنی بیس (Wrap)", min: 2, max: 10, step: 0.25, hint: "BC لنز = پیچش دور سر" },
  { k: "pantoDeg", label: "شیب پانتوسکوپیک", min: 0, max: 16, step: 0.5, unit: "°" },
  { k: "splayDeg", label: "زاویهٔ دسته", min: 0, max: 12, step: 0.25, unit: "°" },
  { k: "templeLen", label: "طول دسته", min: 105, max: 160, step: 1, unit: "mm" },
  { k: "templeW", label: "عرض دسته", min: 2.5, max: 9, step: 0.1, unit: "mm" },
  { k: "templeT", label: "ضخامت دسته", min: 1, max: 4.5, step: 0.1, unit: "mm" },
  { k: "earDrop", label: "افت پشت گوش", min: 0, max: 22, step: 0.5, unit: "mm" },
  { k: "bridgeDrop", label: "ارتفاع پل", min: -0.2, max: 1.2, step: 0.02 },
  { k: "bridgeArch", label: "قوس پل", min: 0, max: 12, step: 0.2, unit: "mm" },
  { g: "متریال و عدسی" },
  { k: "material", label: "جنس", type: "select", options: ["acetate", "metal", "titanium", "steel"] },
  { k: "color", label: "رنگ بدنه", type: "color" },
  { k: "metalColor", label: "رنگ یراق", type: "color" },
  { k: "lens", label: "عدسی", type: "select", options: ["clear", "gradient", "photo", "mirror", "blue"] },
  { k: "translucent", label: "شفافیت عدسی استات", min: 0, max: 0.85, step: 0.01, type: "num" },
  { g: "جزئیات" },
  { k: "doubleBridge", label: "پل دوبل (خلبانی)", type: "bool" },
  { k: "highBridge", label: "پل بلند (فریم آسیایی)", type: "bool" },
  { k: "nosePads", label: "پد بینی", type: "bool" },
  { k: "hinge", label: "لولا و پیچ", type: "bool" },
  { k: "endpiece", label: "قطعهٔ انتهایی", type: "bool" },
];

function buildControls() {
  const box = $("#controls");
  const spec = effectiveSpec();
  box.innerHTML = "";
  for (const c of CONTROLS) {
    if (c.g) {
      box.insertAdjacentHTML("beforeend", `<h4>${c.g}</h4>`);
      continue;
    }
    const id = "c_" + c.k;
    let inner;
    if (c.type === "select") {
      const v = spec[c.k];
      inner = `<select id="${id}" data-k="${c.k}">${(c.options || [])
        .map((o) => `<option value="${o}" ${String(o).startsWith(String(v)) ? "selected" : ""}>${o}</option>`)
        .join("")}</select>`;
    } else if (c.type === "bool") {
      inner = `<label class="sw"><span>${c.label}</span><input type="checkbox" id="${id}" data-k="${c.k}" ${spec[c.k] ? "checked" : ""}><i></i></label>`;
    } else if (c.type === "color") {
      const v = state[c.k] || "#22252b";
      inner = `<div class="colorrow"><input type="color" id="${id}" data-k="${c.k}" value="${v}"><code>${v}</code></div>`;
    } else {
      const v = spec[c.k] ?? c.min;
      inner = `<input type="range" id="${id}" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}"><output>${fmt(v, c.unit)}</output>`;
    }
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="row ${c.type ? c.type : "range"}">${c.type === "bool" ? "" : `<label for="${id}">${c.label}${c.hint ? `<em>${c.hint}</em>` : ""}</label>`}${inner}</div>`,
    );
  }
  for (const el of box.querySelectorAll("[data-k]")) {
    const k = el.dataset.k;
    const c = CONTROLS.find((x) => x.k === k);
    el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => onControl(k, c, el));
  }
}

function onControl(k, c, el) {
  let v =
    el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value.split(" ")[0] : el.type === "color" ? el.value : parseFloat(el.value);
  if (k === "color" || k === "metalColor") {
    state[k] = v;
    el.parentElement.querySelector("code").textContent = v;
    return recolor();
  }
  if (k === "lens") {
    state.lens = v;
    return recolor();
  }
  if (k === "shape") {
    if (v === "custom") {
      state.traced = state.traced || { lensPath: circlePath(26, 21) };
      rebuild();
      return;
    }
    const keep = { lensW: state.spec.lensW, dbn: state.spec.dbn, templeLen: state.spec.templeLen };
    state.traced = null;
    state.spec = { ...keep, ...SHAPE_PRESETS[v], shape: v };
    state.spec.lensH = +(state.spec.lensW * state.spec.depth).toFixed(1);
    buildControls();
    return rebuild();
  }
  state.spec[k] = v;
  if (k === "depth") state.spec.lensH = +((state.spec.lensW || 52) * v).toFixed(1);
  if (k === "lensH") state.spec.depth = undefined;
  const out = el.parentElement?.querySelector("output");
  if (out) out.textContent = fmt(v, c?.unit);
  rebuild();
}


/* ── پریست‌ها، ذخیره، خروجی ────────────────────────────────────────── */
function buildPresets() {
  const box = $("#presets");
  box.innerHTML = CATALOG.map(
    (p) => `<button data-p="${p.id}" title="${esc(p.name)}"><span>${esc(p.name)}</span><em>${p.shape}</em></button>`,
  ).join("");
  box.querySelectorAll("[data-p]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = CATALOG.find((x) => x.id === b.dataset.p);
      Object.assign(state.spec, toEngineSpec(p));
      state.traced = null;
      state.finish = p.finish || "polished-black";
      state.color = p.colors?.[0]?.color || "#22252b";
      state.metalColor = p.colors?.[0]?.metalColor || "#c9a45e";
      state.lens = p.lens || "clear";
      state.name = p.name;
      $("#productSelect").value = p.id;
      buildControls();
      rebuild();
    }),
  );
}
$("#productSelect").innerHTML = CATALOG.map((p) => `<option value="${p.id}">${esc(p.name)} — ${p.id}</option>`).join("");

const KEYS = ["shape", "style", "material", "lensW", "lensH", "dbn", "templeLen", "rimW", "rimT", "bevel", "baseCurve", "pantoDeg", "splayDeg", "templeW", "templeT", "earDrop", "bridgeDrop", "bridgeArch", "doubleBridge", "highBridge", "nosePads", "hinge", "endpiece", "catAmp", "catWidth", "teardrop", "nasalNotch", "topWide", "exp", "depth", "lensTiltDeg"];
function currentProduct() {
  const s = effectiveSpec();
  const out = { id: "CUSTOM-" + String(Date.now()).slice(-4), name: state.name || "فریم سفارشی", shape: s.shape, style: s.style, material: s.material, size: `${Math.round(s.lensW || 52)}□${Math.round(s.dbn)}-${Math.round(s.templeLen || 145)}`, lensH: +(s.lensH || 0).toFixed(1) };
  for (const k of KEYS) if (s[k] !== undefined && s[k] !== null) out[k] = s[k];
  if (state.traced?.lensPathR) {
    out.lensPath = state.traced.lensPath;
    out.lensPathL = state.traced.lensPathL;
    out.lensPathR = state.traced.lensPathR;
  }
  out.finish = state.finish;
  out.lens = state.lens;
  out.colors = [{ name: "سفارشی", color: state.color, metalColor: state.metalColor }];
  return out;
}

$("#btnJson").onclick = () => download("frame.json", JSON.stringify(currentProduct(), null, 2), "application/json");
$("#btnCatalog").onclick = async () => {
  const p = currentProduct();
  const list = JSON.parse(localStorage.getItem("vt.custom") || "[]");
  list.unshift(p);
  localStorage.setItem("vt.custom", JSON.stringify(list.slice(0, 60)));
  await navigator.clipboard?.writeText(JSON.stringify(p, null, 2));
  toast("به کاتالوگ محلی اضافه شد و JSON کپی شد");
};
$("#btnGlb").onclick = () => {
  const bytes = exportGLB(effectiveSpec(), { name: currentProduct().name, color: state.color, metalColor: state.metalColor, lens: state.lens, finish: state.finish });
  const blob = new Blob([bytes], { type: "model/gltf-binary" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (state.name || "frame").replace(/\s+/g, "-") + ".glb";
  a.click();
  toast("GLB آماده شد · " + (bytes.length / 1024).toFixed(0) + "KB");
};
$("#btnPng").onclick = () => {
  if (rebuildReq) {
    cancelAnimationFrame(rebuildReq);
    rebuildReq = 0;
    rebuildNow();
  }
  frameCam();
  renderer.render(scene, camera);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = (state.name || "frame").replace(/\s+/g, "-") + ".png";
  a.click();
};
$("#btnBatch").onclick = async () => {
  // تولید بستهٔ محصولات: products.json + یک GLB برای هر فریم کاتالوگ
  const items = CATALOG.map((p) => {
    const s = toEngineSpec(p);
    return {
      id: p.id,
      name: p.name,
      shape: p.shape,
      style: p.style,
      material: p.material,
      size: p.size,
      price: p.price,
      finish: p.finish,
      lens: p.lens,
      colors: p.colors,
      bestFor: p.bestFor,
      spec: Object.fromEntries(KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])),
    };
  });
  download("products.json", JSON.stringify({ version: 2, products: items }, null, 2), "application/json");
  toast(`${items.length} فریم به products.json نوشته شد — برای GLB ها: npm run bake`);
};

/* ── عکس → هندسه ──────────────────────────────────────────────────── */
$("#photo").onchange = async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const img = new Image();
  img.onload = async () => {
    const max = 520;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.naturalWidth * k);
    cv.height = Math.round(img.naturalHeight * k);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    const hint = parseFloat($("#sizeHint").value) || 52;
    const r = frameFromImage(data, { lensW: hint });
    const box = $("#photoOut");
    if (!r.ok) {
      box.innerHTML = `<div class="err"><b>خط عدسی از این عکس درنیامد</b> <small>(${esc(r.reason)})</small>
        <ul style="margin:6px 14px 0 0;padding:0;line-height:1.9">
          <li>عکس <b>تمام‌رخ از روبه‌رو</b> باشد (نه سه‌رخ یا تاشده)</li>
          <li>پس‌زمینهٔ <b>شفاف (PNG)</b> یا سفیدِ یکدست؛ بدون سایه و انعکاس</li>
          <li>فریم حداقل ۶۰٪ عرض عکس را بگیرد؛ عدسی‌ها روشن‌تر از فریم</li>
          <li>اگر عدسی آینه‌ای/تیره است، عدد چاپی روی دسته را وارد کن و از «قالب‌های آماده» نزدیک‌ترین فرم را بردار</li>
        </ul></div>`;
      return;
    }
    const shape = guessShape(r.lensPath);
    state.traced = { lensPath: r.lensPath, lensPathL: r.lensPathL, lensPathR: r.lensPathR };
    Object.assign(state.spec, {
      shape,
      lensW: +Math.min(70, r.lensW).toFixed(1),
      lensH: +Math.min(64, r.lensH).toFixed(1),
      dbn: r.dbn,
      rimW: r.rimW,
      templeLen: r.templeLen,
    });
    box.innerHTML = `<div class="okrow"><b>${shape}</b><span>خط لنز از عکس گرفته شد — عرض ${r.lensW}mm · پل ${r.dbn}mm · ضخامت فریم ${r.rimW}mm · کیفیت ردیابی ${r.match}%</span></div>
      <div class="rowbtns"><button class="btn small" id="flatten">تبدیل به پارامتر (حذف مسیر دنبالی)</button></div>`;
    $("#flatten").onclick = () => {
      state.traced = null;
      buildControls();
      rebuild();
      box.innerHTML += `<div class="okrow"><span>به پارامترهای قالب تبدیل شد؛ حالا با اسلایدرها تنظیمش کن.</span></div>`;
    };
    buildControls();
    rebuild();
    const c2 = document.createElement("canvas");
    c2.width = 160;
    c2.height = Math.round((160 * img.naturalHeight) / img.naturalWidth);
    c2.getContext("2d").drawImage(img, 0, 0, c2.width, c2.height);
    $("#refImg").src = c2.toDataURL();
    $("#refWrap").hidden = false;
  };
  img.src = URL.createObjectURL(f);
};
$("#toggleTurn").onchange = (e) => (state.turn = e.target.checked);
$("#toggleGround").onchange = (e) => (ground.visible = e.target.checked);
$("#bg").oninput = (e) => {
  state.bg = e.target.value;
  document.body.style.setProperty("--bg", state.bg);
};
canvas.addEventListener("pointerdown", (e) => {
  const x0 = e.clientX,
    y0 = e.clientY,
    yaw0 = state.yaw,
    p0 = state.pitch;
  state.turn = false;
  $("#toggleTurn").checked = false;
  const move = (ev) => {
    state.yaw = yaw0 + (ev.clientX - x0) / 180;
    state.pitch = Math.max(-1.2, Math.min(1.2, p0 - (ev.clientY - y0) / 260));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  state.dist = Math.max(0.62, Math.min(2.4, state.dist + e.deltaY / 900));
});
addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "g") $("#btnGlb").click();
  if (e.key.toLowerCase() === "j") $("#btnJson").click();
  if (e.key === " ") {
    e.preventDefault();
    state.turn = !state.turn;
    $("#toggleTurn").checked = state.turn;
  }
});

function toast(msg) {
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2800);
}
function download(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* URL: ?p=AR-104 برای لینک‌کردن محصول */
const pid = new URLSearchParams(location.search).get("p");
if (pid && CATALOG.some((p) => p.id === pid)) {
  const p = CATALOG.find((x) => x.id === pid);
  Object.assign(state.spec, toEngineSpec(p));
  state.color = p.colors?.[0]?.color || state.color;
  state.finish = p.finish || state.finish;
  state.lens = p.lens || "clear";
  state.name = p.name;
  $("#productSelect").value = pid;
}
$("#productSelect").onchange = (e) => {
  const p = CATALOG.find((x) => x.id === e.target.value);
  if (p) document.querySelector(`[data-p="${p.id}"]`)?.click();
};
buildPresets();
buildControls();
rebuildNow();
void resample;
void smoothPts;
void lensOutline;
void buildFrame;
