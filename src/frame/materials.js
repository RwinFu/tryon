/**
 * materials.js — متریال‌های PBR واقع‌گرایانه + بافت‌های رویه‌ای (procedural)
 *
 * هیچ فایل تصویری دانلود نمی‌شود؛ همهٔ بافت‌ها روی canvas ساخته می‌شوند تا
 * افزونه تک‌فایل و آفلاین بماند (برای کاربر ایرانی بدون CDN هم کار کند).
 */

const texCache = new Map();
const hasDOM = typeof document !== "undefined" && !!document.createElement;

function canvas2d(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")];
}

function noise(ctx, size, amount, alpha = 1) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() * 2 - 1) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** لاک‌پشتی / هوانا (Mazzucchelli) */
function tortoiseTexture(THREE, base = "#6b3f20", size = 512) {
  const [c, x] = canvas2d(size);
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    const px = Math.random() * size,
      py = Math.random() * size;
    const r = 8 + Math.random() * 46;
    const dark = Math.random() > 0.42;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, dark ? "rgba(28,14,6,.85)" : "rgba(214,152,64,.55)");
    g.addColorStop(0.62, dark ? "rgba(48,24,10,.34)" : "rgba(190,124,48,.16)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(px, py, r, r * (0.45 + Math.random() * 0.7), Math.random() * 3.14, 0, 7);
    x.fill();
  }
  // رگه‌های مویی
  x.globalAlpha = 0.16;
  for (let i = 0; i < 260; i++) {
    x.strokeStyle = Math.random() > 0.5 ? "#2b1508" : "#d69a44";
    x.lineWidth = 0.5 + Math.random() * 1.6;
    x.beginPath();
    const px = Math.random() * size,
      py = Math.random() * size;
    x.moveTo(px, py);
    x.quadraticCurveTo(px + 40 - Math.random() * 80, py + 40 - Math.random() * 80, px + 90 - Math.random() * 180, py + 90 - Math.random() * 180);
    x.stroke();
  }
  x.globalAlpha = 1;
  noise(x, size, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(3, 1);
  t.anisotropy = 4;
  return t;
}

/** شاخ/بافالو: ابرهای نرم */
function hornTexture(THREE, base = "#8a6a44", size = 256) {
  const [c, x] = canvas2d(size);
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const px = Math.random() * size,
      py = Math.random() * size,
      r = 14 + Math.random() * 60;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const v = Math.random();
    g.addColorStop(0, v > 0.5 ? "rgba(255,244,222,.4)" : "rgba(52,32,16,.34)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  noise(x, size, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(2, 1);
  return t;
}

/** متال برس‌خورده: رگه‌های افقی → roughnessMap */
function brushedRoughness(THREE, size = 256) {
  const [c, x] = canvas2d(size);
  x.fillStyle = "#8b8b8b";
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * size;
    x.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
    x.lineWidth = 0.4 + Math.random() * 1.1;
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(size, y + (Math.random() * 2 - 1));
    x.stroke();
  }
  noise(x, size, 14);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

/** میکرو-زبری پلاستیک مات */
function matteRoughness(THREE, size = 128) {
  const [c, x] = canvas2d(size);
  x.fillStyle = "#c8c8c8";
  x.fillRect(0, 0, size, size);
  noise(x, size, 46);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 4);
  return t;
}

/** گرادیان عدسی (دودی رو به پایین) */
export function lensGradient(THREE, top = "rgba(255,255,255,1)", bottom = "rgba(40,40,44,.35)") {
  const key = "grad:" + top + bottom;
  if (texCache.has(key)) return texCache.get(key);
  if (!hasDOM) return null;
  const [c, x] = canvas2d(64);
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function procedural(THREE, kind) {
  if (!hasDOM) return null;
  const key = kind;
  if (!texCache.has(key)) {
    const t =
      kind === "tortoise"
        ? tortoiseTexture(THREE)
        : kind === "horn"
          ? hornTexture(THREE)
          : kind === "brushed"
            ? brushedRoughness(THREE)
            : kind === "matte"
              ? matteRoughness(THREE)
              : null;
    texCache.set(key, t);
  }
  return texCache.get(key);
}

export const FINISHES = {
  "polished-black": { color: "#0f1013", kind: "acetate", roughness: 0.07 },
  havana: { color: "#6b3f20", kind: "tortoise" },
  "tortoise-light": { color: "#9a6a34", kind: "tortoise" },
  crystal: { color: "#c8d2d6", kind: "acetate", translucent: 0.62, roughness: 0.06 },
  "matte-sand": { color: "#8f8577", kind: "matte" },
  "matte-black": { color: "#16181b", kind: "matte", roughness: 0.7 },
  gold: { color: "#d8b478", kind: "polished" },
  rose: { color: "#c58e75", kind: "polished" },
  silver: { color: "#c6cbd2", kind: "polished" },
  gunmetal: { color: "#5c646d", kind: "brushed" },
  ruthenium: { color: "#6a6f74", kind: "brushed" },
  bronze: { color: "#93683f", kind: "polished" },
  titanium: { color: "#a7a9ac", kind: "titanium" },
  horn: { color: "#8a6a44", kind: "horn" },
  "denim-blue": { color: "#38506e", kind: "acetate", roughness: 0.12 },
  "oxblood": { color: "#4c1620", kind: "acetate" },
  "olive": { color: "#4a4a2c", kind: "tortoise" },
  "translucent-amber": { color: "#b3752c", kind: "acetate", translucent: 0.72 },
};

/**
 * ساخت متریال‌های یک فریم.
 * @returns {{frame:THREE.Material, metal:THREE.Material, accent:THREE.Material, lens:THREE.Material, pad:THREE.Material}}
 */
export function buildMaterials(THREE, opts = {}) {
  const { finish = "polished-black", color, lens: lensSpec = "clear", quality = "high", envIntensity = 1 } = opts;
  const f = FINISHES[finish] || {};
  const baseColor = color || f.color || "#22242a";
  const kind = f.kind || "acetate";
  const translucent = f.translucent ?? (opts.translucent || 0);
  const useTransmission = quality === "high" && translucent > 0.02;

  const frame = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(baseColor),
    metalness: 0.02,
    roughness: f.roughness ?? 0.1,
    clearcoat: kind === "matte" ? 0.18 : 1,
    clearcoatRoughness: kind === "matte" ? 0.62 : 0.035,
    envMapIntensity: 1.05 * envIntensity,
    sheen: kind === "matte" ? 0.35 : 0,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color(baseColor).lerp(new THREE.Color("#ffffff"), 0.35),
  });
  if (kind === "tortoise" || kind === "horn") {
    const map = procedural(THREE, kind);
    if (map) {
      frame.map = map;
      frame.color = new THREE.Color(kind === "horn" ? "#ffffff" : "#e9e2d8");
    }
    frame.roughness = kind === "horn" ? 0.16 : 0.08;
  }
  if (kind === "matte") {
    const rmap = procedural(THREE, "matte");
    if (rmap) {
      frame.roughnessMap = rmap;
      frame.clearcoatRoughnessMap = rmap;
    }
  }
  if (useTransmission) {
    frame.transmission = Math.min(0.85, translucent);
    frame.thickness = 3.2;
    frame.ior = 1.5;
    frame.attenuationColor = new THREE.Color(baseColor);
    frame.attenuationDistance = 6;
    frame.transparent = true;
    frame.opacity = 1;
  }

  const metalKind = opts.metalFinish || (opts.metal === "titanium" ? "titanium" : "polished");
  const metal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.metalColor || FINISHES[opts.metalTint || "gold"]?.color || "#cfd3d8"),
    metalness: 1,
    roughness: metalKind === "titanium" ? 0.44 : 0.14,
    envMapIntensity: 1.55 * envIntensity,
    clearcoat: 0.2,
    clearcoatRoughness: 0.2,
  });
  if (metalKind === "brushed") {
    const rmap = procedural(THREE, "brushed");
    if (rmap) {
      metal.roughnessMap = rmap;
      metal.roughness = 0.42;
    }
  }

  const accent = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.accentColor || "#c9a45e"),
    metalness: 1,
    roughness: 0.26,
    envMapIntensity: 1.4 * envIntensity,
  });

  const pad = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#e3e2da"),
    metalness: 0,
    roughness: 0.42,
    transmission: quality === "high" ? 0.35 : 0,
    thickness: 0.9,
    transparent: true,
    opacity: quality === "high" ? 1 : 0.62,
    envMapIntensity: 0.9 * envIntensity,
  });

  const lens = buildLensMaterial(THREE, lensSpec, quality, envIntensity);
  return { frame, metal, accent, lens, pad, frameTip: frame };
}

export function buildLensMaterial(THREE, spec = "clear", quality = "high", envIntensity = 1) {
  const o = typeof spec === "string" ? { type: spec } : spec || {};
  const type = o.type || "clear";
  const hi = quality === "high";
  const clear = type === "clear" || type === "blue";
  const density = Math.max(0, Math.min(1, o.tint ?? (clear ? 0.025 : type === "photo" ? 0.7 : 0.45)));
  const tint = new THREE.Color(o.color || (clear ? "#ffffff" : type === "photo" ? "#60646a" : "#8b9096"));
  const mirror = type === "mirror";
  const m = new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: mirror ? 0.92 : 0,
    roughness: mirror ? 0.09 : 0.005,
    // The captured face is already display-referred: do not apply ACES again.
    toneMapped: mirror,
    // Glass already has a Fresnel interface; a full clearcoat doubles glare.
    clearcoat: mirror ? 0.25 : 0,
    envMapIntensity: (mirror ? 1.2 : 0.45) * envIntensity,
    specularIntensity: clear ? 0.45 : 0.75,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    ior: o.ior || 1.5,
  });
  if (hi && !mirror) {
    m.transmission = 1;
    m.thickness = 0.65;
    m.attenuationColor = tint;
    m.attenuationDistance = clear ? 100 : Math.max(0.5, 6 * (1 - density));
    m.opacity = 1;
    if (!clear) m.color.lerp(new THREE.Color("#ffffff"), 1 - density);
  } else {
    m.opacity = mirror ? 0.88 : clear ? 0.055 : 0.2 + density * 0.65;
  }
  if (type === "gradient") {
    // Color gradient (not alphaMap): dark at the top, light at the bottom.
    m.map = lensGradient(THREE, "#777b83", "#ffffff");
  }
  if (type === "blue") {
    m.iridescence = 0.08;
    m.iridescenceIOR = 1.3;
  }

  return m;
}

/** محیط استودیوییِ رویه‌ای (بدون فایل HDR) برای بازتاب‌های باورپذیر */
export function buildStudioEnvironment(THREE, renderer, { warmth = 0, size = 256 } = {}) {
  const scene = new THREE.Scene();
  const bg = new THREE.Mesh(
    new THREE.SphereGeometry(12, 24, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1a1e24).lerp(new THREE.Color("#ffffff"), 0.18), side: THREE.BackSide }),
  );
  scene.add(bg);
  const panel = (w, h, color, pos, intensity = 1) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  const warm = 0.5 + warmth * 0.5;
  panel(9, 6, `rgb(${255},${250 - warmth * 18},${236 - warmth * 40})`, [0, 7, 3], 1.25); // نور سقف
  panel(5, 5, `rgb(${230 + warm * 20},${236},${246})`, [-8, 1.5, 3.5], 0.7); // پنچ سمت چپ
  panel(4, 6, `rgb(${210},${196},${176})`, [8, 0.5, 1.5], 0.55); // فیل گرم راست
  panel(10, 4, "#2c333c", [0, -5, -2], 0.35); // کف تیره
  panel(7, 3.2, "#f2f6ff", [0, 1.2, -9], 0.42); // نور پشت (rim)
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    o.geometry && o.geometry.dispose();
    o.material && o.material.dispose();
  });
  void size;
  return env;
}
