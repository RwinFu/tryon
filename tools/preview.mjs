/**
 * tools/preview.mjs — رندرر نرم‌افزاری (CPU) برای بازبینی هندسه و متریال
 * بدون GPU و بدون مرورگر: خروجی PNG تا چشم‌انداز کار را بشکنیم.
 *
 *   node tools/preview.mjs --spec '{"shape":"cateye"}' --out /tmp/a.png --views 4
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildFrame } from "../src/frame/geometry.js";

const THREE = await import("three");

const W = 480,
  H = 380;

const VIEWS = [
  { name: "front", yaw: 0, pitch: 0.02 },
  { name: "three-quarter", yaw: -0.62, pitch: 0.22 },
  { name: "side", yaw: -1.45, pitch: 0.12 },
  { name: "top", yaw: -0.5, pitch: 0.95 },
];

const MATERIALS = {
  frame: { color: "#1b1c1f", metalness: 0.0, roughness: 0.16, clear: 0.9, spec: 0.62 },
  metal: { color: "#c9ccd2", metalness: 1.0, roughness: 0.24, spec: 1.1 },
  accent: { color: "#b9922f", metalness: 1.0, roughness: 0.35, spec: 1.0 },
  frameTip: { color: "#1b1c1f", metalness: 0.0, roughness: 0.2, spec: 0.6 },
  lens: { color: "#8fa4ad", metalness: 0.0, roughness: 0.03, alpha: 0.22, spec: 1.3, glass: true },
  pad: { color: "#d8d8d2", metalness: 0, roughness: 0.55, spec: 0.2 },
};

function renderMeshes(meshes, cam, fb, zbuf) {
  const { pos, eye, right, up, cx, cy, fpx } = cam;
  for (const m of meshes) {
    const { position, normal, index, mat } = m;
    for (let t = 0; t < index.length; t += 3) {
      const tri = [0, 1, 2].map((k) => {
        const i = index[t + k] * 3;
        const v = new THREE.Vector3(position[i], position[i + 1], position[i + 2]);
        const rel = v.clone().sub(eye);
        const zc = Math.max(1, rel.dot(cam.dir));
        return { sx: cx + (rel.dot(right) / zc) * fpx, sy: cy - (rel.dot(up) / zc) * fpx, z: rel.dot(cam.dir), p: v };
      });
      if (tri.some((v) => !isFinite(v.sx) || !isFinite(v.sy) || !isFinite(v.z))) continue;
      const minX = Math.max(0, Math.floor(Math.min(tri[0].sx, tri[1].sx, tri[2].sx)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(tri[0].sx, tri[1].sx, tri[2].sx)));
      const minY = Math.max(0, Math.floor(Math.min(tri[0].sy, tri[1].sy, tri[2].sy)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(tri[0].sy, tri[1].sy, tri[2].sy)));
      if (minX > maxX || minY > maxY) continue;
      const area =
        (tri[1].sx - tri[0].sx) * (tri[2].sy - tri[0].sy) - (tri[2].sx - tri[0].sx) * (tri[1].sy - tri[0].sy);
      if (Math.abs(area) < 1e-6) continue;
      const faceN = tri[0].p
        .clone()
        .sub(tri[1].p)
        .cross(tri[2].p.clone().sub(tri[1].p))
        .normalize();
      const facing = faceN.dot(cam.dir) < 0 ? 1 : -1;
      const center = tri[0].p.clone().add(tri[1].p).add(tri[2].p).multiplyScalar(1 / 3);
      const shade = shadePoint(facing > 0 ? faceN : faceN.clone().negate(), center, mat, cam, eye);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5,
            py = y + 0.5;
          let w0 = (tri[1].sx - px) * (tri[2].sy - py) - (tri[2].sx - px) * (tri[1].sy - py);
          let w1 = (tri[2].sx - px) * (tri[0].sy - py) - (tri[0].sx - px) * (tri[2].sy - py);
          let w2 = (tri[0].sx - px) * (tri[1].sy - py) - (tri[1].sx - px) * (tri[0].sy - py);
          if (area > 0) {
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          } else {
            if (w0 > 0 || w1 > 0 || w2 > 0) continue;
            w0 = -w0;
            w1 = -w1;
            w2 = -w2;
          }
          const zz = (w0 * tri[0].z + w1 * tri[1].z + w2 * tri[2].z) / (w0 + w1 + w2);
          const idx = y * W + x;
          if (zz >= zbuf[idx]) continue;
          zbuf[idx] = zz;
          if (mat.glass && fb.depthOnly) continue;
          const o = idx * 4;
          const a = mat.alpha ?? 1;
          fb.data[o] = fb.data[o] * (1 - a) + shade[0] * a;
          fb.data[o + 1] = fb.data[o + 1] * (1 - a) + shade[1] * a;
          fb.data[o + 2] = fb.data[o + 2] * (1 - a) + shade[2] * a;
          fb.data[o + 3] = 255;
        }
      }
    }
  }
}

const LIGHTS = [
  { dir: new THREE.Vector3(-0.4, 0.75, 0.9).normalize(), color: [1, 0.98, 0.95], power: 1.05 },
  { dir: new THREE.Vector3(0.8, 0.25, 0.5).normalize(), color: [0.72, 0.8, 0.95], power: 0.42 },
  { dir: new THREE.Vector3(0.1, -0.6, -0.75).normalize(), color: [0.5, 0.48, 0.5], power: 0.28 },
];

function shadePoint(n, p, mat, cam, eye) {
  const _c = new THREE.Color(mat.color);
  const base = [_c.r, _c.g, _c.b];
  const view = eye.clone().sub(p).normalize();
  let out = [base[0] * 12, base[1] * 12, base[2] * 12];
  const metal = mat.metalness ?? 0;
  for (const L of LIGHTS) {
    const ndl = Math.max(0, n.dot(L.dir));
    const amb = 0.3 + 0.24 * n.y;
    const diff = ndl * L.power;
    const hv = L.dir.clone().add(view).normalize();
    const specK = Math.max(0, n.dot(hv)) ** (mat.glass ? 140 : 26 + (1 - mat.roughness) * 220);
    const spec = specK * (mat.spec || 0.5) * (0.25 + metal) * L.power;
    for (let c = 0; c < 3; c++) {
      const tint = base[c];
      out[c] += (amb * 0.55 + diff) * (metal ? tint * 250 : 250 * (tint * 0.82 + 0.16)) * L.color[c];
      out[c] += spec * 255 * (mat.glass ? 1 : 0.85);
    }
  }
  // فرزنل: لبه‌ها روشن‌تر (پلاستیک صیقلی)
  const fres = (1 - Math.max(0, n.dot(view))) ** 3;
  for (let c = 0; c < 3; c++) out[c] += fres * (metal ? 90 : 44) * (0.4 + (1 - mat.roughness));
  return out.map((v) => Math.max(0, Math.min(255, v)));
}

function makeCam(meta, view, scale = 1) {
  const target = new THREE.Vector3(meta.center[0], meta.center[1] * 0.6, meta.center[2] * 0.9);
  const dist = 300;
  // dir = جهت نگاه دوربین (از چشم به سوژه)
  const dir = new THREE.Vector3(
    -Math.sin(view.yaw) * Math.cos(view.pitch),
    -Math.sin(view.pitch),
    -Math.cos(view.yaw) * Math.cos(view.pitch),
  ).normalize();
  const eye = target.clone().add(dir.clone().multiplyScalar(-dist));
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const trueUp = new THREE.Vector3().crossVectors(right, dir).normalize();
  return { dir, eye, right, up: trueUp, cx: W / 2, cy: H / 2, fpx: 640 * scale };
}

function collectMeshes(frame, overrides = {}) {
  const meshes = [];
  for (const [role, geo] of Object.entries(frame.roles)) {
    const mat = { ...MATERIALS[role], ...overrides[role] };
    meshes.push({
      position: Float32Array.from(geo.position),
      normal: Float32Array.from(geo.normal),
      index: Array.from(geo.index),
      mat,
      role,
    });
  }
  return meshes;
}


/** رندر یک نما به بافر RGBA */
function renderView(frame, view, bg = "#14181d", scale = 1) {
  const meshes = collectMeshes(frame, frame.spec.materials || {});
  const cam = makeCam(frame.meta, view, scale);
  const buf = Buffer.alloc(W * H * 4);
  const b = new THREE.Color(bg);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = 0.72 + (y / H) * 0.5;
      const o = (y * W + x) * 4;
      buf[o] = Math.min(255, b.r * 255 * g + 6);
      buf[o + 1] = Math.min(255, b.g * 255 * g + 7);
      buf[o + 2] = Math.min(255, b.b * 255 * g + 9);
      buf[o + 3] = 255;
    }
  }
  const zbuf = new Float32Array(W * H).fill(1e9);
  renderMeshes(meshes, cam, { data: buf }, zbuf);
  return buf;
}

export async function previewFrame(specIn, outPrefix, { views = 4, bg = "#14181d" } = {}) {
  const specs = Array.isArray(specIn) ? specIn : [specIn];
  const used = VIEWS.slice(0, Math.max(1, Math.min(views, VIEWS.length)));
  const cols = used.length,
    rows = specs.length;
  const sheet = Buffer.alloc(W * cols * H * rows * 4);
  const metas = [];
  for (let r = 0; r < rows; r++) {
    const f = buildFrame(specs[r]);
    metas.push({
      name: specs[r].name || specs[r].shape,
      size: f.meta.size.map((n) => +n.toFixed(1)),
      tris: f.meta.tris,
      verts: Object.values(f.roles).reduce((a, g) => a + g.vertexCount, 0),
    });
    for (let c = 0; c < cols; c++) {
      const buf = renderView(f, used[c], bg);
      for (let y = 0; y < H; y++) {
        const d = ((r * H + y) * W * cols + c * W) * 4;
        buf.copy(sheet, d, y * W * 4, (y + 1) * W * 4);
      }
    }
  }
  const file = `${outPrefix}.png`;
  await sharp(sheet, { raw: { width: W * cols, height: H * rows, channels: 4 } }).png().toFile(file);
  return { file, metas, views: used.map((v) => v.name) };
}


// CLI
if (process.argv[1] && process.argv[1].endsWith("preview.mjs")) {
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const specs = JSON.parse(get("specs", "null")) || [JSON.parse(get("spec", "{}"))];
  const out = get("out", "/tmp/tryon-preview.png");
  const res = await previewFrame(specs, out.replace(/\.png$/, ""), { views: +get("views", 4) });
  console.log(JSON.stringify(res.metas || res.meta), res.files.join(" "));
}
