/**
 * loaders.js — خواندن مدل GLB آماده (برای فروشگاه‌ای که مدل سه‌بعدی محصول را دارد)
 *
 * نرمال‌سازی: مرکز روی (0,0)، جلوی فریم روی z=0، و مقیاس به میلی‌متر واقعی
 * بر اساس «پهنای کل فریم» → پس مدلِ فروشنده هم مثل مدلِ رویه‌ای دقیقاً
 * هم‌اندازهٔ واقعی روی صورت می‌نشیند.
 */
export async function loadGLB(url, THREE, { totalWidth = 138, rotateDeg = [0, 0, 0], offset = [0, 0, 0], scale = 1 } = {}) {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js").catch(async () => {
    const m = await import("three/addons/loaders/GLTFLoader.js");
    return { GLTFLoader: m.GLTFLoader };
  });
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().load(url, resolve, undefined, reject));
  const root = gltf.scene || gltf.scenes[0];
  if (!root) throw new Error("GLB بدون مش: " + url);
  return normalizeGLB(root, THREE, { totalWidth, rotateDeg, offset, scale, url });
}

/** Keep the mm conversion on a CHILD: Stage owns the outer pose scale. */
export function normalizeGLB(root, THREE, { totalWidth = 138, rotateDeg = [0, 0, 0], offset = [0, 0, 0], scale = 1, url = "" } = {}) {
  const oriented = new THREE.Group();
  oriented.add(root);
  oriented.rotation.set(...rotateDeg.map(degrees => degrees * Math.PI / 180));
  oriented.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(oriented);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.x) || size.x <= 0) throw new Error("GLB has no usable geometry");
  const mmPerUnit = totalWidth / size.x;
  const units = new THREE.Group();
  // Nose/lens front plane, not the centre of the long temples behind the head.
  oriented.position.set(-center.x, -center.y, -box.max.z);
  units.add(oriented);
  units.scale.setScalar(mmPerUnit * scale);
  const holder = new THREE.Group();
  holder.add(units);
  const meta = {
    source: "glb", url, totalWidth, mmPerUnit,
    size: [size.x * mmPerUnit * scale, size.y * mmPerUnit * scale, size.z * mmPerUnit * scale],
    tris: countTris(root),
  };
  // Offset is also an inner transform so applying a face pose cannot erase it.
  units.position.set(...offset);
  return { group: holder, meta, root, materials: collectMaterials(root) };
}

export function disposeGLB(bundle) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  bundle.group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of [].concat(o.material || [])) materials.add(m);
  });
  for (const m of materials) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
  for (const set of [geometries, materials, textures]) for (const item of set) item.dispose();
}

function countTris(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry?.index) n += o.geometry.index.count / 3;
    else if (o.isMesh && o.geometry?.attributes?.position) n += o.geometry.attributes.position.count / 3;
  });
  return Math.round(n);
}

function collectMaterials(root) {
  const set = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m && set.add(m));
  });
  return [...set];
}

/** رنگ/جنس محصول را روی متریال‌های GLBِ فروشنده می‌نشاند */
export function tintGLB(bundle, { color, metalColor, opacity = 1 }) {
  if (!bundle) return;
  for (const m of bundle.materials) {
    const isLens = /lens|glass|tint/i.test(m.name || "");
    if (isLens) {
      // Preserve the vendor's optical/mirror material; recoloring the frame
      // must not turn every lens into the same 40%-opaque plastic.
      m.depthWrite = false;
      continue;
    }
    if (color) m.color = new (m.color.constructor)(color);
    if (metalColor && (m.metalness || 0) > 0.5) m.color = new (m.color.constructor)(metalColor);
    if (m.isMeshStandardMaterial) {
      m.roughness = Math.min(m.roughness ?? 0.4, 0.35);
      m.envMapIntensity = 1.2;
    }
    m.opacity = Math.min(m.opacity, opacity);
    m.transparent = m.transparent || opacity < 1;
    m.needsUpdate = true;
  }
}
