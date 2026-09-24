/**
 * occluder.js — «سرِ نامرئی» برای بریدن دسته‌های عینک پشت صورت
 *
 * یک سوپربیضی‌گون (superellipsoid) که فقط در بافر عمق نوشته می‌شود و در فضای
 * موضعی فریم (میلی‌متر؛ مبدأ = جلوی پل، +z رو به دوربین) می‌نشیند:
 *  - جلوی آن چند میلی‌متر «پشت» صفحهٔ چشم است ⇒ هیچ‌وقت جلوی عدسی و حلقه نمی‌افتد
 *    (باگ قبلی: کرهٔ پنهان ~۳۷mm جلوی عدسی بود و کل عینک را پاک می‌کرد)؛
 *  - پهنایش از پهنای واقعی صورت کاربر می‌آید و از لولاها باریک‌تر می‌ماند ⇒ دسته‌ها
 *    کنار سر دیده می‌شوند، ولی بخشی که از دید دوربین پشت گونه/شقیقه است پنهان می‌شود؛
 *  - جلوی تخت‌ترِ سوپربیضی‌گون (نمای ۴) به فرم واقعی صورت نزدیک‌تر از کره است.
 */

export const HEAD = {
  exp: 4, // نمای سوپربیضی‌گون: ۲ = بیضی‌گون، ۴ = جعبهٔ گرد (صورت از روبه‌رو تخت‌تر از کره است)
  depth: 100, // نیم‌طول سر (جلو تا پشت ≈ ۲۰۰mm)
  halfHeight: 115, // نیم‌ارتفاع سر (چانه تا فرق ≈ ۲۳۰mm)
  centerY: -12, // مرکز عمودی کمی پایین‌تر از خط مردمک‌ها
  gap: 4, // فاصلهٔ جلوی سر پشت صفحهٔ چشم (mm)
};

/**
 * پارامترهای سرِ نامرئی برای یک فریم و یک صورت.
 * @param {{frameHalfWidth?:number, faceWmm?:number, vertexDistance?:number}} o
 *   frameHalfWidth: نیم‌پهنای فریم تا لولا (mm) · faceWmm: پهنای صورت اندازه‌گیری‌شده (mm)
 *   vertexDistance: فاصلهٔ عدسی تا قرنیه (mm)
 */
export function headOccluderParams({ frameHalfWidth = 72, faceWmm = 0, vertexDistance = 13 } = {}) {
  const hinge = Math.max(40, Number(frameHalfWidth) || 72);
  const measured = faceWmm > 60 && faceWmm < 220 ? faceWmm / 2 + 2 : hinge - 4;
  // همیشه از لولا باریک‌تر: دسته‌ها روی سر می‌نشینند، نه داخل آن
  const rx = Math.max(Math.min(48, hinge - 4), Math.min(measured, hinge - 2));
  const front = -(Math.max(6, Number(vertexDistance) || 13) + HEAD.gap);
  return {
    rx,
    ry: HEAD.halfHeight,
    rz: HEAD.depth,
    cx: 0,
    cy: HEAD.centerY,
    cz: front - HEAD.depth,
    exp: HEAD.exp,
    front,
  };
}

/** مقدار معادلهٔ سوپربیضی‌گون در نقطهٔ p: کمتر از ۱ یعنی داخل سر */
export function headValue(p, h) {
  const e = h.exp;
  return (
    Math.abs((p.x - h.cx) / h.rx) ** e + Math.abs((p.y - h.cy) / h.ry) ** e + Math.abs((p.z - h.cz) / h.rz) ** e
  );
}

export const insideHead = (p, h) => headValue(p, h) < 1;

/** هندسهٔ واحد سوپربیضی‌گون: کرهٔ واحد با نگاشت مؤلفه‌ای sign(v)·|v|^(2/e) */
export function superellipsoidGeometry(THREE, exp = HEAD.exp, widthSegments = 36, heightSegments = 26) {
  const g = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const pos = g.attributes.position;
  const k = 2 / exp;
  const f = (v) => Math.sign(v) * Math.abs(v) ** k;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, f(pos.getX(i)), f(pos.getY(i)), f(pos.getZ(i)));
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** مشِ فقط‌عمق (رنگ نمی‌نویسد) که پیش از فریم رندر می‌شود */
export function createHeadOccluder(THREE, params = headOccluderParams()) {
  const mesh = new THREE.Mesh(
    superellipsoidGeometry(THREE, params.exp),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.FrontSide }),
  );
  mesh.name = "occluder";
  mesh.renderOrder = -100;
  applyHeadOccluder(mesh, params);
  return mesh;
}

export function applyHeadOccluder(mesh, p) {
  mesh.scale.set(p.rx, p.ry, p.rz);
  mesh.position.set(p.cx, p.cy, p.cz);
  mesh.updateMatrix();
  mesh.userData.head = p;
  return mesh;
}
