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
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const spanX = Math.max(0.0001, size.x);
  const mmPerUnit = totalWidth / spanX;
  const holder = new THREE.Group();
  root.position.sub(center);
  root.updateMatrixWorld(true);
  holder.add(root);
  holder.scale.setScalar(mmPerUnit * scale);
  holder.rotation.set((rotateDeg[0] * Math.PI) / 180, (rotateDeg[1] * Math.PI) / 180, (rotateDeg[2] * Math.PI) / 180);
  holder.position.set(offset[0] * 1, offset[1] * 1, offset[2] * 1);
  const meta = {
    source: "glb",
    url,
    totalWidth,
    mmPerUnit,
    size: [size.x * mmPerUnit, size.y * mmPerUnit, size.z * mmPerUnit],
    tris: countTris(root),
  };
  // متریال‌ها: اگر فروشنده رنگ نفرستاده، همان را نگه می‌داریم؛ اگر فریم رنگی دارد، اعمال می‌کنیم
  return { group: holder, meta, root, materials: collectMaterials(root) };
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
      m.transparent = true;
      m.opacity = Math.min(m.opacity, 0.4);
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
