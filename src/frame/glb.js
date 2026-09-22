/**
 * glb.js — خروجی GLB (glTF 2.0 binary) از موتور هندسه، بدون وابستگی به three
 *
 * کاربردها:
 *  • فایل آماده برای «مدل سه‌بعدی محصول» در Shopify/WooCommerce و AR Quick Look آیفون
 *  • بایک کردن کاتالوگ در CI (tools/bake.mjs) تا سایتِ فروشگاه فایل استاتیک داشته باشد
 *  • وارد کردن مدل در Blender/Substance برای رندر تبلیغاتی
 */
import { buildFrame } from "./geometry.js";
import { FINISHES } from "./materials.js";

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const ALIGN = (n, a = 4) => Math.ceil(n / a) * a;

/** متریال‌های افزودهٔ glTF که خروجی ما استفاده می‌کند */
const EXTENSIONS = ["KHR_materials_clearcoat", "KHR_materials_ior", "KHR_materials_transmission", "KHR_materials_volume"];

/**
 * @param {object} spec  همان spec موتور (میلی‌متر)
 * @param {{name?:string, finish?:string, color?:string, metalColor?:string, lens?:string|object, doubleSided?:boolean}} opts
 * @returns {Uint8Array}
 */
export function exportGLB(spec = {}, opts = {}) {
  const built = buildFrame({ ...spec, ...opts.spec });
  return packGLB(built, opts);
}

export function packGLB(built, opts = {}) {
  const json = {
    asset: { version: "2.0", generator: "tryon-studio 2.0 (procedural eyewear)" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: opts.name || "eyewear-frame", mesh: 0 }],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
    extensionsUsed: EXTENSIONS,
  };
  const bins = [];
  let byteOffset = 0;
  const bytes = (data) =>
    data instanceof Uint8Array || data instanceof Float32Array || data instanceof Uint16Array || data instanceof Uint32Array
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
      : new Uint8Array(data);
  const pushView = (data, target) => {
    const buf = bytes(data);
    const pad = ALIGN(buf.length) - buf.length;
    const view = { buffer: 0, byteOffset, byteLength: buf.length };
    if (target) view.target = target;
    json.bufferViews.push(view);
    bins.push(buf);
    if (pad) bins.push(new Uint8Array(pad));
    byteOffset += buf.length + pad;
    return json.bufferViews.length - 1;
  };

  const ROLE_MAT = {
    frame: () => matFrom(opts.color || opts.finish || built.spec.finish || built.spec.color, built.spec, "frame", opts),
    frameTip: () => matFrom(opts.color || opts.finish || built.spec.finish || built.spec.color, built.spec, "frame", opts),
    metal: () => metalMat(opts, built.spec),
    accent: () => ({ name: "hardware", pbrMetallicRoughness: { baseColorFactor: [...hex(opts.accentColor || "#c9a45e"), 1], metallicFactor: 1, roughnessFactor: 0.3 }, doubleSided: true }),
    lens: () => lensMat(opts.lens || built.spec.lens),
    pad: () => ({ name: "nose-pad", pbrMetallicRoughness: { baseColorFactor: [...hex("#e6e4dc"), 1], metallicFactor: 0, roughnessFactor: 0.5 }, doubleSided: true }),
  };

  const primitives = [];
  for (const [role, g] of Object.entries(built.roles)) {
    if (!g.position.length) continue;
    const pos = Float32Array.from(g.position);
    const nrm = Float32Array.from(g.normal);
    const uv = Float32Array.from(g.uv);
    const idx = g.vertexCount > 65535 ? Uint32Array.from(g.index) : Uint16Array.from(g.index);
    const vPos = pushView(pos, 34962);
    const vNrm = pushView(nrm, 34962);
    const vUv = pushView(uv, 34962);
    const vIdx = pushView(idx, 34963);
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]);
      maxX = Math.max(maxX, pos[i]);
      minY = Math.min(minY, pos[i + 1]);
      maxY = Math.max(maxY, pos[i + 1]);
      minZ = Math.min(minZ, pos[i + 2]);
      maxZ = Math.max(maxZ, pos[i + 2]);
    }
    json.accessors.push({
      bufferView: vPos,
      componentType: 5126,
      count: pos.length / 3,
      type: "VEC3",
      min: [minX, minY, minZ].map((v) => +v.toFixed(4)),
      max: [maxX, maxY, maxZ].map((v) => +v.toFixed(4)),
    });
    json.accessors.push({ bufferView: vNrm, componentType: 5126, count: nrm.length / 3, type: "VEC3" });
    json.accessors.push({ bufferView: vUv, componentType: 5126, count: uv.length / 2, type: "VEC2" });
    json.accessors.push({
      bufferView: vIdx,
      componentType: g.vertexCount > 65535 ? 5125 : 5123,
      count: idx.length,
      type: "SCALAR",
    });
    const a0 = json.accessors.length - 4;
    json.materials.push((ROLE_MAT[role] || ROLE_MAT.frame)());
    primitives.push({
      attributes: { POSITION: a0, NORMAL: a0 + 1, TEXCOORD_0: a0 + 2 },
      indices: a0 + 3,
      material: json.materials.length - 1,
      mode: 4,
    });
  }
  json.meshes.push({ name: "frame", primitives });

  const bin = concat(bins);
  json.buffers.push({ byteLength: bin.length });
  const jsonBuf = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = ALIGN(jsonBuf.length) - jsonBuf.length;
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  const u32 = (v) => {
    dv.setUint32(off, v, true);
    off += 4;
  };
  let off = 0;
  u32(MAGIC);
  u32(2);
  u32(total);
  u32(jsonBuf.length + jsonPad);
  u32(CHUNK_JSON);
  out.set(jsonBuf, off);
  off += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) out[off++] = 0x20; // پد JSON با فاصله (مجاز در spec)
  u32(bin.length);
  u32(CHUNK_BIN);
  out.set(bin, off);
  return out;
}

function hex(c) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || "#222428"));
  let v = m ? m[1] : "222428";
  if (v.length === 3) v = v.split("").map((x) => x + x).join("");
  const n = parseInt(v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function matFrom(colorOrFinish, spec, role, opts) {
  const f = FINISHES[colorOrFinish] ? { key: colorOrFinish, ...(FINISHES[colorOrFinish] || {}) } : { key: "custom", color: colorOrFinish };
  const c = hex(opts.color || f.color || "#222428");
  const translucent = opts.translucent ?? f.translucent ?? 0;
  const m = {
    name: "frame-" + (f.key || "custom"),
    pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0.02, roughnessFactor: f.roughness ?? 0.12 },
    doubleSided: true,
    extensions: {
      KHR_materials_clearcoat: { clearcoatFactor: f.kind === "matte" ? 0.15 : 1, clearcoatRoughnessFactor: f.kind === "matte" ? 0.6 : 0.04 },
      KHR_materials_ior: { ior: 1.5 },
    },
  };
  if (translucent > 0.02) {
    m.extensions.KHR_materials_transmission = { transmissionFactor: Math.min(0.8, translucent) };
    m.extensions.KHR_materials_volume = { thicknessFactor: 3.2, attenuationColor: c, attenuationDistance: 6 };
  }
  return m;
}

function metalMat(opts, spec) {
  const key = opts.metalFinish || spec.material || "polished";
  const c = hex(opts.metalColor || FINISHES[opts.metalTint]?.color || "#cfd3d8");
  return {
    name: "metal-" + key,
    pbrMetallicRoughness: {
      baseColorFactor: [...c, 1],
      metallicFactor: 1,
      roughnessFactor: key === "titanium" ? 0.44 : key === "brushed" ? 0.4 : 0.16,
    },
    doubleSided: true,
    extensions: { KHR_materials_ior: { ior: 2.0 } },
  };
}

function lensMat(lens) {
  const o = typeof lens === "string" ? { type: lens } : lens || {};
  const density = o.tint ?? (o.type === "clear" ? 0.05 : 0.5);
  const c = hex(o.color || (o.type === "clear" ? "#eaf1f4" : "#3a3a3e"));
  const m = {
    name: "lens-" + (o.type || "clear"),
    pbrMetallicRoughness: {
      baseColorFactor: [...c, o.type === "clear" ? 0.35 : 0.85],
      metallicFactor: o.type === "mirror" ? 0.9 : 0,
      roughnessFactor: o.type === "mirror" ? 0.08 : 0.03,
    },
    doubleSided: true,
    alphaMode: o.type === "clear" ? "BLEND" : density > 0.8 ? "OPAQUE" : "BLEND",
    extensions: {
      KHR_materials_ior: { ior: o.ior || 1.53 },
      KHR_materials_transmission: { transmissionFactor: o.type === "mirror" ? 0 : Math.max(0.25, 1 - density) },
      KHR_materials_volume: { thicknessFactor: 1.8, attenuationColor: c, attenuationDistance: 3 + (1 - density) * 20 },
    },
  };
  return m;
}

function concat(list) {
  const total = list.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of list) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export const GLB_MIME = "model/gltf-binary";
export const GLB_EXT = ".glb";
