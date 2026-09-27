/**
 * materials.js — متریال‌های PBR واقع‌گرایانه + بافت‌های رویه‌ای (procedural)
 *
 * هیچ فایل تصویری دانلود نمی‌شود؛ همهٔ بافت‌ها روی canvas ساخته می‌شوند تا
 * افزونه تک‌فایل و آفلاین بماند (برای کاربر ایرانی بدون CDN هم کار کند).
 *
 * چرا این‌قدر جزئیات؟ چون هدف «فریمی است که با عینکِ داخل ویترین فرق نکند»:
 *  ۱. سطح‌های واقعی هرگز آینه‌ای صاف نیستند ⇒ نرمال‌مپ دانه‌ای و زبری موضعی؛
 *  ۲. فلزِ واقعی بازتابِ کشیده و رگه‌دار دارد ⇒ آنیزوتروپی + رگه‌های برس؛
 *  ۳. عدسیِ واقعی پوشش AR دارد ⇒ نازک‌فیمِ ملایم با ته‌رنگ سبز/بنفش؛
 *  ۴. نورِ مغازه یک نقطه نیست ⇒ IBL از سُفت‌باکس‌های لبه‌نرم با فاصلهٔ واقعی.
 */

const texCache = new Map();
const hasDOM = typeof document !== "undefined" && !!document.createElement;

function canvas2d(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")];
}

/** مولد عددِ تکرارپذیر: بافت‌ها بین لودها یکسان می‌مانند (تست + کش) */
function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** نویزِ مقداری چند-اکتاو (هموار + ریز) — پایهٔ نرمال‌مپ و زبری */
function valueNoise(size, cells, rand) {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const out = new Float32Array(size * size);
  const step = cells / size;
  for (let y = 0; y < size; y++) {
    const gy = y * step,
      y0 = Math.floor(gy),
      fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < size; x++) {
      const gx = x * step,
        x0 = Math.floor(gx),
        fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const i00 = y0 * (cells + 1) + x0;
      const a = grid[i00],
        b = grid[i00 + 1],
        c = grid[i00 + cells + 1],
        d = grid[i00 + cells + 2];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

/** میدانِ ارتفاع: چند اکتاو + رگهٔ افقی (برای فلزِ برس‌خورده) */
function heightField(size, { octaves = 3, streak = 0, seed = 7 } = {}) {
  const rand = rng(seed);
  const field = new Float32Array(size * size);
  let amp = 1,
    total = 0,
    cells = 4;
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(size, cells, rand);
    for (let i = 0; i < field.length; i++) field[i] += layer[i] * amp;
    total += amp;
    amp *= 0.52;
    cells *= 2;
  }
  for (let i = 0; i < field.length; i++) field[i] /= total || 1;
  if (streak > 0) {
    // رگه‌های کشیدهٔ افقی: هر ردیف یک شیب نرم می‌گیرد (خطِ پخشِ فلز)
    const rows = new Float32Array(size);
    for (let y = 0; y < size; y++) rows[y] = rand();
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        field[y * size + x] = field[y * size + x] * (1 - streak) + rows[y] * streak;
  }
  return field;
}

/**
 * نرمال‌مپ + نقشهٔ زبری از یک میدانِ ارتفاع.
 * نرمال‌ها در فضای تانژنت (قرارداد OpenGL: سبز رو به بالا) ساخته می‌شوند.
 */
function grainMaps(THREE, key, { size = 256, strength = 0.5, rough = [0.45, 0.85], octaves = 3, streak = 0, seed = 7, repeat = [4, 1] } = {}) {
  if (texCache.has(key)) return texCache.get(key);
  if (!hasDOM) return null;
  const field = heightField(size, { octaves, streak, seed });
  const [cn, xn] = canvas2d(size);
  const nd = xn.createImageData(size, size);
  const [cr, xr] = canvas2d(size);
  const rd = xr.createImageData(size, size);
  const at = (x, y) => field[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // نرمالِ واحد از گرادیان (nx, ny, 1)
      const len = Math.hypot(dx, dy, 1) || 1;
      const i = (y * size + x) * 4;
      nd.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nd.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nd.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      nd.data[i + 3] = 255;
      const v = rough[0] + (rough[1] - rough[0]) * at(x, y);
      const g = Math.max(0, Math.min(255, Math.round(v * 255)));
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = g;
      rd.data[i + 3] = 255;
    }
  }
  xn.putImageData(nd, 0, 0);
  xr.putImageData(rd, 0, 0);
  const normalMap = new THREE.CanvasTexture(cn);
  const roughnessMap = new THREE.CanvasTexture(cr);
  for (const t of [normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4;
  }
  const maps = { normalMap, roughnessMap };
  texCache.set(key, maps);
  return maps;
}

/** بافتِ سُفت‌باکس: نرم‌شدنِ لبهٔ منبع نور ⇒ بازتابِ کشیده و واقعی */
function softboxTexture(THREE, { falloff = 0.5, size = 128, vertical = false } = {}) {
  const key = "soft:" + falloff + ":" + size + ":" + (vertical ? "v" : "h");
  if (texCache.has(key)) return texCache.get(key);
  if (!hasDOM) return null;
  const [c, x] = canvas2d(size);
  const g = vertical ? x.createLinearGradient(0, 0, 0, size) : x.createLinearGradient(0, 0, size, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(falloff * 0.5, "rgba(255,255,255," + (0.55 + 0.45 * (1 - falloff)).toFixed(2) + ")");
  g.addColorStop(0.5, "rgba(255,255,255,1)");
  g.addColorStop(1 - falloff * 0.5, "rgba(255,255,255," + (0.55 + 0.45 * (1 - falloff)).toFixed(2) + ")");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
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
  "matte-navy": { color: "#1d2733", kind: "matte", roughness: 0.62 },
  "matte-tortoise": { color: "#3a2415", kind: "tortoise", roughness: 0.44, matte: true },
  gold: { color: "#d8b478", kind: "polished" },
  rose: { color: "#c58e75", kind: "polished" },
  "rose-gold": { color: "#d7a288", kind: "polished" },
  silver: { color: "#c6cbd2", kind: "polished" },
  "silver-matte": { color: "#b9bec6", kind: "brushed", roughness: 0.34 },
  gunmetal: { color: "#5c646d", kind: "brushed" },
  "gunmetal-polish": { color: "#4d555e", kind: "polished" },
  ruthenium: { color: "#6a6f74", kind: "brushed" },
  bronze: { color: "#93683f", kind: "polished" },
  "antique-bronze": { color: "#7c5a34", kind: "brushed" },
  titanium: { color: "#a7a9ac", kind: "titanium" },
  "titanium-brushed": { color: "#9fa3a7", kind: "titanium", brushed: true },
  horn: { color: "#8a6a44", kind: "horn" },
  "denim-blue": { color: "#38506e", kind: "acetate", roughness: 0.12 },
  oxblood: { color: "#4c1620", kind: "acetate" },
  olive: { color: "#4a4a2c", kind: "tortoise" },
  "translucent-amber": { color: "#b3752c", kind: "acetate", translucent: 0.72 },
  "translucent-smoke": { color: "#4a4a52", kind: "acetate", translucent: 0.58 },
};

/** خواندن هگز به سه کانال ۰..۱ بدون THREE (قابل استفاده در تست Node) */
function rgb(hex) {
  const h = String(hex || "#000").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255];
}

/**
 * فینیشِ هم‌خانواده با «جنس و پرداخت»ِ برداشته‌شده از عکس گوشی.
 * رنگ را جدا نگه می‌داریم (کاربر/عکس تعیینش می‌کند) و فقط خانوادهٔ متریال
 * را عوض می‌کنیم تا استاتِ مات با فلزِ براق اشتباه نشود.
 */
export function finishForLook({ material, finish, color } = {}) {
  const l = rgb(color || "#808080");
  const luma = 0.299 * l[0] + 0.587 * l[1] + 0.114 * l[2];
  const metal = material === "metal" || material === "titanium" || material === "steel";
  if (metal) {
    if (finish === "matte") return luma < 0.45 ? "gunmetal" : "silver-matte";
    if (finish === "satin") return "titanium";
    return luma < 0.4 ? "gunmetal-polish" : "silver";
  }
  if (finish === "matte") return "matte-sand";
  if (finish === "satin") return "havana"; // خانوادهٔ استات با بافتِ ملایم
  return "polished-black";
}

/** نزدیک‌ترین فینیشِ کاتالوگ به یک رنگ — برای رنگِ برداشته‌شده از عکس گوشی */
export function nearestFinish(hex) {
  const c = rgb(hex);
  let best = null,
    bestD = Infinity;
  for (const [name, f] of Object.entries(FINISHES)) {
    const t = rgb(f.color);
    const d = (c[0] - t[0]) ** 2 * 0.32 + (c[1] - t[1]) ** 2 * 0.45 + (c[2] - t[2]) ** 2 * 0.23;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/**
 * ساخت متریال‌های یک فریم.
 * سطح‌های واقعی هرگز صاف نیستند: نرمال‌مپ دانه‌ای، زبری موضعی، آنیزوتروپی فلز
 * و IOR واقعیِ استات (۱٫۴۹) تفاوت «فریمِ رندرشده» و «فریمِ ویترین» را می‌سازد.
 * @returns {{frame:THREE.Material, metal:THREE.Material, accent:THREE.Material, lens:THREE.Material, pad:THREE.Material}}
 */
export function buildMaterials(THREE, opts = {}) {
  const { finish = "polished-black", color, lens: lensSpec = "clear", quality = "high", envIntensity = 1 } = opts;
  const f = FINISHES[finish] || {};
  const baseColor = color || f.color || "#22242a";
  const kind = f.kind || "acetate";
  const translucent = f.translucent ?? (opts.translucent || 0);
  const useTransmission = quality === "high" && translucent > 0.02;
  const lite = quality === "lite";

  const frame = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(baseColor),
    metalness: 0.02,
    // فینیشِ مات اگر زبریِ صریح نداشته باشد، ماتِ واقعی است (نه براقِ آینه‌ای)
    roughness: f.roughness ?? (kind === "matte" ? 0.62 : 0.1),
    clearcoat: kind === "matte" ? 0.22 : 1,
    clearcoatRoughness: kind === "matte" ? 0.55 : 0.035,
    envMapIntensity: 1.05 * envIntensity,
    sheen: kind === "matte" ? 0.35 : 0,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color(baseColor).lerp(new THREE.Color("#ffffff"), 0.35),
    ior: 1.49, // استاتِ واقعی (PMMA) ضریبِ شکستِ ۱٫۴۹ دارد
  });
  if (kind === "tortoise" || kind === "horn") {
    const map = procedural(THREE, kind);
    if (map) {
      frame.map = map;
      frame.color = new THREE.Color(kind === "horn" ? "#ffffff" : "#e9e2d8");
    }
    frame.roughness = f.matte ? 0.46 : kind === "horn" ? 0.16 : 0.08;
  }
  if (kind === "matte") {
    const rmap = procedural(THREE, "matte");
    if (rmap) {
      frame.roughnessMap = rmap;
      frame.clearcoatRoughnessMap = rmap;
    }
  }
  if (!lite) {
    // ریزدانِشِ سطح: بدون آن، استات و متال مثل پلاستیکِ تزریقیِ رایانه‌ای دیده می‌شوند
    const grain = grainMaps(THREE, "grain:" + kind, {
      strength: kind === "matte" ? 0.9 : 0.34,
      rough: kind === "matte" ? [0.5, 0.92] : [0.05, 0.22],
      streak: kind === "polished" ? 0.2 : 0,
      repeat: [6, 1.6],
    });
    if (grain) {
      const n = kind === "matte" ? 0.5 : 0.2;
      frame.normalMap = grain.normalMap;
      frame.normalScale = new THREE.Vector2(n, n);
      if (kind !== "matte" && !frame.roughnessMap) frame.roughnessMap = grain.roughnessMap;
      if (kind !== "matte") frame.clearcoatNormalMap = grain.normalMap;
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

  const metalKind =
    opts.metalFinish || (opts.metal === "titanium" ? "titanium" : kind === "brushed" || f.brushed ? "brushed" : "polished");
  const metal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.metalColor || FINISHES[opts.metalTint || "gold"]?.color || "#cfd3d8"),
    metalness: 1,
    roughness: metalKind === "titanium" ? 0.4 : metalKind === "brushed" ? 0.3 : 0.12,
    envMapIntensity: 1.55 * envIntensity,
    clearcoat: 0.2,
    clearcoatRoughness: 0.2,
  });
  if (metalKind === "brushed" || metalKind === "titanium") {
    const grain = grainMaps(THREE, "metal:" + metalKind, { strength: 0.5, rough: [0.2, 0.52], streak: 0.6, repeat: [8, 1] });
    if (grain) {
      metal.roughnessMap = grain.roughnessMap;
      metal.normalMap = grain.normalMap;
      metal.normalScale = new THREE.Vector2(0.3, 0.3);
      metal.roughness = metalKind === "titanium" ? 0.42 : 0.3;
      // فلزِ برس‌خورده بازتابِ کشیده دارد، نه نقطه‌ای (KHR_materials_anisotropy)
      metal.anisotropy = 0.75;
      metal.anisotropyRotation = 0;
    }
  } else if (!lite) {
    metal.roughness = Math.max(0.05, f.roughness ?? 0.12);
  }

  const accent = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.accentColor || "#c9a45e"),
    metalness: 1,
    roughness: 0.22,
    envMapIntensity: 1.4 * envIntensity,
  });

  const pad = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#e9e8e0"),
    metalness: 0,
    roughness: 0.38,
    transmission: quality === "high" ? 0.35 : 0,
    thickness: 0.9,
    ior: 1.41, // سیلیکونِ پد بینی
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
    // تصویرِ ضبط‌شده از قبل display-referred است؛ دوباره tone-map نشود
    toneMapped: mirror,
    // شیشه خودش رابطِ فرنل دارد؛ clearcoatِ کامل انعکاس را دو برابر می‌کند
    clearcoat: mirror ? 0.25 : 0,
    envMapIntensity: (mirror ? 1.2 : 0.45) * envIntensity,
    specularIntensity: clear ? 0.45 : 0.75,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    ior: o.ior || 1.52, // شیشهٔ عدسیِ واقعی ≈ ۱٫۵۲
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
    // گرادیانِ رنگ (نه alphaMap): بالای عدسی تیره، پایین روشن
    m.map = lensGradient(THREE, "#777b83", "#ffffff");
  }
  if (type === "blue") {
    m.iridescence = 0.1;
    m.iridescenceIOR = 1.3;
  }
  // پوششِ ضدِبازتابِ واقعی (AR coating): ته‌رنگِ سبز-بنفشِ بسیار ملایمِ لبهٔ عدسی
  if (hi && !mirror && (o.coat ?? true)) {
    m.iridescence = Math.max(m.iridescence || 0, 0.16);
    m.iridescenceIOR = 1.32;
    m.iridescenceThicknessRange = [110, 420];
  }

  return m;
}

/**
 * محیطِ نورپردازیِ رویه‌ای — بدون فایل HDR.
 * منابعِ نور سُفت‌باکس با لبهٔ نرم‌اند و در فاصلهٔ واقعی از قطعه قرار می‌گیرند،
 * پس بازتابِ استات یک هایلایتِ کشیده و بازتابِ فلز یک خطِ کشیده می‌شود —
 * همان چیزی که در عکسِ واقعیِ ویترین دیده می‌شود.
 * @param {{warmth?:number, tint?:[number,number,number], gain?:number, size?:number, lamps?:boolean}} opts
 */
export function buildStudioEnvironment(THREE, renderer, { warmth = 0, tint = null, gain = 1, size = 256, lamps = true } = {}) {
  const scene = new THREE.Scene();
  const room = tint || [1, 1, 1];
  const ceil = room[0] * 0.9,
    hor = room[1] * 0.66,
    flr = room[2] * 0.2;
  // پوستهٔ اتاق: گرادیانِ عمودی (سقف روشن، افق خنثی، کف تیره)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 20),
    new THREE.MeshBasicMaterial({
      map: verticalGradient(THREE, [
        [0, 0.1 * ceil + 0.02],
        [0.42, hor],
        [0.52, hor * 0.86],
        [1, 0.06 * flr + 0.015],
      ]),
      side: THREE.BackSide,
    }),
  );
  scene.add(sky);
  const panel = (w, h, color, pos, intensity = 1, soft = 0.42, vertical = false) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: softboxTexture(THREE, { falloff: soft, vertical }),
        color: new THREE.Color(color).multiplyScalar(intensity * gain),
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(0, 0, 0);
    scene.add(m);
    return m;
  };
  const warm = 0.5 + warmth * 0.5;
  const cool = [1, 0.985 - warmth * 0.07, 0.94 - warmth * 0.14];
  panel(11, 5.4, `rgb(${255},${250 - warmth * 16},${238 - warmth * 38})`, [0, 6.4, 2.6], 1.5, 0.5, true); // سقف
  panel(5.4, 5.4, `rgb(${232 * cool[0] + 18},${236 * cool[1]},${246 * cool[2]})`, [-7.4, 1.6, 3.6], 0.85, 0.4); // سُفت‌باکسِ کلیدیِ چپ
  panel(4.4, 6.4, `rgb(${226 * cool[0]},${214 * cool[1]},${196 * cool[2]})`, [7.6, 0.6, 1.6], 0.6, 0.46); // فیلِ گرمِ راست
  panel(7.4, 3.4, "#dfe8ff", [0, 1.2, -8.6], 0.5, 0.4); // نورِ پشت (ریم)
  panel(9, 4, "#20252b", [0, -4.6, -1.6], 0.5, 0.55, true); // کفِ تیره
  if (lamps) {
    // چند نقطهٔ روشنِ کوچک: برقِ فلز و براقیتِ استات را «تیز» می‌کنند
    panel(0.9, 0.9, "#ffffff", [-3.2, 5.2, 2.2], 3.4, 0.3);
    panel(0.7, 0.7, "#ffffff", [3.6, 4.4, 1.6], 2.6, 0.3);
    panel(0.6, 0.6, "#ffffff", [1.4, 5.6, -2.4], 2.2, 0.3);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    o.geometry && o.geometry.dispose();
    o.material && o.material.dispose();
  });
  void size;
  return env;
}

/** گرادیانِ عمودی برای پوستهٔ اتاق (سقف → افق → کف) */
function verticalGradient(THREE, stops) {
  const key = "room:" + stops.map((s) => s.join(":")).join("|");
  if (texCache.has(key)) return texCache.get(key);
  const [c, x] = canvas2d(128);
  const g = x.createLinearGradient(0, 0, 0, 128);
  for (const [pos, v] of stops) {
    const n = Math.max(0, Math.min(1, v));
    g.addColorStop(pos, `rgb(${Math.round(n * 255)},${Math.round(n * 255)},${Math.round(n * 255)})`);
  }
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/** آزادکردن بافت‌های رویه‌ای (هنگام تعویض محیط/خروجی) */
export function disposeProceduralTextures() {
  for (const v of texCache.values()) {
    if (!v) continue;
    if (v.isTexture) v.dispose();
    else if (typeof v === "object") for (const t of Object.values(v)) t?.dispose?.();
  }
  texCache.clear();
}
