/**
 * decals.js — نشاندنِ عکس‌های برش‌خورده روی هندسهٔ سه‌بعدیِ فریم
 *
 * «هیبرید» یعنی: سیلوئت و حجم را هندسهٔ رویه‌ای می‌دهد (از خطِ عدسی استخراج‌شده)،
 * و جزئیاتِ واقعی — طرح، رنگ، چاپِ روی فریم — را بافتِ همان عکس. دو نوع بافت داریم:
 *
 *   • front   یک ورقهٔ خمیده که جلوی رویه می‌نشیند (خم به اندازهٔ بیس‌کِروِ خودِ هندسه،
 *             چون ارتفاعِ هر رأس را از مسیرِ رینگِ همان هندسه می‌گیریم).
 *   • temple  یک نوار که沿着 مسیرِ دسته می‌رود؛ عکسِ نمای‌جانبی با نمایهٔ ستونی
 *             (profile) روی آن پهن می‌شود تا خمِ پشتِ گوش دو بار حساب نشود.
 *
 * داخلِ عدسی در برش شفاف است ⇒ عدسیِ سه‌بعدی از پشتِ بافت دیده می‌شود.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * ساختِ بافت از منبع‌های مختلف (URL، canvas، ImageData، <img>).
 * @returns {import("three").Texture|null}
 */
export function makeTexture(THREE, source) {
  if (!source) return null;
  let tex = null;
  if (typeof source === "string") {
    tex = new THREE.TextureLoader().load(source);
  } else if (typeof ImageData !== "undefined" && source instanceof ImageData) {
    tex = textureFromImageData(THREE, source);
  } else if (source.data && source.width && source.height) {
    tex = textureFromImageData(THREE, source);
  } else if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
    tex = new THREE.CanvasTexture(source);
  } else {
    tex = new THREE.Texture(source);
    tex.needsUpdate = true;
  }
  if (!tex) return null;
  if ("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if ("wrapS" in tex) {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return tex;
}

function textureFromImageData(THREE, imageData) {
  // بدون DOM (تست/Node) بافت واقعی ساخته نمی‌شود؛ هندسه همچنان قابل اندازه‌گیری است.
  if (typeof document === "undefined") {
    const t = new THREE.Texture();
    t.image = { width: imageData.width, height: imageData.height };
    return t;
  }
  const cv = document.createElement("canvas");
  cv.width = imageData.width;
  cv.height = imageData.height;
  const ctx = cv.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height), 0, 0);
  return new THREE.CanvasTexture(cv);
}

/** متریالِ بافت: شبیهِ متریالِ خودِ فریم نور می‌خورد تا براق/مات بودنش یکی شود */
function decalMaterial(THREE, tex, { metal = false, quality = "high" } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.04,
    roughness: metal ? 0.24 : 0.34,
    metalness: metal ? 0.65 : 0.06,
    envMapIntensity: metal ? 0.9 : 0.55,
    side: THREE.FrontSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (quality === "lite") {
    mat.roughness = 0.45;
    mat.envMapIntensity = 0.35;
  }
  return mat;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۱) ورقهٔ جلو
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * ورقه‌ای به اندازهٔ جعبهٔ عکس، خمیده روی انحنای رینگِ همان هندسه.
 * @param {{wMm:number,hMm:number,dxMm:number,dyMm:number,rimT?:number,image:any}} decal
 * @param {{paths?:Array, spec?:object}} ctx
 */
export function frontDecal(THREE, decal, ctx = {}) {
  const tex = makeTexture(THREE, decal.image);
  if (!tex) return null;
  const w = decal.wMm || 130;
  const h = decal.hMm || 40;
  const dx = decal.dxMm || 0;
  const dy = decal.dyMm || 0;
  const NX = 72,
    NY = 30;
  const rim = ctx.paths?.find((p) => p.name === "rimR") || ctx.paths?.find((p) => p.name === "rimL");
  const rimL = ctx.paths?.find((p) => p.name === "rimL");
  const lift = (decal.rimT || 3.4) / 2 + 0.05;

  const position = [],
    uv = [],
    index = [];
  for (let j = 0; j <= NY; j++) {
    const v = j / NY; // ۰ پایین، ۱ بالا
    const Y = dy - h / 2 + v * h;
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const X = dx - w / 2 + u * w;
      // ارتفاعِ z را از نزدیک‌ترین نقطهٔ مسیرِ رینگ می‌گیریم (همان انحنای واقعیِ فریم)
      const z = rimZ(X >= 0 ? rim : rimL || rim, X, Y) + lift;
      position.push(X, Y, z);
      uv.push(u, v);
    }
  }
  const row = NX + 1;
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * row + i,
        b = a + 1,
        c = a + row,
        d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, decalMaterial(THREE, tex, { metal: ctx.spec?.material === "metal", quality: ctx.quality }));
  mesh.name = "decalFront";
  mesh.renderOrder = 6;
  return mesh;
}

/** zِ سطحِ جلوی فریم در نقطهٔ (X,Y): نزدیک‌ترین نقطه روی مسیرِ رینگ (با همواریِ موضعی) */
function rimZ(rimPath, X, Y) {
  if (!rimPath?.path?.length) return 0;
  const pts = rimPath.path;
  let acc = 0,
    wsum = 0;
  let best = null,
    bestD = Infinity;
  for (const p of pts) {
    const dx = p.x - X,
      dy = p.y - Y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) return 0;
  // میانگینِ وزن‌دارِ نقاطِ نزدیک (لبهٔ پله‌ای روی ورقه نمی‌افتد)
  for (const p of pts) {
    const dx = p.x - X,
      dy = p.y - Y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const w = Math.exp(-(d * d) / 18);
    if (w < 0.05) continue;
    acc += p.z * w;
    wsum += w;
  }
  return wsum ? acc / wsum : best.z;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۲) نوارِ دسته
 * ───────────────────────────────────────────────────────────────────────── */

/** مسیرِ کاملِ دسته: «templeR» + ادامهٔ «tipR» (نوکِ دسته) */
function templePath(paths, side) {
  if (!paths) return null;
  const main = paths.find((p) => p.name === (side === "R" ? "templeR" : "templeL"));
  const tip = paths.find((p) => p.name === (side === "R" ? "tipR" : "tipL"));
  if (!main) return null;
  const pts = main.path.slice();
  if (tip?.path?.length) {
    for (const p of tip.path) {
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 0.01) pts.push(p);
    }
  }
  return pts;
}

/** بازنمونه‌برداریِ مسیر به N نقطه با گامِ کمانیِ یکسان */
function resample3(pts, N) {
  const out = [{ ...pts[0] }];
  let seg = 0,
    total = 0;
  const d = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    d.push(l);
    total += l;
  }
  if (total <= 0) return null;
  const step = total / (N - 1);
  let i = 0,
    acc = 0;
  for (let k = 1; k < N - 1; k++) {
    const target = k * step;
    while (i < d.length - 1 && acc + d[i] < target) {
      acc += d[i];
      i++;
    }
    const t = d[i] > 0 ? (target - acc) / d[i] : 0;
    const a = pts[i],
      b = pts[i + 1];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  }
  out.push({ ...pts[pts.length - 1] });
  void seg;
  return out;
}

/**
 * نوارِ بافت‌دار روی مسیرِ دسته.
 * @param {{image:any, side:'L'|'R', lengthMm?:number, heightMm?:number, taper?:number, profile?:object}} decal
 */
export function templeDecal(THREE, decal, ctx = {}) {
  const tex = makeTexture(THREE, decal.image);
  if (!tex) return null;
  const raw = templePath(ctx.paths, decal.side || "R");
  if (!raw || raw.length < 4) return null;
  const N = 120,
    M = 6;
  const pts = resample3(raw, N);
  if (!pts) return null;
  const spec = ctx.spec || {};
  const height = decal.heightMm || spec.templeW || 5;
  const taper = decal.taper ?? spec.templeTaper ?? 0.72;
  const outOffset = (spec.templeT || 2.6) / 2 + 0.04;
  const sideSign = decal.side === "L" ? -1 : 1;
  const prof = decal.profile;

  const position = [],
    uv = [],
    index = [];
  const Y = { x: 0, y: 1, z: 0 };
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(N - 1, i + 1)];
    let T = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const tl = Math.hypot(T.x, T.y, T.z) || 1;
    T = { x: T.x / tl, y: T.y / tl, z: T.z / tl };
    // بالای موضعی: تصویرِ «بالا» عمود بر مماس
    const dot = T.x * Y.x + T.y * Y.y + T.z * Y.z;
    let U = { x: Y.x - T.x * dot, y: Y.y - T.y * dot, z: Y.z - T.z * dot };
    const ul = Math.hypot(U.x, U.y, U.z) || 1;
    U = { x: U.x / ul, y: U.y / ul, z: U.z / ul };
    // راستای بیرون (دور از سر): حاصل‌ضربِ خارجی
    let S = {
      x: T.y * U.z - T.z * U.y,
      y: T.z * U.x - T.x * U.z,
      z: T.x * U.y - T.y * U.x,
    };
    if (S.x * sideSign < 0) S = { x: -S.x, y: -S.y, z: -S.z };
    const u = i / (N - 1);
    // نگاشتِ ستونی: محدودهٔ جوهرِ همین ستون در عکس (خمِ اضافه حذف می‌شود)
    let topF = 0,
      botF = 1;
    if (prof?.n) {
      const k = clamp(Math.round(u * (prof.n - 1)), 0, prof.n - 1);
      topF = prof.top[k] ?? 0;
      botF = prof.bot[k] ?? 1;
      if (botF - topF < 0.02) botF = topF + 0.02;
    }
    const hh = (height * (1 - (1 - taper) * u)) / 2;
    for (let j = 0; j <= M; j++) {
      const t = j / M; // ۰ بالا، ۱ پایین
      const off = (0.5 - t) * 2 * hh;
      position.push(p.x + S.x * outOffset + U.x * off, p.y + S.y * outOffset + U.y * off, p.z + S.z * outOffset + U.z * off);
      const vImg = topF + t * (botF - topF); // سطر در عکس (۰ = بالا)
      uv.push(u, 1 - vImg); // flipY ⇒ v=1 بالای تصویر
    }
  }
  const row = M + 1;
  for (let i = 0; i < N - 1; i++)
    for (let j = 0; j < M; j++) {
      const a = i * row + j,
        b = a + 1;
      const c = (i + 1) * row + j,
        d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, decalMaterial(THREE, tex, { metal: spec.material === "metal", quality: ctx.quality }));
  mesh.name = decal.side === "L" ? "decalTempleL" : "decalTempleR";
  mesh.renderOrder = 5;
  return mesh;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۳) API
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * همهٔ بافت‌ها را روی فریم می‌سازد.
 * @param {object} THREE
 * @param {{front?:object, templeL?:object, templeR?:object}} decals
 * @param {{paths?:Array, spec?:object, quality?:string, meta?:object}} ctx
 * @returns {Array<import("three").Mesh>}
 */
export function buildDecals(THREE, decals = {}, ctx = {}) {
  const out = [];
  if (decals.front) {
    const m = frontDecal(THREE, decals.front, ctx);
    if (m) out.push(m);
  }
  for (const key of ["templeR", "templeL"])
    if (decals[key]) {
      const m = templeDecal(THREE, decals[key], ctx);
      if (m) out.push(m);
    }
  return out;
}

/** آزادسازیِ بافت‌ها و هندسهٔ بافت‌ها */
export function disposeDecals(meshes = []) {
  for (const m of meshes) {
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      mat?.map?.dispose?.();
      mat?.dispose?.();
    }
  }
}
