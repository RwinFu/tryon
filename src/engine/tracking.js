/**
 * tracking.js — ردیابی صورت با MediaPipe Face Landmarker + حل‌کردن فیت میلی‌متری
 *
 * منطق اندازه‌گیری (چیزی که این کار را از «افکت اینستاگرام» جدا می‌کند):
 *  فاصلهٔ مردمک‌ها در پیکسل ↔ میلی‌متر واقعی ⇒ فاصلهٔ دوربین از صورت؛
  *  فریم عینک vg میلی‌متر جلوتر از صفحهٔ چشم است ⇒ تصحیح مقیاس پرسپکتیو.
 * برای همین عینک در هر فاصله و هر چرخش سر، هم‌اندازهٔ واقعی می‌ماند.
 */

const MIRRORS = {
  vision: [
    { module: "lib/tasks-vision/vision_bundle.mjs", wasm: "lib/tasks-vision/wasm" },
    {
      module: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
      wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    },
    {
      module: "https://unpkg.com/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
      wasm: "https://unpkg.com/@mediapipe/tasks-vision@0.10.14/wasm",
    },
  ],
  faceModel: [
    "lib/face_landmarker.task",
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  ],
  hairModel: [
    "lib/hair_segmenter.tflite",
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite",
    "lib/selfie_multiclass_256x256.tflite",
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
  ],
};

/** نقاط ثابت (بدون تأثیر پلک زدن) برای مقیاس و چرخش */
const P = {
  eyeOuterL: 33,
  eyeOuterR: 263,
  irisL: 468,
  irisR: 473,
  browL: 70,
  browR: 300,
  noseBridge: 6,
  noseTip: 4,
  noseSideL: 188, // کنار پل بینی، جایی که پد می‌نشیند — نه شقیقه
  noseSideR: 412,
  chin: 152,
  faceL: 234,
  faceR: 454,
  foreheadL: 103,
  foreheadR: 336,
  jawL: 172,
  jawR: 397,
  cheekL: 234,
  cheekR: 454,
  mouthL: 61,
  mouthR: 291,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** قطر عنبیهٔ بزرگسال. مقیاس میلی‌متر از همین ثابت می‌آید، نه از عرضِ فرضیِ صورت. */
export const IRIS_MM = 11.7;
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * فاصلهٔ مردمک به میلی‌متر، از فاصلهٔ پیکسلیِ مردمک‌ها و قطر عنبیه.
 * فرمول قبلی ((مردمک/عرض‌صورت)×۱۳۸×۰٫۴۷) همیشه به کفِ ۵۲ می‌خورد و عینک را ~۲۰٪ بزرگ می‌کرد.
 * @returns {number|null}
 */
export function estimatePdMm(pupilPx, irisDiamPx) {
  if (!(pupilPx > 4) || !(irisDiamPx > 1)) return null;
  return clamp((pupilPx * IRIS_MM) / irisDiamPx, 50, 78);
}

function irisDiameterPx(lms, toPx) {
  const pairs = [
    [469, 471],
    [470, 472],
    [474, 476],
    [475, 477],
  ];
  const ds = [];
  for (const [a, b] of pairs) {
    const d = pairPx(lms, a, b, toPx);
    if (d > 2) ds.push(d);
  }
  return ds.length ? median(ds) : 0;
}

function pairPx(lms, a, b, toPx) {
  if (!lms?.[a] || !lms?.[b]) return 0;
  const pa = toPx(lms[a]);
  const pb = toPx(lms[b]);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/** فیلتر یک‌یورو: لرزش را می‌گیرد و تأخیر را کم نگه می‌دارد. */
class OneEuro {
  constructor(minCutoff = 1.1, beta = 0.008, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = 0;
  }
  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / Math.max(dt, 1e-4));
  }
  filter(x, t) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-4, (t - this.tPrev) / 1000);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = this.dxPrev + aD * (dx - this.dxPrev);
    this.dxPrev = dxHat;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const out = this.xPrev + a * (x - this.xPrev);
    this.xPrev = out;
    return out;
  }
}

function loadScript(src, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        s.remove();
        reject(new Error("timeout: " + src));
      }
    }, timeout);
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.remove();
      reject(new Error("load failed: " + src));
    };
    document.head.appendChild(s);
  });
}

async function withTimeout(p, ms, label) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error("timeout: " + label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

export class FaceTracker {
  /**
   * @param {{baseURL:string, assets?:object, log?:(m:string)=>void, pd?:number, autoPd?:boolean, vertexDistance?:number, focalScale?:number, delegate?:string}} opts
   */
  constructor(opts = {}) {
    this.o = opts;
    this.base = opts.baseURL || "";
    this.assets = opts.assets || {};
    this.log = opts.log || (() => {});
    this.pdMm = opts.pd || 63;
    this.autoPd = opts.autoPd !== false;
    this.vg = opts.vertexDistance ?? 13; // فاصلهٔ عدسی تا صفحهٔ چشم (mm)
    this.focalScale = opts.focalScale || 0.75; // f ≈ 0.75×عرض تصویر (دوربین سلفون)
    this.state = "idle";
    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.W = 0;
    this.H = 0;
    this.f = { x: new OneEuro(), y: new OneEuro(), z: new OneEuro(), s: new OneEuro(0.7, 0.004), c: new OneEuro(0.18, 0.0006) };
    this.q = null;
    this.samples = [];
    this.pdSamples = [];
    this.pdLocked = false;
    this.lastTs = 0;
    this.lastVideoTime = -1;
    this.faces = 0;
    this.missStreak = 0;
  }

  get ready() {
    return !!this.landmarker && this.state === "live";
  }

  /** بارگذاری کتابخانه/مدل با چند آینه (برای شبکهٔ ایران) */
  async init(onProgress = () => {}) {
    const list = (key, fallback) => (this.assets[key] ? [].concat(this.assets[key], fallback) : fallback);
    const abs = (u) => (u.startsWith("http") || !this.base ? u : this.base + "/" + u);

    onProgress("3d", "در حال آماده‌سازی نمایش سه‌بعدی…");
    if (!this.vision) {
      let mod = null,
        fs = null,
        err = null;
      for (const src of list("vision", MIRRORS.vision)) {
        try {
          mod = await withTimeout(import(abs(src.module)), 20000, "vision module");
          fs = await withTimeout(mod.FilesetResolver.forVisionTasks(abs(src.wasm)), 20000, "wasm");
          break;
        } catch (e) {
          err = e;
        }
      }
      if (!mod) throw err || new Error("MediaPipe unavailable");
      this.vision = mod;
      this.fileset = fs;
    }

    onProgress("model", "در حال آماده‌سازی تشخیص صورت…");
    this.landmarker = await this.createLandmarker(onProgress);
    this.state = "ready";
    return this;
  }

  async createLandmarker(onProgress) {
    const list = (key, fallback) => (this.assets[key] ? [].concat(this.assets[key], fallback) : fallback);
    const abs = (u) => (u.startsWith("http") || !this.base ? u : this.base + "/" + u);
    let err;
    for (const url of list("faceModel", MIRRORS.faceModel)) {
      for (const delegate of this.o.delegate ? [this.o.delegate] : ["GPU", "CPU"]) {
        try {
          onProgress("model", "مدل هوش مصنوعی (" + delegate + ")…");
          return await withTimeout(
            this.vision.FaceLandmarker.createFromOptions(this.fileset, {
              baseOptions: { modelAssetPath: abs(url), delegate },
              runningMode: "VIDEO",
              numFaces: 1,
              outputFaceBlendshapes: false,
              outputFacialTransformationMatrixes: true,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            }),
            45000,
            "landmarker " + delegate,
          );
        } catch (e) {
          err = e;
        }
      }
    }
    throw err || new Error("face model unavailable");
  }

  async initHair() {
    if (this.segmenter || this.hairFailed) return;
    const abs = (u) => (u.startsWith("http") || !this.base ? u : this.base + "/" + u);
    const list = (key, fallback) => (this.assets[key] ? [].concat(this.assets[key], fallback) : fallback);
    let err;
    for (const url of list("hairModel", MIRRORS.hairModel)) {
      try {
        this.segmenter = await withTimeout(
          this.vision.ImageSegmenter.createFromOptions(this.fileset, {
            baseOptions: { modelAssetPath: abs(url), delegate: "CPU" },
            runningMode: "VIDEO",
            outputCategoryMask: true,
            outputConfidenceMasks: false,
          }),
          45000,
          "hair model",
        );
        return this.segmenter;
      } catch (e) {
        err = e;
      }
    }
    this.hairFailed = true;
    this.log("hair-unavailable", err?.message || "");
    return null;
  }

  /** دوربین را باز می‌کند؛ ترتیب محدودیت‌ها از general به specific */
  async startCamera({ facing = "user", light = false, portrait = false } = {}) {
    if (!window.isSecureContext) {
      const e = new Error("این صفحه باید با HTTPS باز شود تا دوربین کار کند");
      e.name = "SecurityError";
      throw e;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error("API دوربین در این مرورگر در دسترس نیست");
      e.name = "NotFoundError";
      throw e;
    }
    // در حالت عمودی، ارتفاع بیشتر از عرض باشد؛ وگرنه object-fit:cover صورت را می‌بُرد
    const base = light ? { w: 640, h: 480 } : { w: 960, h: 720 };
    const want = portrait ? { w: base.h, h: base.w } : base;
    const tries = [
      {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: want.w, max: want.w * 2 },
          height: { ideal: want.h, max: want.h * 2 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      },
      { video: { width: { ideal: want.w }, height: { ideal: want.h } }, audio: false },
      { video: true, audio: false },
    ];
    let err;
    for (let i = 0; i < tries.length; i++) {
      try {
        if (i) await new Promise((r) => setTimeout(r, 600));
        this.stream = await navigator.mediaDevices.getUserMedia(tries[i]);
        this.video.srcObject = this.stream;
        await this.waitForMetadata();
        await withTimeout(this.video.play(), 10000, "camera playback");
        if (!this.video.videoWidth) throw new Error("تصویر دوربین آماده نشد");
        this.state = "live";
        return this.stream;
      } catch (e) {
        err = e;
        this.stopCamera();
        if (["NotAllowedError", "PermissionDeniedError", "NotFoundError", "SecurityError", "OverconstrainedError"].includes(e.name)) break;
      }
    }
    throw err || new Error("camera unavailable");
  }

  waitForMetadata(ms = 15000) {
    return new Promise((resolve, reject) => {
      const v = this.video;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        v.removeEventListener("loadedmetadata", ok);
        v.removeEventListener("error", bad);
      };
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error("خطا در خواندن دوربین"));
      };
      if (v.readyState >= 1 && v.videoWidth) return resolve();
      v.addEventListener("loadedmetadata", ok, { once: true });
      v.addEventListener("error", bad, { once: true });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("timeout: camera metadata"));
      }, ms);
    });
  }

  stopCamera() {
    this.stream?.getTracks?.().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    if (this.state === "live") this.state = "ready";
  }

  dispose() {
    this.stopCamera();
    this.landmarker?.close?.();
    this.segmenter?.close?.();
    this.landmarker = null;
    this.segmenter = null;
  }

  /** ابعاد بوم/پیکسل‌ها از خودِ ویدیو می‌آید (بدون کشیدنِ دوباره) */
  get size() {
    return { w: this.W, h: this.H };
  }

  resize(w, h) {
    if (this.W === w && this.H === h) return false;
    this.W = w;
    this.H = h;
    return true;
  }

  /** یک فریم ویدیو را پردازش می‌کند؛ نتیجه در this.pose */
  process(ts, force = false) {
    const v = this.video;
    if (this.photoMode) return this.pose || null;
    if (!this.landmarker || !v.videoWidth) return null;
    this.resize(v.videoWidth, v.videoHeight);
    if (!force && v.currentTime === this.lastVideoTime) return this.pose || null;
    this.lastVideoTime = v.currentTime;
    let res = null;
    try {
      res = this.landmarker.detectForVideo(v, ts);
    } catch (e) {
      this.log("detect-error", e.message);
      return this.pose || null;
    }
    if (!res?.faceLandmarks?.length) {
      this.missStreak++;
      if (this.missStreak > 6) this.pose = null;
      return null;
    }
    this.missStreak = 0;
    this.pose = this.solve(res, ts);
    return this.pose;
  }

  px(p) {
    return { x: p.x * this.W, y: p.y * this.H };
  }

  /** حلpose: موقعیت/چرخش/مقیاس در «فضای پیکسلیِ z=0» (هم‌راستا با ویدیو) */
  solve(res, ts) {
    const lms = res.faceLandmarks[0];
    const world = res.faceBlendshapes ? null : null;
    const W = this.W,
      H = this.H;
    const eyeL = this.px(lms[P.irisL] ? lms[P.irisL] : mid(lms[P.eyeOuterL], lms[159], lms[145]));
    const eyeR = this.px(lms[P.irisR] ? lms[P.irisR] : mid(lms[P.eyeOuterR], lms[386], lms[374]));
    const iris = Math.max(4, Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y));
    const midEye = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
    const nose = this.px(lms[P.noseBridge]);
    const tip = this.px(lms[P.noseTip]);
    const chin = this.px(lms[P.chin]);
    const faceL = this.px(lms[P.faceL]),
      faceR = this.px(lms[P.faceR]);
    const faceW = Math.max(1, Math.hypot(faceR.x - faceL.x, faceR.y - faceL.y));

    // ── PD خودکار از قطر عنبیه (میلی‌مترِ شناخته‌شده)، نه از نسبتِ جادوییِ عرض صورت ──
    if (this.autoPd) {
      const est = estimatePdMm(iris, irisDiameterPx(lms, (p) => this.px(p)));
      if (est) {
        this.pdSamples.push(est);
        if (this.pdSamples.length > 40) this.pdSamples.shift();
        const m = median(this.pdSamples);
        if (this.pdSamples.length >= 24 && !this.pdLocked) {
          this.pdLocked = true;
          this.pdMm = +m.toFixed(1);
          this.log("pd-locked", String(this.pdMm));
        } else if (this.pdLocked) {
          this.pdMm = +(this.pdMm * 0.96 + m * 0.04).toFixed(2);
        } else if (this.pdSamples.length >= 6) {
          this.pdMm = +(this.pdMm * 0.8 + m * 0.2).toFixed(2);
        }
      }
    }
    const pdMm = this.pdMm;

    // ── چرخش از ماتریس ترنسفورم، با fallback هندسی ──
    const q = quatFrom(res, lms, { midEye, nose, tip, faceW, H, W }, (v) => this.px(v));

    const front = applyQ(q, [0, 0, 1]);
    // فاصلهٔ تقریبی دوربین تا صورت (پیکسل) — از اندازهٔ مردمک و فاصلهٔ کانونی فرضی
    const focalPx = this.focalScale * Math.max(W, H);
    // در «فضای پیکسلیِ صفحهٔ چشم» فاصلهٔ دوربین دقیقاً برابر فاصلهٔ کانونی (پیکسل) است
    const Lpx = focalPx;
    const vgPx = (this.vg * iris) / pdMm; // فریم، vg میلی‌متر جلوتر از صفحهٔ چشم
    const scale = iris / pdMm; // پیکسل بر میلی‌متر در صفحهٔ چشم (عمق را پرسپکتیو اصلاح می‌کند)

    // ── نقطهٔ لنگر: میانهٔ مردمک‌ها + اصلاح پل بینی ──
    const bridgeY = Math.hypot(nose.x - midEye.x, nose.y - midEye.y);
    const raw = {
      x: midEye.x,
      y: midEye.y - 0.06 * bridgeY,
      z: vgPx,
      scale,
      camZ: Lpx,
      q,
      front,
    };

    // ── هموارسازی (One€) + حدس سرعت ──
    const t = ts || performance.now();
    const jump = this.pose ? Math.hypot(raw.x - this.pose.x, raw.y - this.pose.y) / Math.max(1, scale) : 0;
    const relock = jump > 46;
    if (relock) {
      this.f.c = new OneEuro(0.18, 0.0006);
    }
    const k = relock ? 0 : 1;
    const x = k ? this.f.x.filter(raw.x, t) : raw.x;
    const y = k ? this.f.y.filter(raw.y, t) : raw.y;
    const z = k ? this.f.z.filter(raw.z, t) : raw.z;
    const s = k ? this.f.s.filter(raw.scale, t) : raw.scale;
    const camZ = k ? this.f.c.filter(raw.camZ, t) : raw.camZ;
    if (this.pose?.q) {
      const dot = q[0] * this.pose.q[0] + q[1] * this.pose.q[1] + q[2] * this.pose.q[2] + q[3] * this.pose.q[3];
      const sign = dot < 0 ? -1 : 1;
      const a = relock ? 1 : clamp(1 - Math.exp(-(t - this.lastTs) / 55), 0.08, 1);
      this.q = [
        this.pose.q[0] + (q[0] * sign - this.pose.q[0]) * a,
        this.pose.q[1] + (q[1] * sign - this.pose.q[1]) * a,
        this.pose.q[2] + (q[2] * sign - this.pose.q[2]) * a,
        this.pose.q[3] + (q[3] * sign - this.pose.q[3]) * a,
      ];
      const n = Math.hypot(...this.q) || 1;
      this.q = this.q.map((v) => v / n);
    } else this.q = q.slice();
    this.lastTs = t;

    const yaw = Math.abs(Math.atan2(2 * (this.q[0] * this.q[1] + this.q[3] * this.q[2]), 1 - 2 * (this.q[1] ** 2 + this.q[2] ** 2)));
    const pitch = Math.asin(clamp(2 * (this.q[1] * this.q[2] - this.q[3] * this.q[0]), -0.95, 0.95));

    const pose = {
      x,
      y,
      z,
      scale: s,
      q: this.q,
      front,
      camZ,
      focalPx,
      iris,
      faceW,
      faceWmm: faceW / scale,
      faceHmm: Math.hypot(chin.x - this.px(lms[10]).x, chin.y - this.px(lms[10]).y) / scale,
      noseWmm: pairPx(lms, P.noseSideL, P.noseSideR, (p) => this.px(p)) / scale,
      chinPx: chin,
      pdMm,
      autoPd: this.autoPd,
      pdLocked: this.pdLocked,
      landmarkPx: (i) => this.px(lms[i]),
      landmarks: lms,
      eyes: { l: eyeL, r: eyeR },
      nose: { x: nose.x, y: nose.y },
      chin: { x: chin.x, y: chin.y },
      tip: { x: tip.x, y: tip.y },
      quality: {
        frontal: front[2],
        yaw,
        pitch,
        size: iris / W,
        // راهنماهای کاربر (کلیدهای i18n)
        hint:
          iris / W < 0.13
            ? "closer"
            : front[2] < 0.55
              ? "frontal"
              : Math.abs(pitch) > 0.42
                ? "level"
                : bridgeY / Math.max(1, iris) > 0.9
                  ? "down"
                  : null,
      },
      stable: !relock,
    };
    this.pose = pose;
    return pose;
  }

  /** حالت «عکس» : یک تصویر استاتیک را پردازش می‌کند (بدون دوربین) */
  async processImage(img) {
    if (!this.landmarker) return null;
    const cv = this._imgCv || (this._imgCv = document.createElement("canvas"));
    const max = 1280;
    const k = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    cv.width = Math.round((img.naturalWidth || img.width) * k);
    cv.height = Math.round((img.naturalHeight || img.height) * k);
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    this.W = cv.width;
    this.H = cv.height;
    try {
      const res = this.landmarker.detect(cv);
      if (!res?.faceLandmarks?.length) return null;
      this.pose = this.solve(res, performance.now());
      return { pose: this.pose, canvas: cv };
    } catch (e) {
      this.log("image-error", e.message);
      return null;
    }
  }

  segmentHair(dstCanvas) {
    if (!this.segmenter || !this.video.videoWidth) return false;
    try {
      const res = this.segmenter.segmentForVideo(this.video, performance.now());
      const mask = res.categoryMask;
      const d = mask.getAsUint8Array();
      const mw = mask.width || 256,
        mh = mask.height || 256;
      const ctx = dstCanvas.getContext("2d", { willReadFrequently: true });
      if (dstCanvas.width !== mw || dstCanvas.height !== mh) {
        dstCanvas.width = mw;
        dstCanvas.height = mh;
      }
      const img = ctx.createImageData(mw, mh);
      const o = img.data;
      for (let i = 0; i < d.length; i++) {
        const k = i * 4;
        o[k] = o[k + 1] = o[k + 2] = 255;
        o[k + 3] = d[i] === 1 ? 255 : 0;
      }
      ctx.putImageData(img, 0, 0);
      mask.close?.();
      return true;
    } catch (e) {
      this.segmenter = null;
      this.hairFailed = true;
      this.log("hair-error", e.message);
      return false;
    }
  }
}

function mid(a, b, c) {
  const xs = [a.x, b.x, ...(c ? [c.x] : [])].filter((v) => v != null);
  const ys = [a.y, b.y, ...(c ? [c.y] : [])].filter((v) => v != null);
  return { x: xs.reduce((s, v) => s + v, 0) / xs.length, y: ys.reduce((s, v) => s + v, 0) / ys.length };
}

function quatFrom(res, lms, g, toPx) {
  const m = res.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length === 16) {
    try {
      // three.Matrix4.fromArray(stored column-major) → decompose
      const q = quatFromMat4(m);
      if (q) {
        const front = applyQ(q, [0, 0, 1]);
        if (isFinite(q[0]) && front[2] > 0.02) return q;
      }
    } catch (e) {
      /* ignore, هندسی */
    }
  }
  return quatGeometric(lms, g, toPx);
}

/** استخراج کواترنیون از ماتریس ۴×۴ (ستونی، هم‌خوان three) */
function quatFromMat4(m) {
  const t = new DOMMatrixReadOnly([m[0], m[1], m[2], 0, m[4], m[5], m[6], 0, m[8], m[9], m[10], 0, 0, 0, 0, 1]);
  void t;
  const m00 = m[0], m01 = m[4], m02 = m[8];
  const m10 = m[1], m11 = m[5], m12 = m[9];
  const m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  return n > 1e-6 ? q.map((v) => v / n) : null;
}

/** چرخش تقریبی از خط چشم + مکان بینی (وقتی ماتریس در دسترس نیست) */
function quatGeometric(lms, g, toPx) {
  const roll = -Math.atan2(lms[263].y - lms[33].y, lms[263].x - lms[33].x);
  const faceW = Math.max(1, Math.abs(toPx(lms[454]).x - toPx(lms[234]).x));
  const yawN = clamp(((toPx(lms[4]).x - g.midEye.x) / faceW) * 1.9, -0.6, 0.6);
  const pitchN = clamp(1.25 * ((toPx(lms[4]).y - g.midEye.y) / Math.max(1, g.faceW)) - 0.22, -0.45, 0.45);
  const e = [pitchN, yawN, roll, "YXZ"];
  return eulerToQuat(e[0], e[1], e[2]);
}

function eulerToQuat(pitch, yaw, roll) {
  const c1 = Math.cos(pitch / 2),
    c2 = Math.cos(yaw / 2),
    c3 = Math.cos(roll / 2);
  const s1 = Math.sin(pitch / 2),
    s2 = Math.sin(yaw / 2),
    s3 = Math.sin(roll / 2);
  return [
    s1 * c2 * c3 - c1 * s2 * s3,
    c1 * s2 * c3 + s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** چرخش بردار با کواترنیون [x,y,z,w] */
export function applyQ(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}
