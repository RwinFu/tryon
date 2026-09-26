import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FaceTracker, applyQ } from "../src/engine/tracking.js";

// A projected skull fixture; pupil spacing shortens with yaw but physical PD is fixed.
function result(yaw = 0, roll = 0, matrixScale = 1, blink = false) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, yaw, roll, "YXZ"),
  );
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(),
    q,
    new THREE.Vector3().setScalar(matrixScale),
  );
  const lms = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const point = (i, x, y) => {
    const p = new THREE.Vector3(x, y, 0).applyQuaternion(q);
    lms[i] = {
      x: (320 + p.x * 2) / 640,
      y: (220 - p.y * 2) / 480,
      z: (-p.z * 2) / 640,
    };
  };
  point(468, -31.5, 0);
  point(473, 31.5, 0);
  point(33, -46, 0);
  point(133, -17, 0);
  point(362, 17, 0);
  point(263, 46, 0);
  point(159, -31.5, blink ? 0 : 4);
  point(145, -31.5, blink ? 0 : -4);
  point(386, 31.5, blink ? 0 : 4);
  point(374, 31.5, blink ? 0 : -4);
  for (const [start, center] of [
    [469, -31.5],
    [474, 31.5],
  ]) {
    point(start, center - 5.85, 0);
    point(start + 1, center, 5.85);
    point(start + 2, center + 5.85, 0);
    point(start + 3, center, -5.85);
  }
  point(6, 0, -5);
  point(4, 0, -25);
  point(152, 0, -100);
  point(10, 0, 70);
  point(234, -70, -30);
  point(454, 70, -30);
  point(188, -9, -12);
  point(412, 9, -12);
  return {
    faceLandmarks: [lms],
    facialTransformationMatrixes: [{ data: matrix.toArray() }],
  };
}
function tracker(options = {}) {
  const old = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  const tr = new FaceTracker({ pd: 63, autoPd: false, ...options });
  globalThis.document = old;
  tr.resize(640, 480);
  return tr;
}
const close = (a, b, tol = 1e-5) =>
  assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("yaw does not double-shrink the millimetre scale", () => {
  for (const yaw of [0, 0.2, -0.4, 0.6]) {
    const p = tracker().solve(result(yaw), 100);
    close(p.scale, 2);
    close(p.faceWmm, 140);
    close(p.quality.yaw, Math.abs(yaw));
  }
});
test("roll is not reported as yaw; scaled matrices give unit rotations without DOMMatrix", () => {
  const p = tracker().solve(result(0, 0.4, 1.3), 100);
  close(p.quality.yaw, 0);
  close(Math.hypot(...p.q), 1);
  close(p.q[2], Math.sin(0.2));
});
test("vertex distance follows face normal and projects correctly off-axis", () => {
  const p = tracker().solve(result(0.4), 100);
  const front = applyQ(p.q, [0, 0, 1]);
  const k = (p.camZ - p.z) / p.camZ;
  close((p.x - 320) * k, front[0] * 13 * p.scale);
  close((240 - p.y) * k, 20 + front[1] * 13 * p.scale);
  close(p.z, front[2] * 13 * p.scale);
});
test("looking sideways does not translate the skull anchor", () => {
  const a = result(),
    b = result();
  for (const i of [468, 473]) b.faceLandmarks[0][i].x += 0.007;
  close(tracker().solve(a, 100).x, tracker().solve(b, 100).x);
});
test("auto-PD ignores yaw and blinks; photos calibrate on their first valid frame", () => {
  const tr = tracker({ autoPd: true });
  for (let i = 0; i < 30; i++) tr.solve(result(0.6), 100 + i * 33);
  assert.equal(tr.pdSamples.length, 0);
  tr.solve(result(0, 0, 1, true), 1200);
  assert.equal(tr.pdSamples.length, 0);
  tr.photoMode = true;
  tr.solve(result(), 1300);
  assert.equal(tr.pdLocked, true);
  close(tr.pdMm, 63, 0.1);
});
test("tracking reset preserves manual PD and forgets another face calibration", () => {
  const tr = tracker();
  tr.pdMm = 67;
  tr.solve(result(), 100);
  tr.resetTracking();
  assert.equal(tr.pose, null);
  assert.equal(tr.pdMm, 67);
  tr.autoPd = true;
  tr.resetTracking();
  assert.equal(tr.pdMm, 63);
  assert.equal(tr.pdLocked, false);
});
test("image detection switches modes and restores VIDEO even on failure", async () => {
  const tr = tracker();
  const calls = [];
  tr._imgCv = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  tr.landmarker = {
    setOptions: async (o) => calls.push(o.runningMode),
    detect: () => result(),
  };
  const out = await tr.processImage({ width: 2560, height: 1920 });
  assert.ok(out.pose);
  assert.equal(out.canvas.width, 1280);
  assert.equal(out.canvas.height, 960);
  assert.deepEqual(calls, ["IMAGE", "VIDEO"]);
  assert.equal(tr.photoMode, true);
  const pose = tr.pose;
  calls.length = 0;
  tr.landmarker.detect = () => {
    throw new Error("bad image");
  };
  assert.equal(await tr.processImage({ width: 400, height: 400 }), null);
  assert.deepEqual(calls, ["IMAGE", "VIDEO"]);
  assert.equal(tr.pose, pose);
});

test("brief detector misses do not flicker, but a lost face is eventually hidden", () => {
  const tr = tracker();
  tr.video = { videoWidth: 640, videoHeight: 480, currentTime: 0 };
  tr.landmarker = { detectForVideo: () => result() };
  const pose = tr.process(100, true);
  assert.ok(pose);
  tr.landmarker.detectForVideo = () => ({ faceLandmarks: [] });
  for (let i = 1; i <= 6; i++)
    assert.equal(tr.process(100 + i * 33, true), pose);
  assert.equal(tr.process(400, true), null);
});
