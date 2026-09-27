/**
 * face-scan.js — اسکن حرفه‌ای صورت
 *
 * یک «افکتِ اسکن» فقط چند خط متحرک روی تصویر است. اینجا کاری می‌کنیم که
 * اپتومتریِ واقعی انجام شود: چند ده فریمِ باکیفیت گرفته می‌شود، فریم‌های
 * خراب (کج، دوربین‌لرزان، پلک نیمه‌بسته، بیرونِ کادر) کنار گذاشته می‌شوند،
 * و هر اندازه با میانهٔ مقاوم و پراکندگیِ واقعی گزارش می‌شود.
 *
 * خروجی:
 *  - PD دوسر (فاصلهٔ دو مردمک) و PD تک‌چشمیِ چپ/راست — معیارِ دیسانتراسیون
 *  - عرض پل بینی (فاصلهٔ دو گوشهٔ داخلی چشم) برای انتخاب DBL فریم
 *  - عرضِ شقیقه/گونه/فک برای انتخاب پهنای فریم
 *  - شکل صورت، کیفیت کلی، و اطمینانِ هر اندازه
 *  - یک مشِ سه‌بعدیِ واقعی از نقاط (میلی‌متری) برای نمایش و خروجی
 *
 * واحد همه‌جا میلی‌متر است و مقیاس از قطرِ عنبیه می‌آید (قطرِ افقیِ مردمک
 * ≈ ۱۱٫۷ میلی‌متر در بزرگسال) — نه از نسبت‌های جادوییِ عرض صورت.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z || 0) - (b.z || 0)) ** 2;

/** ایندکس‌های لندمارک MediaPipe که به آن‌ها نیاز داریم */
export const LM = {
  irisL: 468, // مردمکِ چپِ تصویر (چشمِ راستِ فرد)
  irisR: 473,
  eyeOuterL: 33,
  eyeOuterR: 263,
  eyeInnerL: 133,
  eyeInnerR: 362,
  noseBridgeL: 197,
  noseBridgeR: 195,
  bridgeLoL: 49,
  bridgeLoR: 279,
  templeL: 127,
  templeR: 356,
  browL: 21,
  browR: 251,
  cheekL: 234,
  cheekR: 454,
  noseSideL: 164, // خطِ کنارِ پرهٔ بینی
  noseSideR: 80,
  noseBridgeTop: 168,
  noseBridgeLow: 6,
  noseTip: 4,
  noseAlarL: 129,
  noseAlarR: 358,
  chin: 152,
  top: 10,
  lipUpper: 13,
  lipLower: 14,
  mouthL: 61,
  mouthR: 291,
  jawL: 172,
  jawR: 397,
};

/** قطر افقیِ مردمک (mm) — مبنای مقیاس */
export const IRIS_MM = 11.7;

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });

/** مرکز مردمک؛ اگر مدلِ ریز-عنبیه نبود، از گوشه‌های چشم میانگین می‌گیریم */
export function irisCentre(lms, side) {
  const i = side === "l" ? LM.irisL : LM.irisR;
  if (lms[i] && Number.isFinite(lms[i].x)) return lms[i];
  return mid(lms[side === "l" ? LM.eyeOuterL : LM.eyeOuterR], lms[side === "l" ? LM.eyeInnerL : LM.eyeInnerR]);
}

/** فاصلهٔ چشمِ چپ تا چشمِ راست در واحدِ تصویر */
export function interpupillaryPx(lms) {
  const a = irisCentre(lms, "l"),
    b = irisCentre(lms, "r");
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * کیفیتِ یک فریم (۰ تا ۱۰۰) + دلیلِ رد شدن.
 * @param {Array} lms لندمارک‌های نرمال‌شده (۰..۱ در x/y و هم‌مقیاس در z)
 * @param {{W:number,H:number,prev?:Array,scale?:number}} ctx اندازهٔ تصویر و فریمِ قبلی
 * @returns {{score:number, ok:boolean, reasons:string[], frontality:number, size:number, motion:number}}
 */
export function frameQuality(lms, ctx = {}) {
  const W = Math.max(1, ctx.W || 640),
    H = Math.max(1, ctx.H || 480);
  const reasons = [];
  if (!lms || lms.length < 400) return { score: 0, ok: false, reasons: ["noface"], frontality: 0, size: 0, motion: 1 };

  // ۱) اندازهٔ درست در کادر: فاصلهٔ دو مردمک ۸٪ تا ۳۲٪ عرضِ تصویر
  // (در ویدیوی سلفیِ معمول ۱۰ تا ۱۸٪ است؛ زیرِ ۷٪ دقتِ لندمارک می‌ریزد)
  const iris = Math.max(1e-4, interpupillaryPx(lms) * W);
  const size = iris / W;
  if (size < 0.07) reasons.push("closer");
  else if (size > 0.45) reasons.push("farther");
  else if (size < 0.11 || size > 0.32) reasons.push("size");

  // ۲) تمام‌رخ: محورِ چشم‌ها افقی و خطِ بینی عمودی
  const a = irisCentre(lms, "l"),
    b = irisCentre(lms, "r");
  const roll = Math.abs(Math.atan2(b.y - a.y, b.x - a.x));
  const midE = mid(a, b);
  const nose = lms[LM.noseTip] || lms[4];
  const tilt = Math.abs(Math.atan2(nose.x - midE.x, Math.max(1e-4, Math.abs(nose.y - midE.y))));
  // چرخشِ سر حول محور عمودی: نوکِ بینی باید روی خطِ دو چشم بماند
  const ipd = Math.max(1e-4, interpupillaryPx(lms));
  const nb = lms[LM.noseBridgeTop] || lms[168];
  // چرخشِ سر: هم انحرافِ پل از خطِ چشم‌ها، هم نامتقارنیِ دو نیمهٔ صورت
  const yawNose = Math.abs(nb.x - midE.x) / ipd;
  const yawAsym = Math.abs(Math.abs(nb.x - lms[LM.cheekL].x) - Math.abs(nb.x - lms[LM.cheekR].x)) / ipd;
  const yawCue = Math.max(yawAsym, yawNose * 1.5);
  const frontality = clamp(1 - Math.max(0, yawCue - 0.08) / 0.4, 0, 1);
  if (roll > 0.18) reasons.push("level");
  if (tilt > 0.32) reasons.push("level");
  if (yawCue > 0.22) reasons.push("frontal");

  // ۳) پلک‌ها باز (نسبتِ قدِ شکاف)
  const ear = (up, lo) => Math.hypot(lms[up].x - lms[lo].x, lms[up].y - lms[lo].y);
  const eyeL = ear(159, 145) / Math.max(1e-4, interpupillaryPx(lms));
  const eyeR = ear(386, 374) / Math.max(1e-4, interpupillaryPx(lms));
  if (eyeL < 0.055 || eyeR < 0.055) reasons.push("eyes");

  // ۴) بی‌حرکتی
  const prevL = ctx.prev && irisCentre(ctx.prev, "l");
  // جابه‌جاییِ مردمک نسبت به فاصلهٔ دو چشم: ۶٪ = حرکتِ محسوس
  const motion = prevL ? Math.min(1, Math.hypot(a.x - prevL.x, a.y - prevL.y) * W / Math.max(1, iris) / 0.06) : 0;
  if (motion > 0.5) reasons.push("still");

  // ۵) کلِ صورت داخلِ کادر
  const xs = [LM.cheekL, LM.cheekR, LM.chin, LM.top, LM.eyeOuterL, LM.eyeOuterR].map((i) => lms[i].x);
  const ys = [LM.chin, LM.top].map((i) => lms[i].y);
  if (Math.min(...xs) < 0.02 || Math.max(...xs) > 0.98 || Math.min(...ys) < 0.01 || Math.max(...ys) > 0.99)
    reasons.push("center");

  const pen = { closer: 16, farther: 16, size: 6, level: 14, frontal: 18, eyes: 15, still: 12, center: 10, noface: 100 };
  const score = Math.round(clamp(100 - reasons.reduce((s, r) => s + (pen[r] || 8), 0), 0, 100));
  return { score, ok: score >= 62, reasons, frontality: +frontality.toFixed(3), size: +size.toFixed(3), motion: +motion.toFixed(3) };
}

/** یک نمونهٔ اندازه‌گیری از یک فریمِ خوب (واحد: تصویر) */
export function measureFrame(lms, ctx = {}) {
  const W = Math.max(1, ctx.W || 640);
  const iris = Math.max(1e-4, interpupillaryPx(lms) * W);
  const irisDia = ctx.irisDiaPx || iris * 0.42; // قطرِ عنبیه از چهار نقطه، اگر نبود تخمین
  const scale = irisDia / IRIS_MM; // px per mm
  const mm = (v) => v / scale;
  const a = irisCentre(lms, "l");
  const b = irisCentre(lms, "r");
  const midE = mid(a, b);
  const pdPx = Math.hypot(a.x - b.x, a.y - b.y) * W;
  // خطِ وسطِ صورت: از نوک بینی به چانه (در تصویرِ روبه‌رو عمودی است)
  const chin = lms[LM.chin];
  const midChin = { x: (lms[61].x + lms[291].x) / 2, y: (lms[61].y + lms[291].y) / 2 };
  const dx = midChin.x - midE.x,
    dy = midChin.y - midE.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L,
    uy = dy / L; // یکهٔ عمود بر محورِ صورت (رو به پایین)
  const perpDist = (p) => Math.abs(ux * (p.y - midE.y) - uy * (p.x - midE.x)) * W;
  const cheek = Math.hypot(lms[LM.cheekR].x - lms[LM.cheekL].x, lms[LM.cheekR].y - lms[LM.cheekL].y) * W;
  const temple = Math.hypot(lms[LM.templeR].x - lms[LM.templeL].x, lms[LM.templeR].y - lms[LM.templeL].y) * W;
  const height = Math.hypot(chin.x - lms[LM.top].x, chin.y - lms[LM.top].y) * W;
  const jaw = Math.hypot(lms[LM.jawR].x - lms[LM.jawL].x, lms[LM.jawR].y - lms[LM.jawL].y) * W;
  const canthi = Math.hypot(lms[LM.eyeInnerL].x - lms[LM.eyeInnerR].x, lms[LM.eyeInnerL].y - lms[LM.eyeInnerR].y) * W;
  // عرضِ پل بینی: فاصلهٔ دو سوی پل در سه ارتفاع (نه فاصلهٔ گوشه‌های چشم)
  const sides = [[LM.noseBridgeL, LM.noseBridgeR], [LM.bridgeLoL, LM.bridgeLoR]];
  const bridgePx = median(
    sides
      .filter(([a2, b2]) => lms[a2] && lms[b2])
      .map(([a2, b2]) => Math.hypot(lms[a2].x - lms[b2].x, lms[a2].y - lms[b2].y) * W),
  );
  const noseW = Math.hypot(lms[LM.noseAlarR].x - lms[LM.noseAlarL].x, lms[LM.noseAlarR].y - lms[LM.noseAlarL].y) * W;
  return {
    // PD تک‌چشمی: فاصلهٔ هر مردمک تا خطِ وسطِ صورت (نصفِ PD در صورتِ متقارن)
    pdMono: { l: mm(perpDist(a)), r: mm(perpDist(b)) },
    pd: mm(pdPx),
    bridge: mm(bridgePx || canthi * 0.62),
    canthi: mm(canthi),
    noseW: mm(noseW),
    temple: mm(temple),
    cheek: mm(cheek),
    jaw: mm(jaw),
    height: mm(height),
    roll: +(Math.atan2(b.y - a.y, b.x - a.x) * 57.2958).toFixed(2),
    scale,
    irisDiaPx: irisDia,
  };
}

/** آمارِ مقاوم: میانه + حذفِ دروازه‌ایِ بیرون‌رو (MAD) + پراکندگی */
export function robust(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { value: 0, spread: 0, n: 0, confidence: 0 };
  if (v.length < 5) {
    const m = median(v);
    const sp = Math.max(...v) - Math.min(...v);
    return { value: +m.toFixed(2), spread: +sp.toFixed(2), n: v.length, confidence: Math.round(clamp(v.length * 12, 0, 45)) };
  }
  const m = median(v);
  const mad = median(v.map((x) => Math.abs(x - m))) || 1e-6;
  const kept = v.filter((x) => Math.abs(x - m) <= 3.2 * mad);
  const out = median(kept);
  const spread = median(kept.map((x) => Math.abs(x - out)));
  // اطمینان = پهنای دروازه × ثباتِ بین‌فریمی (کوچک‌تر بهتر)
  const iqr = (() => {
    const s = [...kept].sort((x, y) => x - y);
    return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
  })();
  const noise = iqr / Math.max(0.35, Math.abs(out));
  return {
    value: +out.toFixed(2),
    spread: +spread.toFixed(3),
    iqr: +iqr.toFixed(3),
    n: kept.length,
    confidence: Math.round(clamp(96 - noise * 260 - (v.length - kept.length) * 4, 25, 99)),
  };
}

export const SCAN_STAGES = ["position", "still", "measure", "done"];

/**
 * نشستِ اسکن: فریم‌های خوب را جمع می‌کند و گزارشِ نهایی می‌سازد.
 * سه مرحله دارد: position (جای‌گیری) → still (بی‌حرکتی) → measure (اندازه‌گیری)
 */
export class FaceScan {
  /** @param {{need?:number, irisDiaPx?:number, shapeClassify?:Function}} opts */
  constructor(opts = {}) {
    this.need = opts.need || 45;
    this.shapeClassify = opts.shapeClassify || null;
    this.reset();
  }
  reset() {
    this.active = false;
    this.done = false;
    this.t0 = 0;
    this.samples = [];
    this.stage = "position";
    this.stable = 0;
    this.stillSince = 0;
    this.quality = { score: 0, reasons: ["noface"], ok: false, frontality: 0, size: 0, motion: 0 };
    this.lastGood = null;
    this.report = null;
    this.progress = 0;
    return this;
  }
  start(t = 0) {
    this.reset();
    this.active = true;
    this.t0 = t;
    return this;
  }
  cancel() {
    this.active = false;
    return this;
  }
  /**
   * یک فریم. @param {Array} lms لندمارک‌های نرمال‌شده
   * @returns {{stage:string,progress:number,quality:object,report:object|null}}
   */
  push(lms, ctx = {}) {
    if (!this.active) return { stage: this.stage, progress: this.progress, quality: this.quality, report: this.report };
    const t = ctx.t || 0;
    const q = frameQuality(lms, { ...ctx, prev: this.lastGood });
    this.quality = q;
    const fps = ctx.fps || 30;
    if (lms && lms.length > 400) this.lastGood = lms.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));

    // مرحلهٔ ۱: جای‌گیری درست
    if (this.stage === "position") {
      if (q.ok) {
        this.stable++;
        if (this.stable >= Math.max(6, Math.round(fps * 0.25))) {
          this.stage = "still";
          this.stillSince = t;
        }
      } else this.stable = 0;
      this.progress = clamp(this.stable / Math.max(6, fps * 0.25), 0, 0.12);
      return this._out();
    }
    // مرحلهٔ ۲: بی‌حرکتیِ کامل (تا نیم‌ثانیه بدون حرکتِ محسوس)
    if (this.stage === "still") {
      if (!q.ok) {
        this.stage = "position";
        this.stable = 0;
        return this._out();
      }
      if (q.motion > 0.18) this.stillSince = t;
      const held = (t - this.stillSince) / 1000;
      this.progress = 0.12 + clamp(held / 0.5, 0, 1) * 0.08;
      if (held >= 0.5) this.stage = "measure";
      return this._out();
    }
    // مرحلهٔ ۳: جمع‌آوریِ نمونه‌های باکیفیت
    if (this.stage === "measure") {
      if (q.ok) {
        this.samples.push(measureFrame(lms, ctx));
        this.lastGood = lms.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
      }
      this.progress = 0.2 + clamp(this.samples.length / this.need, 0, 1) * 0.8;
      if (this.samples.length >= this.need) this._finish(t);
      return this._out();
    }
    return this._out();
  }
  _finish(t) {
    this.stage = "done";
    this.done = true;
    this.active = false;
    this.progress = 1;
    const S = this.samples;
    const pd = robust(S.map((s) => s.pd));
    const monoL = robust(S.map((s) => s.pdMono.l));
    const monoR = robust(S.map((s) => s.pdMono.r));
    const bridge = robust(S.map((s) => s.bridge));
    const canthi = robust(S.map((s) => s.canthi));
    const temple = robust(S.map((s) => s.temple));
    const cheek = robust(S.map((s) => s.cheek));
    const jaw = robust(S.map((s) => s.jaw));
    const noseW = robust(S.map((s) => s.noseW));
    const height = robust(S.map((s) => s.height));
    const roll = robust(S.map((s) => Math.abs(s.roll)));
    const ratio = (v) => v / Math.max(1, cheek.value);
    const metrics = { length: ratio(height.value), jaw: ratio(jaw.value), forehead: ratio(temple.value) };
    let shape = null;
    if (this.shapeClassify) shape = this.shapeClassify(metrics);
    else {
      if (metrics.length >= 1.42) shape = "oblong";
      else if (metrics.forehead <= 0.9 && metrics.jaw <= 0.95) shape = "diamond";
      else if (metrics.forehead - metrics.jaw >= 0.1) shape = "heart";
      else if (metrics.jaw >= 1.02 && metrics.length <= 1.34) shape = "square";
      else if (metrics.length <= 1.2) shape = "round";
      else if (metrics.jaw - metrics.forehead >= 0.08) shape = "triangle";
      else shape = "oval";
    }
    const scores = [pd, monoL, monoR, bridge, temple, cheek].map((x) => x.confidence);
    this.report = {
      frames: S.length,
      ms: Math.round(t - this.t0),
      quality: Math.round(median(scores) * clamp(0.6 + (S.length / this.need) * 0.4, 0.6, 1)),
      pd: pd.value,
      pdSpread: pd.spread,
      pdMono: { l: monoL.value, r: monoR.value },
      bridge: bridge.value,
      canthi: canthi.value,
      noseW: noseW.value,
      temple: temple.value,
      cheek: cheek.value,
      jaw: jaw.value,
      height: height.value,
      roll: +roll.value.toFixed(2),
      shape,
      ratios: {
        length: +metrics.length.toFixed(3),
        jaw: +metrics.jaw.toFixed(3),
        forehead: +metrics.forehead.toFixed(3),
      },
      confidence: {
        pd: pd.confidence,
        mono: Math.round(Math.min(monoL.confidence, monoR.confidence)),
        bridge: bridge.confidence,
        temple: temple.confidence,
        cheek: cheek.confidence,
      },
    };
  }
  _out() {
    return { stage: this.stage, progress: +this.progress.toFixed(3), quality: this.quality, report: this.report, samples: this.samples.length };
  }
}

/**
 * مشِ سه‌بعدی از نقطه‌های لندمارک (مثلث‌سازی k-نزدیک، مقاوم و قطعی).
 * @param {Array<{x,y,z}>} points نقاطِ میلی‌متری
 * @param {{k?:number, maxEdge?:number}} opts
 * @returns {{positions:Float32Array, normals:Float32Array, indices:Uint32Array}}
 */
export function buildScanMesh(points, opts = {}) {
  const k = opts.k || 10;
  const maxEdge = opts.maxEdge || 26;
  const minArea = opts.minArea ?? 0.6; // مثلثِ تخت (سه نقطه روی یک خط) به دردِ رندر نمی‌خورد
  const src = points.map((p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +(p.z || 0).toFixed(3) }));
  const seen = new Set();
  const tris = [];
  for (let i = 0; i < src.length; i++) {
    const near = [];
    for (let j = 0; j < src.length; j++)
      if (i !== j) {
        const d2 = dist2(src[i], src[j]);
        if (d2 <= maxEdge * maxEdge) near.push([d2, j]);
      }
    near.sort((a, b) => a[0] - b[0]);
    const top = near.slice(0, k);
    for (const [, j] of top) {
      for (const [, m] of top) {
        if (m <= j) continue;
        const A = src[i],
          B = src[j],
          C = src[m];
        if (dist2(A, B) > maxEdge * maxEdge || dist2(A, C) > maxEdge * maxEdge || dist2(B, C) > maxEdge * maxEdge)
          continue;
        const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z;
        const vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
        const cr = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        if (Math.hypot(cr[0], cr[1], cr[2]) * 0.5 < minArea) continue; // مثلثِ تخت
        const key = [i, j, m].sort((a, b) => a - b).join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        tris.push([i, j, m]);
      }
    }
  }
  // فشرده‌سازیِ رأس‌ها: فقط نقاطی که واقعاً در مثلث‌ها هستند
  const remap = new Int32Array(src.length).fill(-1);
  const pos = [];
  for (const t of tris)
    for (const v of t) {
      if (remap[v] >= 0) continue;
      remap[v] = pos.length / 3;
      pos.push(src[v].x, src[v].y, src[v].z);
    }
  const positions = new Float32Array(pos);
  const indices = new Uint32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) indices.set(tris[t].map((v) => remap[v]), t * 3);
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < positions.length; i += 3) {
    const L = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= L;
    normals[i + 1] /= L;
    normals[i + 2] /= L;
  }
  return { positions, normals, indices, vertices: positions.length / 3, triangles: tris.length };
}

/**
 * لندمارک‌های یک فریم را به فضای میلی‌متریِ سرِ تراز (چشم‌ها در مبدأ،
 * صورت رو به -Z) تبدیل می‌کند و مش می‌سازد.
 * @param {Array} lms @param {{irisDiaPx?:number,W?:number}} ctx
 */
export function headMeshFromLandmarks(lms, ctx = {}) {
  const W = Math.max(1, ctx.W || 640);
  const iris = Math.max(1e-4, interpupillaryPx(lms) * W);
  const irisDia = ctx.irisDiaPx || iris * 0.42;
  const scale = irisDia / IRIS_MM;
  const a = irisCentre(lms, "l"),
    b = irisCentre(lms, "r");
  const midE = mid(a, b);
  // محورِ چپ-راست (ترازِ سر) و محورِ عمود
  const roll = Math.atan2(b.y - a.y, b.x - a.x);
  const cosR = Math.cos(-roll),
    sinR = Math.sin(-roll);
  const pts = lms.map((p) => {
    const dx = (p.x - midE.x) * W,
      dy = (p.y - midE.y) * W,
      dz = (p.z || 0) * W;
    // چرخشِ خلافِ عقربه تا محورِ چشم‌ها افقی شود
    const rx = dx * cosR - dy * sinR;
    const ry = dx * sinR + dy * cosR;
    return { x: rx / scale, y: -ry / scale, z: -dz / scale };
  });
  return { mesh: buildScanMesh(pts), points: pts, scale, rollDeg: +(roll * 57.2958).toFixed(2) };
}

/** پیشنهادِ اندازهٔ فریم بر پایهٔ اسکن حرفه‌ای (اندازهٔ استاندارد اپتومتری) */
export function suggestSize(report, catalogSizes) {
  if (!report) return null;
  const frameW = report.temple * 1.06; // فریم باید کمی پهن‌تر از عرض شقیقه باشد
  const dbn = report.bridge * 0.96;
  const lensW = (frameW - dbn) / 2;
  let best = null;
  for (const s of catalogSizes || ["48", "50", "52", "54", "56"]) {
    const v = parseFloat(s);
    const d = Math.abs(v - frameW);
    if (!best || d < best.d) best = { size: s, d };
  }
  return {
    size: best?.size || "52",
    lensW: +lensW.toFixed(1),
    dbn: +dbn.toFixed(1),
    frameW: +frameW.toFixed(1),
    // خطایِ تخمین: اگر اسکن ضعیف بود، عددِ گرد را ترجیح می‌دهیم
    rounded: { lensW: Math.round(lensW * 2) / 2, dbn: Math.round(dbn) },
  };
}
