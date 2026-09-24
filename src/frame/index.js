/**
 * index.js — تبدیل هندسهٔ رویه‌ای به شیء سه‌بعدی قابل استفاده در صحنه
 *
 * کش می‌کند: هندسه برای هر «شکل+سایز» یک بار ساخته می‌شود؛ عوض‌کردنِ رنگ
 * فقط متریال را عوض می‌کند (بدون بازسازی مش) → تعویض رنگ آنی است.
 */
import { buildFrame } from "./geometry.js";
import { toThreeGeometry } from "./sweep.js";
import { buildMaterials } from "./materials.js";
import { applyHeadOccluder, createHeadOccluder, headOccluderParams } from "../engine/occluder.js";

const geoCache = new Map();

export function frameKey(spec) {
  const k = [
    spec.shape || "square",
    spec.style || "full",
    spec.lensW || 0,
    spec.lensH || 0,
    spec.dbn || 0,
    spec.rimW || 0,
    spec.rimT || 0,
    spec.bevel || 0,
    spec.templeLen || 0,
    spec.templeW || 0,
    spec.templeT || 0,
    spec.pantoDeg || 0,
    spec.wrapDeg || 0,
    spec.baseCurve || 0,
    spec.doubleBridge ? 1 : 0,
    spec.highBridge ? 1 : 0,
    spec.nosePads ? 1 : 0,
    spec.material === "metal" || spec.material === "titanium" || spec.material === "steel" ? "m" : "a",
    spec.size ? String(spec.size).replace(/[^0-9.]/g, "") : "",
    spec.catAmp || 0,
    spec.teardrop || 0,
    spec.exp || 0,
    spec.depth || 0,
  ].join("|");
  return k;
}

/** هندسهٔ کش‌شده (بدون متریال) */
export function frameGeometry(THREE, spec, opts = {}) {
  const key = frameKey(spec) + (opts.debug ? "#d" : "");
  let entry = geoCache.get(key);
  if (!entry) {
    const built = buildFrame(spec);
    const roles = {};
    for (const [role, g] of Object.entries(built.roles)) {
      const geo = toThreeGeometry(g, THREE);
      geo.computeBoundingSphere();
      roles[role] = geo;
    }
    entry = { roles, meta: built.meta, spec: built.spec, tris: built.meta.tris };
    geoCache.set(key, entry);
  }
  return entry;
}

/**
 * ساخت Group کامل فریم.
 * @param THREE  ماژول three
 * @param {object} product  { spec, finish, color, lens, ... }
 * @param {{quality:string, envIntensity:number, scene?:boolean, occluder:boolean}} opts
 */
export function createFrameObject(THREE, product, opts = {}) {
  const spec = product.spec || product;
  const quality = opts.quality || "high";
  const { roles, meta } = frameGeometry(THREE, spec, opts);
  const group = new THREE.Group();
  group.name = "frame";
  const mats = buildMaterials(THREE, {
    finish: product.finish || spec.finish,
    color: product.color || spec.color,
    lens: product.lens || spec.lens || "clear",
    quality,
    envIntensity: opts.envIntensity ?? 1,
    metal: spec.material,
    metalTint: product.metalTint || spec.metalTint,
    metalColor: product.metalColor || spec.metalColor,
    accentColor: product.accentColor || spec.accentColor,
    translucent: product.translucent ?? spec.translucent,
  });

  const order = { lens: 20, frame: 3, metal: 4, accent: 5, pad: 6, frameTip: 3 };
  for (const [role, geo] of Object.entries(roles)) {
    const mat = mats[role] || mats.frame;
    const mesh = new THREE.Mesh(
      geo,
      quality === "lite" && role === "lens" ? liteLens(THREE, mats.lens) : mat,
    );
    mesh.name = role;
    mesh.renderOrder = order[role] ?? 1;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }

  // «سر نامرئی»: فقط عمق می‌نویسد تا بخشی از دسته‌ها که پشت گونه/شقیقه است پنهان شود.
  // جلویش همیشه پشت صفحهٔ چشم است، پس هرگز روی عدسی و حلقهٔ فریم نمی‌افتد.
  let occluder = null;
  if (opts.occluder !== false) {
    occluder = createHeadOccluder(
      THREE,
      headOccluderParams({ frameHalfWidth: meta.hingeX || meta.size[0] / 2, faceWmm: opts.faceWmm, vertexDistance: opts.vertexDistance }),
    );
    group.add(occluder);
  }

  group.userData = {
    meta,
    specs: meta,
    mats,
    key: frameKey(spec),
    disposeAll() {
      for (const m of group.children) {
        if (m.isMesh && m.userData?.own) m.geometry.dispose();
      }
    },
  };
  group.updateMatrix();
  return {
    group,
    /** عوض‌کردن رنگ/عدسی بدون بازسازی هندسه */
    setVariant(product2) {
      const next = buildMaterials(THREE, {
        finish: product2.finish || spec.finish,
        color: product2.color || spec.color,
        lens: product2.lens || spec.lens || "clear",
        quality,
        envIntensity: opts.envIntensity ?? 1,
        metal: spec.material,
        metalTint: product2.metalTint || spec.metalTint,
        metalColor: product2.metalColor || spec.metalColor,
        accentColor: product2.accentColor || spec.accentColor,
        translucent: product2.translucent ?? spec.translucent,
      });
      for (const m of group.children) {
        if (!m.isMesh || m.name === "occluder") continue;
        const role = m.name;
        const mat = quality === "lite" && role === "lens" ? liteLens(THREE, next.lens) : next[role] || next.frame;
        m.material = mat;
      }
      for (const k of Object.keys(mats)) mats[k].dispose?.();
      group.userData.mats = next;
      return next;
    },
    /** «سر نامرئی» را با پهنای صورتِ اندازه‌گیری‌شده (mm) هم‌اندازه می‌کند */
    fitHead(faceWmm, vertexDistance) {
      if (!occluder) return null;
      const p = headOccluderParams({ frameHalfWidth: meta.hingeX || meta.size[0] / 2, faceWmm, vertexDistance });
      applyHeadOccluder(occluder, p);
      return p;
    },
    dispose() {
      for (const k of Object.keys(mats)) mats[k].dispose?.();
      // هندسهٔ فریم در کش است (برای تعویض آنی)؛ فقط سرِ نامرئی مالِ همین نمونه است
      if (occluder) {
        occluder.geometry.dispose();
        occluder.material.dispose();
      }
    },
  };
}

function liteLens(THREE, src) {
  const m = new THREE.MeshPhysicalMaterial({
    color: src.color.clone(),
    transparent: true,
    opacity: src.opacity > 0.5 ? 0.26 : 0.16,
    roughness: 0.05,
    metalness: src.metalness > 0.5 ? 0.85 : 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return m;
}

export function clearFrameCache() {
  for (const e of geoCache.values()) for (const g of Object.values(e.roles)) g.dispose();
  geoCache.clear();
}

export { buildFrame };
