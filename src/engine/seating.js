/**
 * موتور مستقل نشست عینک — فقط ریاضی قابل‌آزمون، بدون DOM یا Three.js.
 * ورودی‌ها در پیکسل/میلی‌مترند و خروجی برای Stage آماده است.
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function solveWearableScale({ eyeSpanPx, pdMm, faceWidthPx, projectedAxis = 1 }) {
  const axis = clamp(Number(projectedAxis) || 1, 0.45, 1);
  const pd = clamp(Number(pdMm) || 63, 48, 82);
  const optical = Math.max(0.01, Number(eyeSpanPx) || 0) / (pd * axis);
  const facial = Math.max(1, Number(faceWidthPx) || 1) / (140 * axis);
  const ratio = optical / facial;
  const scale = clamp(optical, facial * 0.82, facial * 1.18);
  return {
    scale,
    optical,
    facial,
    agreement: ratio > 0 ? Math.min(ratio, 1 / ratio) : 0,
    constrained: Math.abs(scale - optical) > 1e-6,
  };
}

export function solveBridgeSeat(pose, spec) {
  const noseW = Number(pose?.noseWmm);
  const dbn = Number(spec?.dbn);
  if (!(noseW > 8) || !(dbn > 5)) {
    return { yMm: 0, zMm: 0, ratio: null, weight: 0, confidence: "unknown" };
  }
  const ratio = dbn / noseW;
  const profile = Math.max(
    Math.abs(Number(pose.quality?.yaw) || 0),
    Math.abs(Number(pose.quality?.visualYaw) || 0),
  );
  const viewWeight = clamp(1 - profile / 0.72, 0.18, 1);
  const calibrationWeight = pose.pdLocked || pose.autoPd === false ? 1 : 0.72;
  const weight = viewWeight * calibrationWeight;
  return {
    yMm: clamp((0.68 - ratio) * 12, -2.5, 2.5) * weight,
    zMm: clamp((ratio - 0.68) * 4, -1, 1) * weight,
    ratio,
    weight,
    confidence: weight > 0.84 ? "high" : weight > 0.35 ? "estimated" : "low",
  };
}
