/**
 * tools/seat-preview.mjs — رندر نرم‌افزاریِ «عینک روی عکس» برای بازبینیِ نشست
 *
 * بدون مرورگر/GPU، همان ریاضیِ Stage.place را اجرا می‌کند و فریم را با
 * z-buffer روی عکس می‌نشاند. مشِ صورت از همان ۴۶۸ لندمارک + توپولوژیِ رسمیِ
 * MediaPipe ساخته می‌شود تا بینی/گونهٔ واقعی، دسته و عدسیِ دور را بپوشاند.
 *
 *   node tools/seat-preview.mjs --photo a.jpg --landmarks a.json --out a.png
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as THREE from "three";
import { FaceTracker } from "../src/engine/tracking.js";
import { buildFrame } from "../src/frame/geometry.js";
import { buildSeat, seatOffsetsFor, seatToPose } from "../src/engine/seating.js";
import { fitCanonicalHead, headToPx, EYE } from "../src/engine/head-fit.js";
import { toEngineSpec, CATALOG } from "../src/frame/catalog.js";
import { FACE_TRIS, CANONICAL_MM } from "../src/engine/face-topology.js";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const photoPath = arg("photo", "test/fixtures/astronaut.jpg");
const lmPath = arg("landmarks", ".cache/lm-astronaut.json");
const outPath = arg("out", ".cache/seat.png");
const sku = arg("sku", null);
const mode = arg("mode", "new");
const scaleOut = +arg("scale", 1);

/**
 * `--photo head` : به‌جای عکس، سرِ کانونیک با همان لندمارک‌ها رندر می‌شود.
 * این «ریگِ حقیقتِ مبنا» است: تصویر و لندمارک از یک هندسه می‌آیند، پس هر
 * خطای نشستن (شناوریِ پل، اندازه، چرخش) بی‌ابهام دیده می‌شود.
 */
const synthetic = photoPath === "head";
const synthYaw = +arg("yaw", 0), synthPitch = +arg("pitch", 0);
let data;
if (synthetic) {
  const { CANONICAL_MM } = await import("../src/engine/face-topology.js");
  const { quatFromEuler, matFromQuat } = await import("../src/engine/head-fit.js");
  const W0 = 512, H0 = 512, camZ0 = 0.75 * Math.max(W0, H0);
  const D = Math.PI / 180;
  const sc = +arg("headscale", 0.63);
  const q0 = quatFromEuler(synthPitch * D, synthYaw * D, 0);
  const R0 = matFromQuat(q0);
  const ctr = [0, 10, 20], anchor0 = [256, 170];
  const lms = [];
  for (let i = 0; i < 478; i++) {
    const x = (CANONICAL_MM[i * 3] ?? 0) - ctr[0];
    const y = (CANONICAL_MM[i * 3 + 1] ?? 10) - ctr[1];
    const z = (CANONICAL_MM[i * 3 + 2] ?? 0) - ctr[2];
    const rx = R0[0] * x + R0[1] * y + R0[2] * z;
    const ry = R0[3] * x + R0[4] * y + R0[5] * z;
    const rz = R0[6] * x + R0[7] * y + R0[8] * z;
    const mag = camZ0 / (camZ0 - rz * sc);
    lms.push({ x: (W0 / 2 + (anchor0[0] - W0 / 2 + rx * sc) * mag) / W0, y: (anchor0[1] - ry * sc * mag) / H0, z: 0 });
  }
  data = { W: W0, H: H0, landmarks: lms };
} else {
  data = JSON.parse(fs.readFileSync(lmPath, "utf8"));
}
const W = data.W, H = data.H;

const oldDoc = globalThis.document;
globalThis.document = { createElement: () => ({ getContext: () => null }) };
const tracker = new FaceTracker({ pd: +arg("pd", 63), autoPd: arg("autopd", "0") === "1" });
globalThis.document = oldDoc;
tracker.resize(W, H);
const pose = tracker.solve(
  {
    faceLandmarks: [data.landmarks],
    facialTransformationMatrices: data.matrix ? [{ data: data.matrix }] : [],
  },
  1000,
);

const product = sku ? CATALOG.find((p) => p.id === sku || p.sku === sku) || CATALOG[0] : CATALOG.find((p) => p.shape === arg("shape", "wayfarer")) || CATALOG[0];
const spec = toEngineSpec(product);
const built = buildFrame(spec);
const meta = built.meta;

// ── دوربینِ همان Stage
const camZ = pose.camZ;
const fov = (2 * Math.atan(H / (2 * camZ)) * 180) / Math.PI;
const camera = new THREE.PerspectiveCamera(fov, W / H, camZ * 0.02, camZ * 12);
camera.position.set(0, 0, camZ);
camera.lookAt(0, 0, 0);
camera.updateProjectionMatrix();

const fit = fitCanonicalHead(data.landmarks, { W, H });
let group;
let seat = null;
if (mode === "new") {
  // همان مسیری که Stage در تولید استفاده می‌کند
  const offsets = seatOffsetsFor(spec);
  seat = seatToPose(offsets, pose, W, H, { camZ, vgMm: pose.vgMm, scale: fit.scale });
  group = new THREE.Group();
  group.position.set(seat.x, seat.y, seat.z);
  group.quaternion.set(...seat.q);
  group.scale.setScalar(seat.scale);
} else {
  const seatY = -2.4 * pose.scale * ((camZ - pose.z) / camZ); // همان bridgeSeatAdjustment فعلی برای نمونه
  group = new THREE.Group();
  group.position.set(
    (pose.x - W / 2) * ((camZ - pose.z) / camZ),
    (H / 2 - pose.y) * ((camZ - pose.z) / camZ) + Math.abs(seatY),
    pose.z,
  );
  group.quaternion.set(...pose.q);
  group.scale.setScalar(pose.scale);
}
group.updateMatrixWorld(true);

const fb = new Float32Array(W * H * 3);
if (synthetic) {
  for (let i = 0; i < W * H; i++) {
    fb[i * 3] = 32; fb[i * 3 + 1] = 36; fb[i * 3 + 2] = 44;
  }
} else {
  const photo = await sharp(photoPath).ensureAlpha().resize(W, H, { fit: "fill" }).raw().toBuffer();
  for (let i = 0; i < W * H; i++) {
    fb[i * 3] = photo[i * 4];
    fb[i * 3 + 1] = photo[i * 4 + 1];
    fb[i * 3 + 2] = photo[i * 4 + 2];
  }
}
const zbuf = new Float32Array(W * H).fill(1e9);

const project = (v) => {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H, z: p.z };
};

/**
 * مشِ صورت برای انسداد — از سرِ کانونیکِ برازش‌شده ساخته می‌شود تا عمقش با
 * همان هندسه‌ای هم‌خوان باشد که عینک رویش می‌نشیند (z لندمارکِ خام پرنویز است).
 */
function faceMesh() {
  const pos = new Float32Array(468 * 3);
  const k = seat ? 1 / Math.max(1e-6, fit.scale) : 1;
  for (let i = 0; i < 468; i++) {
    const p = [fit.canonical[i * 3], fit.canonical[i * 3 + 1], fit.canonical[i * 3 + 2]];
    const [u, v, zRel] = headToPx(fit, p);
    const kk = camZ / (camZ - zRel);
    // مختصاتِ صحنه: (u-W/2)*kk، y بالا، z = zRel — همان قراردادِ Stage
    pos[i * 3] = (u - W / 2) * kk;
    pos[i * 3 + 1] = (v - H / 2) * kk;
    pos[i * 3 + 2] = zRel;
  }
  void k;
  return { pos, tris: FACE_TRIS };
}

function rasterFace(mesh) {
  const S = [];
  for (let i = 0; i < 468; i++) {
    const v = new THREE.Vector3(mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]);
    S.push(project(v));
  }
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const a = S[mesh.tris[t]], b = S[mesh.tris[t + 1]], c = S[mesh.tris[t + 2]];
    if (!a || !b || !c) continue;
    fillTri(a, b, c, zbuf, () => {}, null);
  }
}

function fillTri(a, b, c, zb, shadeFn, mat) {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  if (minX > maxX || minY > maxY) return;
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-9) return;
  const alpha = mat?.alpha ?? 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = (b.x - px) * (c.y - py) - (c.x - px) * (b.y - py);
      let w1 = (c.x - px) * (a.y - py) - (a.x - px) * (c.y - py);
      let w2 = (a.x - px) * (b.y - py) - (b.x - px) * (a.y - py);
      if (area > 0) { if (w0 < 0 || w1 < 0 || w2 < 0) continue; }
      else { if (w0 > 0 || w1 > 0 || w2 > 0) continue; w0 = -w0; w1 = -w1; w2 = -w2; }
      const zz = (w0 * a.z + w1 * b.z + w2 * c.z) / (w0 + w1 + w2);
      const idx = y * W + x;
      if (zz >= zb[idx]) continue;
      zb[idx] = zz;
      if (!mat) continue;
      const col = shadeFn();
      const o = idx * 3;
      fb[o] = fb[o] * (1 - alpha) + col[0] * alpha;
      fb[o + 1] = fb[o + 1] * (1 - alpha) + col[1] * alpha;
      fb[o + 2] = fb[o + 2] * (1 - alpha) + col[2] * alpha;
    }
  }
}

// انسداد صورت (+ رندرِ پوست در حالتِ مصنوعی، در همان پاس تا z-fighting نباشد)
const face = faceMesh();
if (synthetic) {
  const S = [];
  for (let i = 0; i < 468; i++) S.push(project(new THREE.Vector3(face.pos[i * 3], face.pos[i * 3 + 1], face.pos[i * 3 + 2])));
  const L = new THREE.Vector3(-0.35, 0.55, 0.75).normalize();
  for (let t = 0; t < face.tris.length; t += 3) {
    const ia = face.tris[t], ib = face.tris[t + 1], ic = face.tris[t + 2];
    const A = new THREE.Vector3(face.pos[ia * 3], face.pos[ia * 3 + 1], face.pos[ia * 3 + 2]);
    const B = new THREE.Vector3(face.pos[ib * 3], face.pos[ib * 3 + 1], face.pos[ib * 3 + 2]);
    const C = new THREE.Vector3(face.pos[ic * 3], face.pos[ic * 3 + 1], face.pos[ic * 3 + 2]);
    const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
    const view = new THREE.Vector3(0, 0, 1e4).sub(A).normalize();
    if (n.dot(view) < 0) n.negate();
    const l = Math.max(0, n.dot(L));
    const col = [188 * (0.32 + 0.8 * l), 136 * (0.32 + 0.8 * l), 116 * (0.32 + 0.8 * l)];
    fillTri(S[ia], S[ib], S[ic], zbuf, () => col, { alpha: 1 });
  }
} else {
  rasterFace(face);
}

// نور
const LIGHTS = [
  { dir: new THREE.Vector3(-0.4, 0.75, 0.9).normalize(), color: [1, 0.98, 0.95], power: 1.05 },
  { dir: new THREE.Vector3(0.8, 0.25, 0.5).normalize(), color: [0.72, 0.8, 0.95], power: 0.42 },
];
const MATS = {
  frame: { color: "#23252a", metalness: 0, roughness: 0.2, spec: 0.6 },
  metal: { color: "#c9ccd2", metalness: 1, roughness: 0.25, spec: 1.0 },
  accent: { color: "#b9922f", metalness: 1, roughness: 0.35, spec: 1.0 },
  frameTip: { color: "#1b1c1f", metalness: 0, roughness: 0.25, spec: 0.6 },
  pad: { color: "#d8d8d2", metalness: 0, roughness: 0.55, spec: 0.2 },
  lens: { color: "#7fa7b5", metalness: 0, roughness: 0.03, alpha: 0.22, spec: 1.2, glass: true },
  lensEdge: { color: "#9fb6c0", metalness: 0, roughness: 0.1, alpha: 0.5, spec: 1 },
};
const base = new THREE.Color("#23252a").toArray();

function shadeFor(role) {
  const mat = MATS[role] || MATS.frame;
  const c = new THREE.Color(mat.color);
  const b = [c.r, c.g, c.b];
  return (n, view) => {
    let out = b.map((v) => v * 40);
    for (const L of LIGHTS) {
      const ndl = Math.max(0, n.dot(L.dir));
      const hv = L.dir.clone().add(view).normalize();
      const spec = Math.max(0, n.dot(hv)) ** (mat.glass ? 120 : 40) * mat.spec * 255 * 0.5;
      for (let k = 0; k < 3; k++) out[k] += (0.35 + ndl) * (mat.metalness ? b[k] * 220 : 210) * L.color[k] * 0.55 + spec;
    }
    return out.map((v) => Math.max(0, Math.min(255, v)));
  };
}

const eye = new THREE.Vector3(0, 0, camZ);
for (const [role, geo] of Object.entries(built.roles)) {
  if (!MATS[role]) continue;
  const mat = MATS[role];
  const world = [];
  for (let i = 0; i < geo.position.length; i += 3) {
    const v = new THREE.Vector3(geo.position[i], geo.position[i + 1], geo.position[i + 2]).applyMatrix4(group.matrixWorld);
    world.push(v);
  }
  const S = world.map(project);
  const shader = shadeFor(role);
  for (let t = 0; t < geo.index.length; t += 3) {
    const ia = geo.index[t], ib = geo.index[t + 1], ic = geo.index[t + 2];
    const A = world[ia], B = world[ib], C = world[ic];
    const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
    const view = eye.clone().sub(A.clone().add(B).add(C).multiplyScalar(1 / 3)).normalize();
    if (n.dot(view) < 0) n.negate();
    const col = shader(n, view);
    fillTri(S[ia], S[ib], S[ic], zbuf, () => col, mat);
  }
}

// خروجی
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  out[i * 4] = Math.round(fb[i * 3]);
  out[i * 4 + 1] = Math.round(fb[i * 3 + 1]);
  out[i * 4 + 2] = Math.round(fb[i * 3 + 2]);
  out[i * 4 + 3] = 255;
}
let img = sharp(out, { raw: { width: W, height: H, channels: 4 } });
if (scaleOut && scaleOut !== 1) img = img.resize(Math.round(W * scaleOut), null, { kernel: "nearest" });
await img.png().toFile(outPath);
console.log("wrote", outPath, `${W}x${H}`, "mode", mode, "product", product.id, "shape", product.shape, "| face", pose.faceWmm?.toFixed(1), "mm | scale", pose.scale.toFixed(3));
if (mode === "new") console.log("seat:", JSON.stringify(seat?.report || {}, null, 0));
