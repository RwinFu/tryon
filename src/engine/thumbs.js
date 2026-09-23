/**
 * thumbs.js — «عکس محصول خودکار»: تامبنیل هر فریم از همان هندسهٔ سه‌بعدی رندر می‌شود
 *
 * فروشگاه هیچ عکسی آپلود نمی‌کند؛ ردیف محصولات و کارت محصول همیشه عکسِ
 * دقیقاً هم‌رنگ/هم‌مدلِ انتخاب‌شده دارد.
 */
import { createFrameObject, frameKey } from "../frame/index.js";
import { buildStudioEnvironment } from "../frame/materials.js";
import { toEngineSpec } from "../frame/catalog.js";
import * as THREE_NS from "three";

let shared = null;
/** کش تامبنیل‌ها بین نمونه‌ها (inline + overlay + کارت‌های فروشگاه همان فریم را دوباره رندر نمی‌کنند) */
const urlCache = new Map();
const CACHE_MAX = 240;
const thumbKey = (p, spec, W, H, quality, bg) =>
  [frameKey(spec), p.finish, p.color, JSON.stringify(p.lens || "clear"), p.metalTint, p.metalColor, p.accentColor, p.translucent, W, H, quality, bg || ""].join("|");

export async function renderThumbnails(products, opts = {}) {
  if (typeof document === "undefined") throw new Error("renderThumbnails در مرورگر کار می‌کند (به WebGL نیاز دارد).");
  const THREE = opts.THREE || THREE_NS;
  const quality = opts.quality || "high";
  const { size = 220, ratio = 0.42, yaw = 0.5, pitch = 0.16, bg = null } = opts;
  const W = size,
    H = Math.round(size * ratio);
  if (!shared || shared.W !== W) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: !bg, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.setSize(W, H, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.environment = buildStudioEnvironment(THREE, renderer, { warmth: 0.1 });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x30353c, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-1.4, 2.2, 3.4);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(26, W / H, 1, 4000);
    shared = { canvas, renderer, scene, camera, key, W, H };
  }
  const { renderer, scene, camera, canvas } = shared;
  const urls = [];
  for (const p of products) {
    const spec = p.spec || toEngineSpec(p);
    const ck = thumbKey(p, spec, W, H, quality, bg);
    if (urlCache.has(ck)) {
      urls.push(urlCache.get(ck));
      continue;
    }
    const obj = createFrameObject(THREE, { ...spec, ...pick(p, ["finish", "color", "lens", "metalTint", "metalColor", "accentColor", "translucent"]) }, {
      quality,
      occluder: false,
      envIntensity: 1,
    });
    const g = obj.group;
    g.traverse((o) => o.isMesh && (o.matrixAutoUpdate = true));
    scene.add(g);
    const size3 = new THREE.Box3().setFromObject(g);
    const sph = size3.getBoundingSphere(new THREE.Sphere());
    const dist = (sph.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.18;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
    camera.position.copy(sph.center).addScaledVector(dir, dist);
    camera.lookAt(sph.center);
    camera.updateProjectionMatrix();
    if (bg) {
      renderer.setClearColor(new THREE.Color(bg), 1);
    } else renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const url = canvas.toDataURL("image/png");
    if (urlCache.size >= CACHE_MAX) urlCache.delete(urlCache.keys().next().value);
    urlCache.set(ck, url);
    urls.push(url);
    scene.remove(g);
    obj.dispose();
    await new Promise((r) => setTimeout(r, 0));
  }
  return urls;
}

/** یک فریم را با زاویه‌های داده‌شده رندر می‌کند (استودیو/کارت محصول) */
export function renderStill(product, THREE, opts = {}) {
  return renderThumbnails([product], opts).then((a) => a[0]);
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
