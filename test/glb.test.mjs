/** ساختار GLB باید طبق glTF 2.0 باشد — بدون وابستگی به ابزار بیرونی، خودمان پارس می‌کنیم */
import test from "node:test";
import assert from "node:assert/strict";
import { exportGLB, packGLB, GLB_MIME } from "../src/frame/glb.js";
import { buildFrame } from "../src/frame/geometry.js";
import { CATALOG, toEngineSpec } from "../src/frame/catalog.js";

const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function parseGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  assert.equal(magic, "glTF", "امضا");
  assert.equal(dv.getUint32(4, true), 2, "نسخهٔ glTF");
  assert.equal(dv.getUint32(8, true), bytes.length, "طول اعلامی با فایل یکی نیست");
  let off = 12;
  const chunks = {};
  while (off < bytes.length) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    assert.equal(len % 4, 0, "chunk باید مضرب ۴ باشد");
    chunks[type === CHUNK_JSON ? "json" : type === CHUNK_BIN ? "bin" : "other"] = bytes.subarray(off + 8, off + 8 + len);
    off += 8 + len;
  }
  assert.ok(chunks.json, "chunk JSON نیست");
  const json = JSON.parse(new TextDecoder().decode(chunks.json).replace(/\0+$/, "").trim());
  return { json, bin: chunks.bin || new Uint8Array(0), bytes };
}

function accessorsInRange(json, bin) {
  for (const [i, a] of json.accessors.entries()) {
    assert.ok([2, 3, 4, 5, 9, 15, 18].includes(a.type.length ? 1 : 1) || true);
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    assert.ok(size, "type نامعتبر در accessor " + i + ": " + a.type);
    const es = COMP[a.componentType];
    assert.ok(es, "componentType نامعتبر: " + a.componentType);
    const bv = json.bufferViews[a.bufferView];
    assert.ok(bv, "bufferView گم‌شده در accessor " + i);
    const need = a.count * size * es;
    const bo = a.byteOffset || 0;
    assert.equal(bo % es, 0, "accessor " + i + " هم‌تراز نیست");
    assert.equal((bv.byteOffset || 0) % 4, 0, "bufferView " + a.bufferView + " باید مضرب ۴ باشد");
    assert.ok((bv.byteStride || 0) % 4 === 0, "byteStride نامعتبر");
    assert.ok(bv.byteOffset + bo + need <= bin.length, "accessor " + i + " از بافر بیرون می‌زند");
    if (a.min && a.max) {
      assert.equal(a.min.length, size, "طول min در " + i);
      for (let c = 0; c < size; c++) assert.ok(a.min[c] <= a.max[c], "min>max در " + i);
    }
  }
}

test("GLB: سربند، chunk‌ها و ارجاع‌ها سالم‌اند", () => {
  for (const p of CATALOG.slice(0, 6)) {
    const bytes = exportGLB(toEngineSpec(p), { name: p.name, color: p.colors[0].color, finish: p.finish });
    assert.equal(GLB_MIME, "model/gltf-binary");
    assert.ok(bytes instanceof Uint8Array, "باید Uint8Array برگردد (نه Buffer)");
    const { json, bin } = parseGLB(bytes);
    assert.equal(json.asset.version, "2.0");
    assert.ok(json.asset.generator, "generator نیست");
    assert.equal(json.scene, 0);
    assert.ok(json.nodes.length >= 1 && json.meshes.length >= 1);
    assert.ok(json.buffers[0].byteLength === bin.length, "طول بافر با BIN نمی‌خواند");
    accessorsInRange(json, bin);
    for (const m of json.meshes)
      for (const prim of m.primitives) {
        for (const k of ["POSITION", "NORMAL", "TEXCOORD_0"])
          assert.ok(Number.isInteger(prim.attributes[k]) && prim.attributes[k] < json.accessors.length, k + " گم است یا خارج از بازه");
        const idx = json.accessors[prim.indices];
        assert.ok([5123, 5125].includes(idx.componentType), "ایندکس باید uint16/uint32 باشد: " + idx.componentType);
        assert.ok(idx.count % 3 === 0, "تعداد ایندکس مضرب ۳ نیست");
        const verts = json.accessors[prim.attributes.POSITION].count;
        if (idx.componentType === 5123) assert.ok(verts <= 65536, "ایندکس ۱۶بیتی از ظرفیت بیشتر شد");
        assert.ok(prim.material === undefined || prim.material < json.materials.length, "material خارج از بازه");
        assert.ok(prim.mode === undefined || prim.mode === 4, "mode باید TRIANGLES باشد");
      }
    assert.ok(json.materials.length >= 2, "متریال‌ها کم‌اند");
    for (const m of json.materials) {
      if (m.pbrMetallicRoughness?.baseColorFactor)
        for (const v of m.pbrMetallicRoughness.baseColorFactor) assert.ok(v >= 0 && v <= 1, "range color");
      if (m.doubleSided !== undefined) assert.equal(typeof m.doubleSided, "boolean");
    }
    const used = json.extensionsUsed || [];
    for (const k of Object.keys(json.materials[0].extensions || {}))
      assert.ok(used.includes(k), "extension استفاده‌شده اعلام نشده: " + k);
  }
});

test("GLB: هندسهٔ داخل فایل همان buildFrame است", () => {
  const spec = toEngineSpec(CATALOG[0]);
  const built = buildFrame(spec);
  const { json, bin } = parseGLB(packGLB(built, { name: "x" }));
  const totalIdx = json.meshes[0].primitives.reduce((s, pr) => s + json.accessors[pr.indices].count, 0);
  assert.ok(totalIdx % 3 === 0);
  assert.ok(Math.abs(totalIdx / 3 - built.meta.tris) <= 1, "مثلث‌ها با هم نمی‌خوانند: " + totalIdx / 3 + " vs " + built.meta.tris);
  const pos = json.meshes[0].primitives.map((pr) => json.accessors[pr.attributes.POSITION]);
  const mn = [Infinity, Infinity, Infinity],
    mx = [-Infinity, -Infinity, -Infinity];
  for (const a of pos)
    for (let c = 0; c < 3; c++) {
      mn[c] = Math.min(mn[c], a.min[c]);
      mx[c] = Math.max(mx[c], a.max[c]);
    }
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(mn[c] - built.bbox.min[c]) < 0.05, "min محور " + c);
    assert.ok(Math.abs(mx[c] - built.bbox.max[c]) < 0.05, "max محور " + c);
  }
  // متریال‌ها به‌نامِ نقش‌ها
  const names = json.materials.map((m) => m.name);
  assert.ok(names.some((n) => /lens/.test(n)), "متریال عدسی نیست: " + names.join(","));
  assert.ok(names.some((n) => /frame|metal/.test(n)), "متریال فریم نیست");
  assert.ok(json.nodes.every((n) => n.name), "گره بی‌نام");
});

test("GLB: حالت‌های فریم/عدسی و رندر شفاف", () => {
  const sun = exportGLB({ ...toEngineSpec(CATALOG.find((p) => p.lens && p.lens !== "clear") || CATALOG[0]), lens: "gradient-gray" }, {});
  const { json } = parseGLB(sun);
  const lensMat = json.materials.find((m) => /lens/.test(m.name || ""));
  assert.ok(lensMat, "متریال عدسی پیدا نشد");
  assert.ok([undefined, "BLEND"].includes(lensMat.alphaMode), "حالت آلفا: " + lensMat.alphaMode);
  if (lensMat.alphaMode === "BLEND") assert.ok((lensMat.pbrMetallicRoughness.baseColorFactor[3] || 1) < 1, "عدسی شفاف باید آلفای کمتر از ۱ داشته باشد");
  assert.ok(json.materials.every((m) => !m.extensions?.KHR_materials_transmission || m.extensions.KHR_materials_transmission.transmissionFactor > 0));
});

test("GLB: بدون DOM/THREE هم کار می‌کند و ورودی ناقص نمی‌شکند", () => {
  assert.doesNotThrow(() => exportGLB({}, {}));
  const b = exportGLB({ shape: "square" }, { color: "not-a-hex", metalColor: undefined });
  assert.ok(b.length > 1000);
  const tiny = parseGLB(exportGLB({ shape: "square", style: "rimless", size: "50-18-145" }, {}));
  assert.ok(tiny.json.materials.length >= 1);
});
