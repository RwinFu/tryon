/**
 * stage.js — صحنهٔ سه‌بعدی، نورپردازی تطبیقی، سایهٔ تماسی و ترکیب نهایی
 *
 * نکتهٔ «غیرواحی‌نشدن»:
 *  ۱. محیط استودیویی رویه‌ای (IBL) ⇒ بازتاب فلز و استات از جنسِ نورِ اتاق است
 *  ۲. نوردهی/تعادل سفیدی از خودِ فریم دوربین تخمین زده می‌شود
 *  ۳. سایهٔ تماسیِ نرم زیر فریم روی صورت افتاد
 *  ۴. دسته‌ها پشت مو و پشت حجمِ سر بریده می‌شوند (mask + occluder)
 */
import { createFrameObject } from "../frame/index.js";
import { buildFrame } from "../frame/geometry.js";
import { buildStudioEnvironment } from "../frame/materials.js";
import { applyQ } from "./tracking.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Stage {
  /**
   * @param {{canvas:HTMLCanvasElement, THREE:any, quality?:string, lights?:boolean, shadow?:boolean, env?:boolean}} opts
   */
  constructor(opts) {
    this.THREE = opts.THREE;
    const THREE = this.THREE;
    this.opts = opts;
    this.quality = opts.quality || "high";
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      alpha: true,
      antialias: this.quality !== "lite",
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    if ("outputColorSpace" in this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x2a2f38, this.quality === "lite" ? 1.05 : 0.7);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.15);
    this.key.position.set(-1.2, 2.4, 3);
    this.scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0xdfe8ff, 0.35);
    this.rim.position.set(1.6, 0.6, -2.4);
    this.scene.add(this.rim);
    this.frame = null;
    this.frameKey = "";
    this.product = null;
    this.W = 0;
    this.H = 0;
    this.camZ = 900;
    this.match = { exp: 1, tint: [1, 1, 1], dir: [-0.3, 0.6] };
  }

  buildEnv() {
    if (this.opts.env === false || this.quality === "lite" || this.envBuilt) return;
    try {
      this.env = buildStudioEnvironment(this.THREE, this.renderer, { warmth: 0.15 });
      this.scene.environment = this.env;
      this.envBuilt = true;
    } catch (e) {
      this.envBuilt = false;
    }
  }

  resize(w, h) {
    if (this.W === w && this.H === h) return false;
    this.W = w;
    this.H = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyCamera();
    return true;
  }

  applyCamera() {
    const z = Math.max(120, this.camZ);
    this.camera.fov = (2 * Math.atan(this.H / (2 * z)) * 180) / Math.PI;
    this.camera.near = Math.max(1, z * 0.02);
    this.camera.far = z * 12;
    this.camera.position.set(0, 0, z);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  /** فریم فعلی کاتالوگ را می‌سازد (رویه‌ای) یا GLB فروشنده را بارگذاری می‌کند */
  setProduct(product, { quality, envIntensity } = {}) {
    if (product.glb) {
      this.loadExternal(product, { quality, envIntensity });
      return null;
    }
    return this.buildProcedural(product, { quality, envIntensity });
  }

  async loadExternal(product, { quality, envIntensity } = {}) {
    const THREE = this.THREE;
    const token = (this._token = (this._token || 0) + 1);
    this.disposeFrame();
    this.pending = product.glb;
    try {
      const { loadGLB, tintGLB } = await import("../frame/loaders.js");
      const total = product.widthMM || product.spec?.totalWidth || 138;
      const bundle = await loadGLB(product.glb, THREE, {
        totalWidth: total,
        rotateDeg: product.glbRotation,
        offset: product.glbOffset,
        scale: product.glbScale,
      });
      if (product.color || product.metalColor)
        tintGLB(bundle, { color: product.color, metalColor: product.metalColor });
      if (token !== this._token) return;
      bundle.group.traverse((o) => {
        if (o.isMesh) {
          o.renderOrder = 1;
          o.matrixAutoUpdate = true;
        }
      });
      this.group.add(bundle.group);
      this.frame = { group: bundle.group, meta: bundle.meta, dispose: () => {}, setVariant: () => {} };
      this.frameMeta = bundle.meta;
      this.shadowPath = [];
      this.product = product;
      this.pending = null;
      this.onFrame?.(bundle.meta);
      void quality;
      void envIntensity;
    } catch (e) {
      this.pending = null;
      this.onFrameError?.(e);
      this.buildProcedural(product, { quality, envIntensity });
    }
  }

  buildProcedural(product, { quality, envIntensity } = {}) {
    this.product = product;
    this.disposeFrame();
    const THREE = this.THREE;
    const spec = product.spec || product;
    const obj = createFrameObject(THREE, { ...spec, ...pick(product, ["finish", "color", "lens", "metalTint", "metalColor", "accentColor", "translucent"]) }, {
      quality: quality || this.quality,
      envIntensity: envIntensity ?? 1,
      occluder: true,
    });
    this.frame = obj;
    this.group.add(obj.group);
    this.shadowPath = buildFrame(spec).meta.silhouette;
    this.frameMeta = obj.group.userData.meta;
    this.onFrame?.(this.frameMeta);
    return obj;
  }

  setColor(product) {
    if (!this.frame) return;
    const THREE = this.THREE;
    const spec = product.spec || product;
    const next = { ...spec, ...pick(product, ["finish", "color", "lens", "metalTint", "metalColor", "accentColor", "translucent"]) };
    this.frame.setVariant(next);
  }

  disposeFrame() {
    if (!this.frame) return;
    this.group.remove(this.frame.group);
    this.frame.dispose();
    this.frame = null;
  }

  /**
   * تطبیق نور با محیط: از فریم دوربین، میانگین روشنایی/رنگ و سمتِ نور را می‌خواند.
   * @param {HTMLCanvasElement|HTMLVideoElement} src  منبع تصویر (canvasِ کشیده‌شده از ویدیو)
   */
  matchLight(sample) {
    if (!sample) return;
    const s = sample.getContext ? sample : null;
    if (!s) return;
    const N = 32;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const x = c.getContext("2d", { willReadFrequently: true });
    try {
      x.drawImage(sample, 0, 0, N, N);
    } catch (e) {
      return;
    }
    const d = x.getImageData(0, 0, N, N).data;
    let lum = 0,
      r = 0,
      g = 0,
      b = 0,
      left = 0,
      right = 0,
      top = 0,
      bot = 0,
      n = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = (j * N + i) * 4;
        const R = d[k],
          G = d[k + 1],
          B = d[k + 2];
        const L = (R * 0.299 + G * 0.587 + B * 0.114) / 255;
        // نقاط خیلی تیره/خیلی روشن (پس‌زمینه، لامپ) را وزن نمی‌دهیم
        if (L > 0.05 && L < 0.97) {
          lum += L;
          r += R;
          g += G;
          b += B;
          n++;
          if (i < N / 2) left += L;
          else right += L;
          if (j < N / 2) top += L;
          else bot += L;
        }
      }
    }
    if (!n) return;
    const m = this.match;
    const meanLum = clamp(lum / n, 0.05, 0.95);
    const targetExp = clamp((0.5 / meanLum) ** 0.55, 0.72, 1.6);
    m.exp = m.exp * 0.82 + targetExp * 0.18;
    m.tint = [
      m.tint[0] * 0.85 + clamp(r / n / (g / n || 1), 0.8, 1.25) * 0.15,
      1,
      m.tint[2] * 0.85 + clamp(b / n / (g / n || 1), 0.8, 1.25) * 0.15,
    ];
    m.dir = [clamp((right - left) / (right + left || 1), -0.7, 0.7), clamp((top - bot) / (top + bot || 1), -0.7, 0.7)];
    this.renderer.toneMappingExposure = m.exp;
    const tint = new this.THREE.Color().setRGB(m.tint[0], 1, m.tint[2], this.THREE.SRGBColorSpace || undefined);
    this.key.color = tint;
    this.key.intensity = 0.65 + 0.75 * (1 - meanLum) + m.exp * 0.2;
    this.hemi.intensity = 0.45 + 0.6 * meanLum;
    this.key.position.set(-1.4 + m.dir[0] * 3.4, 2.2 - m.dir[1] * 2.2, 3);
  }

  /** جای‌گذاری فریم از روی pose */
  place(pose) {
    if (!this.frame || !pose) return;
    this.camZ = pose.camZ || this.camZ;
    this.applyCamera();
    const k = (this.camZ - pose.z) / this.camZ;
    const g = this.frame.group;
    g.position.set(pose.x * k, pose.y * k, pose.z);
    g.scale.setScalar(pose.scale);
    g.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    g.visible = true;
  }

  hide() {
    if (this.frame) this.frame.group.visible = false;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** سایهٔ تماسی: خطوطِ فریم را روی صورت می‌اندازد (CPU، بدون readback) */
  drawContactShadow(ctx, pose, { opacity = 0.34, blur = 6, offset = [3, 7] } = {}) {
    if (!this.shadowPath || !pose || ctx.__noShadow) return false;
    const THREE = this.THREE;
    const W = this.W,
      H = this.H;
    const cv = this._shCv || (this._shCv = document.createElement("canvas"));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const c = cv.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = `rgba(12,8,6,${opacity})`;
    c.filter = `blur(${blur}px)`;
    const q = pose.q,
      s = pose.scale,
      k = (this.camZ - pose.z) / this.camZ,
      px = pose.x * k,
      py = pose.y * k,
      pz = pose.z;
    for (const stroke of this.shadowPath) {
      c.lineWidth = Math.max(1.5, stroke.sw * s * 1.5);
      c.beginPath();
      let started = false;
      for (let i = 0; i < stroke.path.length; i += 2) {
        const p = stroke.path[i];
        const wp = applyQ(q, [p.x * s + px, p.y * s + py, p.z * s + pz]);
        const depth = this.camZ - wp[2];
        if (depth < 20) continue;
        const f = this.camZ / depth;
        const sx = W / 2 + wp[0] * f + offset[0];
        const sy = H / 2 - wp[1] * f + offset[1];
        if (!started) {
          c.moveTo(sx, sy);
          started = true;
        } else c.lineTo(sx, sy);
      }
      started && c.stroke();
    }
    c.filter = "none";
    // ماسک تخمینیِ صورت تا سایه در هوا معلق نماند
    const faceR = Math.max(30, pose.faceW * 0.52),
      cx = (pose.eyes.l.x + pose.eyes.r.x) / 2,
      cy = pose.nose.y + faceR * 0.42;
    const grad = c.createRadialGradient(cx, cy - faceR * 0.35, faceR * 0.15, cx, cy, faceR * 1.5);
    c.globalCompositeOperation = "destination-in";
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.72, "rgba(0,0,0,.9)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(cv, 0, 0, W, H);
    ctx.restore();
    void THREE;
    return true;
  }

  /** لایهٔ مو: بخشِ موی ویدیو را روی عینک می‌اندازد */
  drawHairLayer(ctx, maskCv) {
    if (!maskCv || !maskCv.width) return false;
    ctx.save();
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.filter = "blur(2.6px)";
    ctx.drawImage(maskCv, 0, 0, this.W, this.H);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(this.opts.video, 0, 0, this.W, this.H);
    ctx.restore();
    return true;
  }

  dispose() {
    this.disposeFrame();
    this.env?.dispose?.();
    this.renderer.dispose();
  }
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
