import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildFrame } from "../src/frame/geometry.js";
import {
  frameKey,
  frameGeometry,
  createFrameObject,
  clearFrameCache,
} from "../src/frame/index.js";
import { buildLensMaterial } from "../src/frame/materials.js";
import { toEngineSpec } from "../src/frame/catalog.js";

const path = (rx = 26, ry = 20) =>
  Array.from({ length: 48 }, (_, i) => ({
    x: rx * Math.cos((i * Math.PI) / 24),
    y: ry * Math.sin((i * Math.PI) / 24),
  }));
test("photo contours and geometry sliders participate in the cache key", () => {
  const a = { shape: "custom", lensW: 52, lensH: 40, lensPath: path() };
  const b = { ...a, lensPath: path(26, 15) };
  assert.notEqual(frameKey(a), frameKey(b));
  assert.notEqual(frameGeometry(THREE, a), frameGeometry(THREE, b));
  for (const [key, value] of Object.entries({
    splayDeg: 9,
    earDrop: 14,
    bridgeArch: 6,
    hinge: false,
    catWidth: 0.5,
    lensInset: 1.1,
  })) {
    assert.notEqual(frameKey(a), frameKey({ ...a, [key]: value }), key);
  }
  assert.equal(frameKey(a), frameKey({ ...a, color: "#ff0000" }));
  clearFrameCache();
});
test("catalog normalization preserves asymmetric photo contours", () => {
  const product = {
    size: "52-18-145",
    lensPath: path(),
    lensPathL: path(25, 19),
    lensPathR: path(26, 21),
  };
  const spec = toEngineSpec(product);
  for (const k of ["lensPath", "lensPathL", "lensPathR"])
    assert.deepEqual(spec[k], product[k]);
});
test("lens triangles face the camera and match the curved surface normals", () => {
  const g = buildFrame({ pantoDeg: 0 }).roles.lens;
  assert.ok(g.vertexCount > 1000, "lens surface is subdivided, not a flat fan");
  for (let i = 0; i < g.index.length; i += 3) {
    const [a, b, c] = g.index
      .slice(i, i + 3)
      .map((j) => new THREE.Vector3().fromArray(g.position, j * 3));
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    assert.ok(n.z > 0, "clockwise lens faces");
    const normal = new THREE.Vector3().fromArray(g.normal, g.index[i] * 3);
    assert.ok(n.dot(normal) > 0, "inconsistent vertex normal");
  }
});
test("clear glass has restrained reflections and lite mode preserves tint types", () => {
  const clear = buildLensMaterial(THREE, "clear");
  assert.equal(clear.transmission, 1);
  assert.equal(clear.clearcoat, 0);
  assert.equal(clear.toneMapped, false);
  assert.ok(clear.envMapIntensity < 0.6);
  assert.equal(clear.side, THREE.FrontSide);
  const lite = buildLensMaterial(THREE, "clear", "lite"),
    sun = buildLensMaterial(THREE, "photo", "lite");
  assert.ok(lite.opacity < 0.1);
  assert.ok(sun.opacity > 0.6);
  for (const m of [clear, lite, sun]) m.dispose();
});
test("variant changes dispose current materials exactly once, not the first variant repeatedly", () => {
  const obj = createFrameObject(
    THREE,
    {},
    { occluder: false, quality: "lite" },
  );
  const count = (mats) => {
    const record = { n: 0 };
    for (const m of new Set(Object.values(mats)))
      m.addEventListener("dispose", () => record.n++);
    return record;
  };
  const initial = count(obj.group.userData.mats);
  obj.setVariant({ color: "#ff0000" });
  const second = count(obj.group.userData.mats);
  obj.setVariant({ color: "#0000ff" });
  const third = count(obj.group.userData.mats);
  obj.dispose();
  assert.equal(initial.n, 5);
  assert.equal(second.n, 5);
  assert.equal(third.n, 5);
  clearFrameCache();
});
test("shadow strokes retain names so temples can be excluded without a missing helper", () => {
  const strokes = buildFrame().meta.silhouette;
  assert.ok(strokes.some((p) => /^rim/.test(p.name)));
  assert.ok(strokes.some((p) => /^temple/.test(p.name)));
});

test("GLB normalization preserves mm scaling, front plane, and offset under a face pose", async () => {
  const { normalizeGLB, disposeGLB } = await import("../src/frame/loaders.js");
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.04, 0.15),
    new THREE.MeshStandardMaterial(),
  );
  root.add(mesh);
  const bundle = normalizeGLB(root, THREE, {
    totalWidth: 140,
    offset: [0, 2, 0],
  });
  bundle.group.scale.setScalar(2);
  const box = new THREE.Box3().setFromObject(bundle.group);
  assert.ok(Math.abs(box.getSize(new THREE.Vector3()).x - 280) < 0.001);
  assert.ok(
    Math.abs(box.max.z) < 0.001,
    "temple centroid must not be the nose anchor",
  );
  assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).y - 4) < 0.001);
  disposeGLB(bundle);
});

test("recoloring an imported frame does not wash out its original lens material", async () => {
  const { tintGLB } = await import("../src/frame/loaders.js");
  const lens = new THREE.MeshPhysicalMaterial({
    name: "lens",
    opacity: 1,
    metalness: 0.9,
  });
  const frame = new THREE.MeshStandardMaterial({ color: "#111111" });
  tintGLB({ materials: [lens, frame] }, { color: "#ff0000" });
  assert.equal(lens.opacity, 1);
  assert.equal(lens.metalness, 0.9);
  assert.equal(frame.color.getHexString(), "ff0000");
  lens.dispose();
  frame.dispose();
});
