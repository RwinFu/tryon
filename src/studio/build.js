/**
 * build.js — صفحهٔ «ساخت فریم از ۳ عکس» (build.html)
 *
 * همان خطِّ تولیدِ kit.js است با یک ویزاردِ ساده:
 *   عکس‌ها → اجرای خودکار → گزارش + اصلاحِ دستی → پیش‌نمایشِ سه‌بعدی → خروجی.
 * هیچ داده‌ای از مرورگر بیرون نمی‌رود؛ خروجی‌ها با لینکِ Blob دانلود می‌شوند.
 */

import * as THREE from "three";
import { createFrameObject, clearFrameCache } from "../frame/index.js";
import { buildFrameKit, applyFix, kitFixes } from "../frame/kit.js";
import { exportGLB } from "../frame/glb.js";
import { buildStudioEnvironment } from "../frame/materials.js";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const state = {
  photos: { front: null, templeR: null, templeL: null },
  kit: null,
  product: null,
  cam: { yaw: -0.5, pitch: 0.16, dist: 1.2 },
  turn: true,
  showDecals: true,
};

/* ── صحنه ─────────────────────────────────────────────────────────────── */
const canvas = $("#view");
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.toneMapping = "NeutralToneMapping" in THREE ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.environment = buildStudioEnvironment(THREE, renderer, { warmth: 0.12 });
scene.environmentIntensity = 1.1;
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
  new THREE.MeshStandardMaterial({ color: 0x0d1013, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.7 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -78;
scene.add(ground);

let obj = null;
function resize() {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

function frameCam() {
  if (!obj) return;
  const box = new THREE.Box3().setFromObject(holder);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  if (!sph.radius) return;
  const d = (sph.radius / Math.sin((camera.fov * Math.PI) / 360)) * state.cam.dist;
  const { yaw, pitch } = state.cam;
  camera.position.set(
    sph.center.x + Math.sin(yaw) * Math.cos(pitch) * d,
    sph.center.y + Math.sin(pitch) * d,
    sph.center.z + Math.cos(yaw) * Math.cos(pitch) * d,
  );
  camera.lookAt(sph.center);
}
function loop() {
  requestAnimationFrame(loop);
  if (state.turn) {
    state.cam.yaw += 0.0055;
    frameCam();
  }
  renderer.render(scene, camera);
}
loop();

function rebuild() {
  if (!state.kit) return;
  clearFrameCache();
  const product = {
    ...state.kit.product,
    spec: { ...state.kit.spec },
    decals: state.showDecals ? state.kit.decals : null,
  };
  if (obj) {
    holder.remove(obj.group);
    obj.dispose();
  }
  obj = createFrameObject(THREE, product, { quality: "high", occluder: false, envIntensity: 1.15 });
  obj.group.traverse((o) => (o.matrixAutoUpdate = true));
  holder.add(obj.group);
  for (const btn of ["#btnTryOn", "#btnJson", "#btnPng", "#btnGlb", "#btnSave"]) $(btn).disabled = false;
  requestAnimationFrame(() => {
    resize();
    frameCam();
  });
}

/* ── ورودی عکس ────────────────────────────────────────────────────────── */
const MAXDIM = 1600;
function fileToImageData(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAXDIM / Math.max(img.width, img.height));
      const w = Math.max(8, Math.round(img.width * k));
      const h = Math.max(8, Math.round(img.height * k));
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      res(ctx.getImageData(0, 0, w, h));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => rej(new Error("تصویر باز نشد"));
    img.src = URL.createObjectURL(file);
  });
}

function wireDrop(dropSel, fileSel, key) {
  const drop = $(dropSel),
    input = $(fileSel);
  const load = async (file) => {
    if (!file) return;
    try {
      const data = await fileToImageData(file);
      state.photos[key] = data;
      drop.classList.add("over");
      drop.querySelector("b").textContent = "✓ " + drop.querySelector("b").textContent.replace(/^✓\s*/, "");
      run();
    } catch (e) {
      toast("خطا در خواندن عکس: " + e.message);
    }
  };
  drop.onclick = () => input.click();
  input.onchange = () => load(input.files?.[0]);
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    load(e.dataTransfer?.files?.[0]);
  });
}
wireDrop("#dropFront", "#fileFront", "front");
wireDrop("#dropTR", "#fileTR", "templeR");
wireDrop("#dropTL", "#fileTL", "templeL");

/* عکس‌های نمونهٔ خودِ مخزن (برای دیدنِ سریعِ نتیجه بدون آپلود) */
const SAMPLES = {
  front: "assets/samples/arvin-spiderman-v4.png",
  templeR: "assets/samples/arvin-temple-v1.png",
  templeL: "assets/samples/arvin-temple-short-v3.png",
};
async function urlToImageData(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((ok, no) => {
    img.onload = ok;
    img.onerror = () => no(new Error("عکسِ نمونه باز نشد: " + src));
    img.src = src;
  });
  const k = Math.min(1, MAXDIM / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement("canvas");
  cv.width = Math.max(8, Math.round(img.naturalWidth * k));
  cv.height = Math.max(8, Math.round(img.naturalHeight * k));
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return ctx.getImageData(0, 0, cv.width, cv.height);
}
$("#btnSample").onclick = async () => {
  try {
    for (const [key, src] of Object.entries(SAMPLES)) {
      state.photos[key] = await urlToImageData(new URL("../" + src, location.href).href);
      const drop = $(key === "front" ? "#dropFront" : key === "templeR" ? "#dropTR" : "#dropTL");
      drop.classList.add("over");
    }
    $("#name").value = "طبی اسپایدرمنی";
    $("#lensW").value = 52;
    toast("نمونه‌ها بارگذاری شد");
    run();
  } catch (e) {
    toast(e.message);
  }
};

/* ── اجرای خط تولید ───────────────────────────────────────────────────── */
function opts() {
  const tol = +$("#tol").value;
  return {
    lensW: +$("#lensW").value || undefined,
    dbn: +$("#dbn").value || undefined,
    templeLen: +$("#templeLen").value || undefined,
    name: $("#name").value || undefined,
    mirrorFront: $("#mirror").checked,
    deskew: $("#deskew").checked,
    shadow: $("#shadow").checked ? 0.85 : false,
    tolerance: tol > 0 ? tol : undefined,
  };
}

let runToken = 0;
async function run() {
  if (!state.photos.front) return;
  const token = ++runToken;
  step(1);
  await new Promise((r) => setTimeout(r, 0)); // نفس کشیدنِ UI
  if (token !== runToken) return;
  step(2);
  let kit;
  try {
    kit = buildFrameKit(state.photos, opts());
  } catch (e) {
    toast("خطا در پردازش: " + e.message);
    return;
  }
  if (token !== runToken) return;
  state.kit = kit;
  step(3);
  if (!kit.ok) {
    $("#report").innerHTML = `<div class="qa">${kit.qa
      .map(
        (q) =>
          `<li class="${q.level}"><b>${esc(q.title)}</b>${esc(q.detail)}</li>`,
      )
      .join("")}</div>`;
    toast("ساخت ناموفق: " + (kit.reason || "؟"));
    return;
  }
  state.product = kit.product;
  showCuts(kit);
  renderReport(kit);
  renderFixes(kit);
  rebuild();
  step(4);
}

function step(n) {
  for (const s of document.querySelectorAll("#steps span")) s.classList.toggle("on", +s.dataset.step <= n);
}

/* ── پیش‌نمایشِ برش‌ها ─────────────────────────────────────────────────── */
function drawCut(canvasSel, image) {
  const cv = $(canvasSel);
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!image) return;
  const k = Math.min(cv.width / image.width, cv.height / image.height);
  const w = Math.max(1, Math.round(image.width * k)),
    h = Math.max(1, Math.round(image.height * k));
  cv.width = w;
  cv.height = h;
  const tmp = document.createElement("canvas");
  tmp.width = image.width;
  tmp.height = image.height;
  tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(tmp, 0, 0, w, h);
}
function showCuts(kit) {
  const c = kit.report.cuts;
  drawCut("#cutFront", c.front);
  drawCut("#cutTR", c.templeR);
  drawCut("#cutTL", c.templeL);
}

/* ── گزارش ────────────────────────────────────────────────────────────── */
function renderReport(kit) {
  const m = kit.report.measured;
  const s = kit.spec;
  const tr = kit.report.temples.right,
    tl = kit.report.temples.left;
  const rows = [
    ["عرض عدسی", m.lensW + " mm"],
    ["ارتفاع عدسی", m.lensH + " mm"],
    ["پل", m.dbn + " mm"],
    ["ضخامت رینگ", m.rimW + " mm"],
    ["پهنای کل (از عکس)", m.totalWidth + " mm"],
    ["قالب تشخیص‌داده‌شده", s.shape],
    ["جنس/پرداخت", `${s.material} · ${s.finish}`],
    ["رنگ برداشته‌شده", s.color],
    ["طول دسته", s.templeLen + " mm"],
    ["ارتفاع/ضخامت دسته", `${s.templeW} / ${s.templeT} mm`],
    ["افتِ پشت گوش", s.earDrop + " mm"],
    ["اندازهٔ نهایی", `${Math.round(s.lensW)}□${Math.round(s.dbn)}-${Math.round(s.templeLen)}`],
  ];
  const templeRows = [];
  for (const [label, p] of [
    ["دستهٔ راست", tr],
    ["دستهٔ چپ", tl],
  ])
    if (p)
      templeRows.push(
        `<tr><td>${label}</td><td>${p.lengthMm}mm · اطمینان ${p.confidence}٪${p.flipped ? " · جهت اصلاح شد" : ""}</td></tr>`,
      );

  $("#report").innerHTML = `<table>${rows
    .map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`)
    .join("")}${templeRows.join("")}</table>`;
}

function renderFixes(kit) {
  const list = kit.qa;
  const fixable = kitFixes(kit);
  $("#fixes").innerHTML =
    `<ul class="qa">${list
      .map(
        (q) =>
          `<li class="${q.level}"><b>${q.level === "ok" ? "✓" : q.level === "warn" ? "!" : "✕"} ${esc(q.title)}</b>${esc(
            q.detail,
          )}</li>`,
      )
      .join("")}</ul>` +
    `<div class="inline" style="margin-top:10px">${fixable.map(fixControl).join("")}</div>`;

  for (const el of document.querySelectorAll("[data-fix]")) {
    const id = el.dataset.fix;
    if (el.tagName === "BUTTON")
      el.onclick = () => {
        applyFix(kit, { [id]: true });
        afterFix(kit);
      };
    else if (el.type === "color")
      el.onchange = () => {
        applyFix(kit, { [id]: el.value });
        afterFix(kit);
      };
    else
      el.onchange = () => {
        applyFix(kit, { [id]: el.tagName === "SELECT" ? el.value : +el.value });
        afterFix(kit);
      };
  }
}

/** یک کنترلِ اصلاح (عدد / انتخاب / رنگ / دکمه) */
function fixControl(f) {
  if (f.kind === "action") return `<button class="btn" data-fix="${f.id}">${esc(f.label)}</button>`;
  if (f.kind === "select")
    return `<label>${esc(f.label)}<select data-fix="${f.id}" class="sel">${f.options
      .map(([v, l]) => `<option value="${esc(v)}"${v === f.value ? " selected" : ""}>${esc(l)}</option>`)
      .join("")}</select></label>`;
  if (f.kind === "color") return `<label>${esc(f.label)}<input type="color" data-fix="${f.id}" value="${esc(f.value)}" /></label>`;
  return `<label>${esc(f.label)}<input type="number" data-fix="${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.value}" /></label>`;
}

function afterFix(kit) {
  state.kit = kit;
  renderReport(kit);
  rebuild();
  toast("اصلاح اعمال شد");
}

/* ── کنترل‌های صحنه ───────────────────────────────────────────────────── */
$("#turn").onchange = (e) => (state.turn = e.target.checked);
$("#showDecals").onchange = (e) => {
  state.showDecals = e.target.checked;
  rebuild();
};
$("#btnFront").onclick = () => {
  state.cam.yaw = 0;
  state.cam.pitch = 0;
  state.turn = false;
  $("#turn").checked = false;
  frameCam();
};
$("#btnSide").onclick = () => {
  state.cam.yaw = Math.PI / 2;
  state.cam.pitch = 0;
  state.turn = false;
  $("#turn").checked = false;
  frameCam();
};
$("#btnTop").onclick = () => {
  state.cam.yaw = 0;
  state.cam.pitch = 1.2;
  state.turn = false;
  $("#turn").checked = false;
  frameCam();
};
$("#tol").oninput = (e) => {
  $("#tolVal").textContent = +e.target.value > 0 ? String(e.target.value) : "خودکار";
};
$("#tol").onchange = () => state.photos.front && run();
for (const id of ["#lensW", "#dbn", "#templeLen", "#mirror", "#deskew", "#shadow"])
  $(id).onchange = () => state.photos.front && run();
$("#name").onchange = () => {
  if (state.kit) {
    state.kit.product.name = $("#name").value || state.kit.product.name;
  }
};

/* ── خروجی‌ها ─────────────────────────────────────────────────────────── */
function toast(msg) {
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
function download(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function pngOf(image) {
  return new Promise((res) => {
    const cv = document.createElement("canvas");
    cv.width = image.width;
    cv.height = image.height;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    cv.toBlob((b) => res(b), "image/png");
  });
}

$("#btnJson").onclick = () => {
  if (!state.kit) return;
  const out = { ...state.kit.product, spec: { ...state.kit.spec } };
  for (const k of ["lensPath", "lensPathR", "lensPathL"]) delete out.spec[k];
  download((state.kit.product.id || "frame") + ".json", JSON.stringify(out, null, 2), "application/json");
  toast("JSON فریم دانلود شد");
};
$("#btnPng").onclick = async () => {
  if (!state.kit) return;
  const id = state.kit.product.id;
  const c = state.kit.report.cuts;
  for (const [name, img] of [
    [`${id}-front.png`, c.front],
    [`${id}-temple-R.png`, c.templeR],
    [`${id}-temple-L.png`, c.templeL],
  ]) {
    if (!img) continue;
    const blob = await pngOf(img);
    downloadBlob(name, blob);
  }
  toast("برش‌ها دانلود شدند (در assets/frames/ بگذار)");
};
$("#btnGlb").onclick = () => {
  if (!state.kit) return;
  const s = state.kit.spec;
  const bytes = exportGLB(s, {
    name: state.kit.product.name,
    color: s.color,
    lens: s.lens,
    finish: s.finish,
  });
  downloadBlob(`${state.kit.product.id}.glb`, new Blob([bytes], { type: "model/gltf-binary" }));
  toast("GLB آماده شد · " + (bytes.length / 1024).toFixed(0) + "KB");
};
$("#btnSave").onclick = async () => {
  if (!state.kit) return;
  const p = { ...state.kit.product, spec: { ...state.kit.spec } };
  for (const k of ["lensPath", "lensPathR", "lensPathL"]) delete p.spec[k];
  const list = JSON.parse(localStorage.getItem("vt.custom") || "[]");
  list.unshift(p);
  localStorage.setItem("vt.custom", JSON.stringify(list.slice(0, 60)));
  try {
    await navigator.clipboard?.writeText(JSON.stringify(p, null, 2));
  } catch (e) {
    void e;
  }
  toast("به کاتالوگ محلی اضافه شد و JSON کپی شد");
};

let tryOnPreview = null;
$("#btnTryOn").onclick = async () => {
  if (!state.kit) return;
  try {
    const { init } = await import("../plugin.js");
    const product = { ...state.kit.product, spec: { ...state.kit.spec }, decals: state.showDecals ? state.kit.decals : null };
    if (tryOnPreview) await tryOnPreview.setProducts([product]);
    else
      tryOnPreview = init({
        mode: "overlay",
        lang: "fa",
        products: [product],
        deepLink: false,
        baseURL: new URL("./", location.href).href.replace(/\/$/, ""),
        brand: { name: "فریم ساخته‌شده از عکس" },
      });
    tryOnPreview.open();
  } catch (error) {
    toast("پرو باز نشد: " + error.message);
  }
};

/* پیوند از استودیو: ?load=vt.custom آخرین فریمِ سفارشی */
void clamp;
