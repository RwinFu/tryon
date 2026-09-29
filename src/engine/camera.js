/**
 * camera.js — ماژول دوربین بازطراحی‌شده از صفر
 *
 * اهداف طراحی (بر اساس بهترین الگوهای GitHub + MDN + W3C):
 *  - تفکیک کامل دوربین از ردیابی: فقط وظیفهٔ باز کردن، مدیریت و تحویل فریم
 *  - ماشین حالت واضح: idle → requesting → active → paused → stopped → error
 *  - زنجیرهٔ fallback مقاوم برای constraints (exact → ideal → true)
 *  - enumerateDevices با امتیازدهی (torch, focus, facing) برای انتخاب بهترین لنز
 *  - پشتیبانی از torch / zoom / focusMode با تشخیص capabilities
 *  - مدیریت آینه (mirror) برای user vs environment
 *  - RVFC (requestVideoFrameCallback) برای فریم دقیق، fallback به rAF
 *  - مدیریت orientation / resize / visibility / devicechange
 *  - خطاهای قابل فهم فارسی/انگلیسی با نگاشت NotAllowed, NotFound, etc.
 *  - سازگار با iOS (playsInline, muted, DOM attach, user gesture)
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const ERROR_MAP = {
  NotAllowedError: "permDenied",
  PermissionDeniedError: "permDenied",
  NotFoundError: "noCamera",
  DevicesNotFoundError: "noCamera",
  NotReadableError: "busy",
  TrackStartError: "busy",
  OverconstrainedError: "overconstrained",
  SecurityError: "needHttps",
};

function mapError(e) {
  const name = e?.name || "UnknownError";
  return { name, key: ERROR_MAP[name] || "genericError", message: e?.message || String(e) };
}

function scoreDevice(device, caps) {
  // امتیازدهی برای انتخاب بهترین دوربین پشتی
  let s = 0;
  const label = (device.label || "").toLowerCase();
  if (caps?.torch) s += 10;
  if (caps?.focusMode?.includes?.("continuous")) s += 6;
  if (caps?.facingMode?.includes?.("environment")) s += 8;
  if (caps?.facingMode?.includes?.("user")) s += 2;
  if (label.includes("wide") && !label.includes("ultra")) s += 3;
  if (label.includes("ultra")) s -= 2;
  if (label.includes("tele")) s -= 1;
  if (label.includes("back") || label.includes("rear") || label.includes("environment")) s += 5;
  if (label.includes("front") || label.includes("user")) s += 1;
  // دوربین‌هایی که در انتهای لیست هستند معمولا اصلی‌اند
  return s;
}

export class Camera {
  /**
   * @param {{video?:HTMLVideoElement, log?:Function, preferredFacing?:'user'|'environment', container?:HTMLElement}} opts
   */
  constructor(opts = {}) {
    this.log = opts.log || (() => {});
    this.preferredFacing = opts.preferredFacing || "user";
    this.container = opts.container || null;

    // ویدیو المنت - اگر بیرون داده نشده، می‌سازیم (با تحمل محیط تست)
    try {
      this.video = opts.video || (typeof document !== "undefined" && document.createElement ? document.createElement("video") : {});
    } catch {
      this.video = opts.video || {};
    }
    try {
      if (this.video) {
        this.video.autoplay = true;
        this.video.playsInline = true;
        this.video.muted = true;
        this.video.setAttribute?.("playsinline", "");
        this.video.setAttribute?.("webkit-playsinline", "");
        this.video.disablePictureInPicture = true;
        this.video.controls = false;
      }
    } catch {}

    this.state = "idle"; // idle | requesting | active | paused | stopped | error
    this.facing = this.preferredFacing;
    this.deviceId = null;
    this.stream = null;
    this.track = null;
    this.capabilities = null;
    this.settings = null;
    this.devices = [];
    this.isMirrored = this.facing === "user";
    this.W = 0;
    this.H = 0;
    this.torchOn = false;
    this.zoom = 1;
    this.zoomMin = 1;
    this.zoomMax = 1;
    this.torchSupported = false;
    this.zoomSupported = false;
    this.focusSupported = false;

    this._listeners = new Map();
    this._rvfcId = null;
    this._rafId = null;
    this._onDeviceChange = this._onDeviceChange.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._onOrientation = this._onOrientation.bind(this);
    this._frameCb = null;
    this._lastFrameTime = 0;
    this._permissionState = "prompt"; // granted | denied | prompt
    this._wasActiveBeforeHide = false;
    this._initDone = false;
  }

  // ─── رویدادها ───
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    const arr = this._listeners.get(event) || [];
    this._listeners.set(event, arr.filter((f) => f !== fn));
  }
  _emit(event, detail) {
    (this._listeners.get(event) || []).forEach((f) => {
      try { f(detail); } catch {}
    });
  }

  _setState(s, extra) {
    this.state = s;
    this._emit("state", { state: s, ...extra });
  }

  // ─── بررسی اولیه ───
  async init() {
    if (this._initDone) return this;
    // secure context
    if (typeof window !== "undefined" && !window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      const e = new Error("HTTPS required for camera");
      e.name = "SecurityError";
      throw e;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error("MediaDevices API not available");
      e.name = "NotFoundError";
      throw e;
    }
    // permission query (optional)
    try {
      if (navigator.permissions?.query) {
        const st = await navigator.permissions.query({ name: "camera" });
        this._permissionState = st.state;
        st.onchange = () => { this._permissionState = st.state; this._emit("permission", st.state); };
      }
    } catch {}
    // attach video to DOM hidden for iOS if container provided, else body
    if (!this.video.parentElement) {
      const host = this.container || document.body;
      if (host) {
        this.video.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
        // فقط برای iOS نیاز است در DOM باشد؛ در بقیه هم ضرری ندارد
        try { host.appendChild(this.video); } catch {}
      }
    }
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", this._onDeviceChange);
    } else if (navigator.mediaDevices) {
      navigator.mediaDevices.ondevicechange = this._onDeviceChange;
    }
    document.addEventListener("visibilitychange", this._onVisibility);
    if (window.screen?.orientation) {
      try { window.screen.orientation.addEventListener("change", this._onOrientation); } catch {}
    }
    window.addEventListener("orientationchange", this._onOrientation);
    this._initDone = true;
    return this;
  }

  async _onDeviceChange() {
    try {
      await this.enumerateDevices();
      this._emit("devicechange", this.devices);
    } catch {}
  }
  _onVisibility() {
    if (document.hidden) {
      if (this.state === "active") {
        this._wasActiveBeforeHide = true;
        // برای ذخیره باتری، فریم‌کال‌بک را متوقف می‌کنیم اما استریم را نگه می‌داریم
        this._stopFrameLoop();
      }
    } else {
      if (this._wasActiveBeforeHide && this.state === "active") {
        this._wasActiveBeforeHide = false;
        this._startFrameLoop();
        // برخی مرورگرها بعد از hidden، ترک را mute می‌کنند
        if (this.video.paused) this.video.play().catch(()=>{});
      }
    }
  }
  _onOrientation() {
    // اندازهٔ ویدیو ممکن است بعد از چرخش عوض شود
    setTimeout(() => this._updateSize(), 300);
  }

  // ─── لیست دوربین‌ها ───
  async enumerateDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all.filter(d => d.kind === "videoinput");
      return this.devices;
    } catch {
      this.devices = [];
      return [];
    }
  }

  /**
   * بهترین دیوایس را برای facing مورد نظر پیدا کن
   * @param {'user'|'environment'} facing
   */
  async findBestDevice(facing) {
    await this.enumerateDevices();
    if (!this.devices.length) return null;

    // اگر قبلا اجازه داریم، labelها پر هستند و می‌توانیم امتیازدهی کنیم
    // در غیر این صورت سعی می‌کنیم با getUserMedia موقت، capabilities را بخوانیم
    const candidates = [];
    for (const dev of this.devices) {
      // اگر label خالی است، نمی‌توانیم حدس بزنیم
      candidates.push({ device: dev, caps: null, score: 0 });
    }

    // تلاش برای خواندن capabilities (فقط اگر قبلا permission داریم، وگرنه هزینه دارد)
    if (this._permissionState === "granted" || this.devices.some(d => d.label)) {
      for (const c of candidates) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: c.device.deviceId } }, audio: false });
          const track = s.getVideoTracks()[0];
          const caps = track.getCapabilities?.() || null;
          let sc = scoreDevice(c.device, caps);
          // ترجیح facing
          const label = c.device.label.toLowerCase();
          if (facing === "environment" && (label.includes("back") || label.includes("rear") || caps?.facingMode?.includes?.("environment"))) sc += 10;
          if (facing === "user" && (label.includes("front") || caps?.facingMode?.includes?.("user"))) sc += 10;
          c.caps = caps;
          c.score = sc;
          s.getTracks().forEach(t => t.stop());
        } catch {
          // نادیده
        }
      }
      candidates.sort((a,b) => b.score - a.score);
      return candidates[0]?.device || null;
    }

    // بدون label: بر اساس facing حدس بزن
    // معمولا دوربین اول user است، آخر environment
    if (facing === "environment") return this.devices[this.devices.length - 1] || null;
    return this.devices[0] || null;
  }

  // ─── constraints builder با fallback ───
  _buildConstraints(attempt, opts) {
    const { facing, deviceId, width, height, frameRate } = opts;
    const base = { audio: false };
    // attempt 0: exact deviceId if provided
    // attempt 1: exact facingMode + ideal resolution
    // attempt 2: ideal facingMode + ideal resolution
    // attempt 3: ideal resolution only
    // attempt 4: video:true
    if (attempt === 0 && deviceId) {
      return { video: { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } }, audio: false };
    }
    if (attempt === 1) {
      return {
        video: {
          facingMode: { exact: facing },
          width: { ideal: width, max: width * 1.5 },
          height: { ideal: height, max: height * 1.5 },
          frameRate: { ideal: frameRate, max: 60 },
        },
        audio: false,
      };
    }
    if (attempt === 2) {
      return {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate },
        },
        audio: false,
      };
    }
    if (attempt === 3) {
      return {
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate },
        },
        audio: false,
      };
    }
    return { video: true, audio: false };
  }

  waitForMetadata(timeout = 15000) {
    return new Promise((resolve, reject) => {
      const v = this.video;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        v.removeEventListener("loadedmetadata", onOk);
        v.removeEventListener("loadeddata", onOk);
        v.removeEventListener("error", onErr);
      };
      const onOk = () => {
        if (v.videoWidth) { cleanup(); resolve(); }
      };
      const onErr = () => { cleanup(); reject(new Error("video metadata error")); };
      if (v.readyState >= 1 && v.videoWidth) return resolve();
      v.addEventListener("loadedmetadata", onOk, { once: true });
      v.addEventListener("loadeddata", onOk, { once: true });
      v.addEventListener("error", onErr, { once: true });
      timer = setTimeout(() => { cleanup(); reject(new Error("timeout: camera metadata")); }, timeout);
    });
  }

  async _playWithTimeout(timeout = 10000) {
    const v = this.video;
    const p = v.play();
    if (!p || typeof p.then !== "function") return;
    let t;
    try {
      await Promise.race([
        p,
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout: camera playback")), timeout); }),
      ]);
    } finally { clearTimeout(t); }
  }

  // ─── شروع دوربین ───
  /**
   * @param {{facing?:'user'|'environment', deviceId?:string, width?:number, height?:number, frameRate?:number, portrait?:boolean, torch?:boolean, zoom?:number}} opts
   */
  async start(opts = {}) {
    await this.init();
    const facing = opts.facing || this.preferredFacing || "user";
    const portrait = !!opts.portrait;
    const baseW = opts.width || (opts.light ? 640 : 960);
    const baseH = opts.height || (opts.light ? 480 : 720);
    const want = portrait ? { w: baseH, h: baseW } : { w: baseW, h: baseH };
    const frameRate = opts.frameRate || 30;

    this._setState("requesting", { facing });
    this.stop(); // قبلی را ببند

    let lastErr = null;
    // اگر deviceId ندادند ولی facing دادند، سعی کن بهترین دیوایس را پیدا کنی
    let deviceId = opts.deviceId || null;
    if (!deviceId && this.devices.length) {
      try {
        const best = await this.findBestDevice(facing);
        if (best) deviceId = best.deviceId;
      } catch {}
    }

    const tries = deviceId ? [0,1,2,3,4] : [1,2,3,4];

    for (const attempt of tries) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 0 : 400));
        const constraints = this._buildConstraints(attempt, { facing, deviceId: attempt === 0 ? deviceId : undefined, width: want.w, height: want.h, frameRate });
        this.log("camera-try", `${attempt}:${JSON.stringify(constraints.video)}`);
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.track = this.stream.getVideoTracks()[0] || null;
        if (!this.track) throw new Error("No video track");

        this.video.srcObject = this.stream;
        await this.waitForMetadata();
        await this._playWithTimeout();

        if (!this.video.videoWidth) throw new Error("videoWidth 0");

        // تنظیمات
        try { this.capabilities = this.track.getCapabilities?.() || null; } catch { this.capabilities = null; }
        try { this.settings = this.track.getSettings?.() || null; } catch { this.settings = null; }

        this.facing = (this.settings?.facingMode) || facing;
        this.deviceId = this.settings?.deviceId || deviceId || this.track.getSettings?.().deviceId || null;
        this.isMirrored = this.facing === "user" || this.settings?.facingMode === "user";
        this.W = this.video.videoWidth;
        this.H = this.video.videoHeight;

        // torch / zoom support
        this.torchSupported = !!(this.capabilities?.torch);
        this.zoomSupported = !!(this.capabilities?.zoom);
        this.focusSupported = !!(this.capabilities?.focusMode);
        if (this.capabilities?.zoom) {
          this.zoomMin = this.capabilities.zoom.min ?? 1;
          this.zoomMax = this.capabilities.zoom.max ?? 1;
          this.zoom = this.settings?.zoom ?? 1;
        }

        if (opts.torch && this.torchSupported) {
          try { await this.setTorch(true); } catch {}
        }
        if (opts.zoom && this.zoomSupported) {
          try { await this.setZoom(opts.zoom); } catch {}
        }

        this._setState("active", { facing: this.facing, deviceId: this.deviceId, w: this.W, h: this.H });
        this._updateSize();
        this._startFrameLoop();
        this._emit("start", { stream: this.stream, facing: this.facing, deviceId: this.deviceId, capabilities: this.capabilities });
        return this.stream;

      } catch (e) {
        lastErr = e;
        this.log("camera-fail", `${attempt}:${e.name}:${e.message}`);
        this.stop();
        const fatal = ["NotAllowedError","PermissionDeniedError","SecurityError","NotFoundError"];
        if (fatal.includes(e.name)) break;
        // OverconstrainedError -> try next
      }
    }
    this._setState("error", { error: lastErr });
    throw lastErr || new Error("camera unavailable");
  }

  _updateSize() {
    const w = this.video.videoWidth || 0;
    const h = this.video.videoHeight || 0;
    if (w && h && (w !== this.W || h !== this.H)) {
      this.W = w; this.H = h;
      this._emit("resize", { w, h });
    }
  }

  // ─── کنترل‌های پیشرفته ───
  async setTorch(on) {
    if (!this.track) throw new Error("No track");
    if (!this.torchSupported) throw new Error("Torch not supported");
    await this.track.applyConstraints({ advanced: [{ torch: !!on }] });
    this.torchOn = !!on;
    this._emit("torch", this.torchOn);
    return this.torchOn;
  }

  async setZoom(level) {
    if (!this.track) throw new Error("No track");
    if (!this.zoomSupported) throw new Error("Zoom not supported");
    const z = clamp(level, this.zoomMin, this.zoomMax);
    await this.track.applyConstraints({ advanced: [{ zoom: z }] });
    this.zoom = z;
    this._emit("zoom", z);
    return z;
  }

  async switchFacing() {
    const next = this.facing === "user" ? "environment" : "user";
    return this.start({ facing: next, width: this.W, height: this.H });
  }

  async switchDevice(deviceId) {
    return this.start({ deviceId, width: this.W, height: this.H });
  }

  // ─── فریم لوپ ───
  _startFrameLoop() {
    this._stopFrameLoop();
    const loop = (now, metadata) => {
      this._updateSize();
      if (this._frameCb) {
        try { this._frameCb(now, metadata); } catch {}
      }
      this._emit("frame", { now, w: this.W, h: this.H });
      if (this.video.requestVideoFrameCallback) {
        this._rvfcId = this.video.requestVideoFrameCallback(loop);
      } else {
        this._rafId = requestAnimationFrame((t) => loop(t, null));
      }
    };
    if (this.video.requestVideoFrameCallback) {
      this._rvfcId = this.video.requestVideoFrameCallback(loop);
    } else {
      this._rafId = requestAnimationFrame((t) => loop(t, null));
    }
  }
  _stopFrameLoop() {
    if (this._rvfcId && this.video.cancelVideoFrameCallback) {
      try { this.video.cancelVideoFrameCallback(this._rvfcId); } catch {}
    }
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rvfcId = null;
    this._rafId = null;
  }

  /**
   * ثبت callback برای هر فریم ویدیو (دقیق‌تر از rAF)
   * @param {(now:number, metadata:any)=>void} cb
   */
  onFrame(cb) {
    this._frameCb = cb;
    if (this.state === "active") this._startFrameLoop();
    return () => { this._frameCb = null; this._stopFrameLoop(); };
  }

  // ─── عکس ───
  getSnapshotCanvas() {
    if (!this.W || !this.H) return null;
    const c = document.createElement("canvas");
    c.width = this.W; c.height = this.H;
    const ctx = c.getContext("2d");
    // اگر mirrored است، برای snapshot باید برگردانیم؟ معمولا کاربر عکس mirrored می‌خواهد
    if (this.isMirrored) {
      ctx.translate(c.width, 0);
      ctx.scale(-1,1);
    }
    ctx.drawImage(this.video, 0, 0, c.width, c.height);
    return c;
  }

  async toBlob(type = "image/jpeg", quality = 0.92) {
    const cv = this.getSnapshotCanvas();
    if (!cv) return null;
    return new Promise(r => cv.toBlob(r, type, quality));
  }

  // ─── pause / resume / stop ───
  pause() {
    if (this.state !== "active") return;
    this._stopFrameLoop();
    this.video.pause();
    this._setState("paused");
  }

  async resume() {
    if (this.state === "paused") {
      try {
        await this._playWithTimeout();
        this._startFrameLoop();
        this._setState("active");
      } catch (e) {
        this._setState("error", { error: e });
        throw e;
      }
    } else if (this.state === "idle" || this.state === "stopped") {
      return this.start({ facing: this.facing });
    }
  }

  stop() {
    this._stopFrameLoop();
    if (this.stream) {
      try { this.stream.getTracks().forEach(t => t.stop()); } catch {}
    }
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
    this.W = 0; this.H = 0;
    if (this.state === "active" || this.state === "paused" || this.state === "requesting") {
      this._setState("stopped");
    }
  }

  dispose() {
    this.stop();
    this._frameCb = null;
    try { document.removeEventListener("visibilitychange", this._onVisibility); } catch {}
    try { window.removeEventListener("orientationchange", this._onOrientation); } catch {}
    try { window.screen?.orientation?.removeEventListener?.("change", this._onOrientation); } catch {}
    if (navigator.mediaDevices?.removeEventListener) {
      try { navigator.mediaDevices.removeEventListener("devicechange", this._onDeviceChange); } catch {}
    }
    try { if (this.video.parentElement && this.video.style.left === "-9999px") this.video.remove(); } catch {}
    this._listeners.clear();
    this._setState("idle");
  }

  // ─── getters ───
  get size() { return { w: this.W, h: this.H }; }
  get active() { return this.state === "active"; }
  get facingMode() { return this.facing; }
  get mirrored() { return this.isMirrored; }
  get hasTorch() { return this.torchSupported; }
  get hasZoom() { return this.zoomSupported; }
  get errorMapped() { return null; } // placeholder
}

// helper برای نگاشت خطا به کلید ترجمه
export function cameraErrorKey(e) {
  return mapError(e).key;
}
export function cameraErrorInfo(e) {
  return mapError(e);
}
