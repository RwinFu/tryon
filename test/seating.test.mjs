import test from "node:test";
import assert from "node:assert/strict";
import { solveWearableScale, solveBridgeSeat } from "../src/engine/seating.js";

test("seating scale keeps metric baseline and constrains both outlier directions", () => {
  assert.equal(solveWearableScale({ eyeSpanPx: 126, pdMm: 63, faceWidthPx: 280 }).scale, 2);
  const tiny = solveWearableScale({ eyeSpanPx: 20, pdMm: 63, faceWidthPx: 280 });
  const huge = solveWearableScale({ eyeSpanPx: 400, pdMm: 63, faceWidthPx: 280 });
  assert.equal(tiny.scale, 1.64);
  assert.equal(huge.scale, 2.36);
  assert.equal(tiny.constrained, true);
  assert.ok(tiny.agreement < 0.2 && huge.agreement < 0.4);
});

test("bridge seating is bounded, confidence-aware and fades in profile", () => {
  const front = solveBridgeSeat({ noseWmm: 30, pdLocked: true, quality: { yaw: 0 } }, { dbn: 14 });
  const side = solveBridgeSeat({ noseWmm: 30, pdLocked: true, quality: { visualYaw: .72 } }, { dbn: 14 });
  assert.ok(front.yMm > 0 && front.yMm <= 2.5);
  assert.ok(Math.abs(side.yMm) <= Math.abs(front.yMm) * .2);
  assert.equal(side.confidence, "low");
  assert.equal(solveBridgeSeat({}, {}).confidence, "unknown");
});
