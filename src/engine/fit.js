/**
 * fit.js — تحلیل شکل صورت، امتیاز فیت، و پیشنهاد فریم
 *
 * این همان چیزی است که یک «افکت بامزه» را به ابزار فروش اپتیک تبدیل می‌کند:
 *  - شکل صورت از نسبت‌های استخوانی (نه فیلتر زیبایی)
 *  - دیسانتراسیون عدسی نسبت به مردمک (معیار واقعی اپتومتری)
 *  - پهنای فریم نسبت به پهنای صورت، و پهنای پل نسبت به پل بینی
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** نسبت‌های پایه از لندمارک‌ها (p = نقطه در پیکسل) */
export function faceShapeMetrics(p) {
  const d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y) || 1;
  const cheek = d(234, 454);
  const eL = d(33, 234),
    eR = d(263, 454);
  return {
    length: d(10, 152) / cheek,
    jaw: d(172, 397) / cheek,
    forehead: d(21, 251) / cheek,
    symmetry: Math.min(eL, eR) / Math.max(eL, eR || 1),
    cheekPx: cheek,
    faceWpx: cheek,
    noseW: d(188, 412), // کنار پل بینی؛ ۱۲۷/۳۵۶ شقیقه‌اند و پهنای صورت را برمی‌گردانند
  };
}

export function classifyShape(m) {
  if (m.symmetry < 0.72) return null; // سر خیلی کج است → نمونه نگیر
  if (m.length >= 1.5) return "oblong";
  if (m.forehead <= 0.82 && m.jaw <= 0.84) return "diamond";
  if (m.forehead - m.jaw >= 0.13) return "heart";
  if (m.jaw >= 0.93 && m.length <= 1.32) return "square";
  if (m.length <= 1.24) return "round";
  if (m.jaw - m.forehead >= 0.09) return "triangle";
  return "oval";
}

export const SHAPE_COPY = {
  oblong: {
    label: "کشیده (مستطیلی)",
    advice:
      "صورت کشیده‌تر از حالت متعادل است. فریم پهن و عمیق، طول صورت را کوتاه‌تر نشان می‌دهد؛ فریم باریک و بلند آن را بیشتر می‌کشد.",
    want: ["oversize", "square", "rectangle", "aviator", "browline"],
  },
  round: {
    label: "گرد",
    advice: "پهنای صورت در گونه و فک جمع می‌شود. فریم گوشه‌دار و مستطیلی خط صورت را می‌شکند و صورت کشیده‌تر و خوش‌قاب دیده می‌شود.",
    want: ["square", "rectangle", "cateye", "browline", "geometric"],
  },
  square: {
    label: "مربعی",
    advice: "خط فک پهن و مشخص است. فریم گرد و بیضی گوشه‌ها را نرم می‌کند؛ فریم مربعیِ تیز صورت را خشن‌تر می‌کند.",
    want: ["round", "roundmetal", "oval", "panto", "aviator"],
  },
  oval: {
    label: "بیضی",
    advice: "تناسبات صورت متعادل است؛ تقریباً هر فریمی می‌آید. برای شروع فریم‌های مشخصه‌دار مثل گربه‌ای و مربعی.",
    want: ["cateye", "square", "aviator", "browline", "octagon"],
  },
  heart: {
    label: "قلبی",
    advice: "پیشانی پهن‌تر از فک است. فریمی که پایینش گرد و سبک باشد و پهنای کمتری داشته باشد، تعادل را برمی‌گرداند.",
    want: ["round", "roundmetal", "oval", "aviator", "light"],
  },
  diamond: {
    label: "الماسی",
    advice: "گونه‌ها پهن‌ترین نقطه‌اند. فریم گربه‌ای با خط بالایی کشیده، توجه را از گونه به سمت چشم می‌برد.",
    want: ["oval", "square", "rectangle", "aviator", "roundmetal"],
  },
  triangle: {
    label: "مثلثی",
    advice: "فک پهن‌تر از پیشانی است. تأکید روی خط بالایی فریم و رنگ‌های روشن‌تر در بالا، تعادل می‌سازد.",
    want: ["cateye", "aviator", "butterfly", "oversize", "octagon"],
  },
};

/** تجمیع نمونه‌های اسکن (برای حذف خطای تک‌فریم) */
export class ShapeScanner {
  constructor(need = 26) {
    this.need = need;
    this.items = [];
    this.t0 = 0;
    this.active = false;
  }
  start() {
    this.items = [];
    this.active = true;
    this.t0 = performance.now();
  }
  /** یک نمونه از لندمارک‌های پیکسلی */
  push(px) {
    if (!this.active) return null;
    const m = faceShapeMetrics(px);
    const sh = classifyShape(m);
    if (!sh) return { progress: this.items.length / this.need, shape: null, metrics: m };
    this.items.push({ ...m, shape: sh });
    const done = this.items.length >= this.need;
    if (!done) return { progress: this.items.length / this.need, shape: null, metrics: m };
    this.active = false;
    const tally = {};
    for (const it of this.items) tally[it.shape] = (tally[it.shape] || 0) + 1;
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    const conf = Math.round((best[1] / this.items.length) * 100);
    return {
      progress: 1,
      done: true,
      shape: best[0],
      confidence: conf,
      metrics: {
        length: median(this.items.map((i) => i.length)),
        jaw: median(this.items.map((i) => i.jaw)),
        forehead: median(this.items.map((i) => i.forehead)),
        cheekPx: median(this.items.map((i) => i.cheekPx)),
      },
    };
  }
}

/**
 * امتیاز فیت: مقایسهٔ اعداد میلی‌متری فریم با اندازه‌گیریِ صورتِ همان مشتری.
 * @returns {{key:string,label:string,value:string,status:'good'|'warn'|'bad',hint:string}[]}
 */
export function fitReport(product, pose, spec) {
  if (!pose || !spec) return [];
  const faceW = pose.faceWmm ?? pose.faceW / pose.scale; // mm
  const lensCenterDist = spec.lensW + spec.dbn; // mm (فاصلهٔ مرکز تا مرکز عدسی‌ها)
  const total = 2 * spec.lensW + spec.dbn;
  const decenter = (lensCenterDist - pose.pdMm) / 2;
  const noseW = pose.noseWmm || 0;
  const out = [];

  const widthRatio = total / Math.max(60, faceW);
  out.push({
    key: "width",
    label: "پهنای فریم",
    value: `${Math.round(total)} / ${Math.round(faceW)} mm`,
    status: widthRatio > 1.1 || widthRatio < 0.86 ? "warn" : "good",
    hint:
      widthRatio > 1.1
        ? "فریم از عرض صورت بزرگ‌تر است؛ روی شقیقه فشار می‌آورد و می‌لغزد."
        : widthRatio < 0.86
          ? "فریم کوچک‌تر از صورت است و گوشه‌های صورت را پهن‌تر نشان می‌دهد."
          : "پهنای فریم با عرض صورت هم‌خوان است.",
  });

  out.push({
    key: "decentration",
    label: "مراکز عدسی",
    value: `${decenter > 0 ? "+" : ""}${decenter.toFixed(1)} mm`,
    status: Math.abs(decenter) > 5 ? "warn" : "good",
    hint:
      Math.abs(decenter) > 5
        ? "مرکز هندسی عدسی‌ها با مردمک فاصله دارد؛ در نمرهٔ بالا باعث خستگی چشم می‌شود."
        : "مرکز عدسی‌ها روی مردمک قرار می‌گیرد (اختلاف حدسی کمتر از ۵ میلی‌متر).",
  });

  out.push({
    key: "bridge",
    label: "پل فریم",
    value: `${Math.round(spec.dbn)} mm`,
    status: noseW && spec.dbn < noseW * 0.72 ? "warn" : "good",
    hint:
      noseW && spec.dbn < noseW * 0.72
        ? "پل فریم باریک‌تر از پل بینی است؛ عینک روی گونه می‌نشیند. مدل‌های high-bridge را ببین."
        : "پل فریم روی بینی می‌نشیند و روی گونه فشار نمی‌آورد.",
  });

  const depth = (spec.lensH || spec.lensW * 0.85) / Math.max(28, pose.faceHmm || 185);
  out.push({
    key: "depth",
    label: "ارتفاع عدسی",
    value: `${Math.round(spec.lensH || spec.lensW * 0.85)} mm`,
    status: depth > 0.34 ? "warn" : "good",
    hint:
      depth > 0.34
        ? "عدسی بلند است و نیمی از صورت را می‌پوشاند؛ برای صورت‌های جمع‌تر فریم کوتاه‌تر بهتر است."
        : "ارتفاع عدسی نسبت به صورت مناسب است.",
  });
  void lensCenterDist;
  return out;
}

/** خلاصهٔ چک‌ها به یک نمره و یک جمله (برای بج یا کارت فیت) */
export function fitScore(checks) {
  const rows = checks || [];
  if (!rows.length) return { score: null, level: "unknown", summary: "", warn: 0, hard: 0, checks: [] };
  const hard = rows.filter((c) => c.status === "bad").length;
  const warn = rows.filter((c) => c.status === "warn").length;
  const score = Math.max(0, Math.round(100 - hard * 34 - warn * 13));
  const level = hard ? "poor" : warn ? "ok" : "good";
  const first = rows.find((c) => c.status !== "good");
  return {
    score,
    level,
    warn,
    hard,
    summary: level === "good" ? "این فریم روی صورت تو اندازهٔ خوبی دارد." : (first && first.hint) || "",
    checks: rows,
  };
}

/** پیشنهاد فریم بر اساس شکل صورت + امتیاز فیت */
export function recommend(catalog, shape, opts = {}) {
  const want = (SHAPE_COPY[shape] && SHAPE_COPY[shape].want) || [];
  const g = opts.gender === "male" || opts.gender === "female" ? opts.gender : null; // جنسیت نامعلوم = بدون فیلتر
  const fits = (p) => !g || !p.gender || p.gender === "unisex" || p.gender === g;
  let pool = catalog;
  if (g) {
    const ok = catalog.filter(fits);
    pool = ok.length >= 3 ? ok : catalog; // اگر لیست خیلی کوتاه می‌شد، همه را نگه می‌داریم
  }
  const scored = pool.map((p) => {
    let s = 0;
    const tags = [...(p.tags || []), p.shape, p.style, ...(p.bestFor || [])];
    for (const w of want) if (tags.includes(w)) s += 2.2;
    if ((p.bestFor || []).includes(shape)) s += 3.4;
    if (opts.exclude && opts.exclude.includes(p.id)) s -= 10;
    if (g && !fits(p)) s -= 6;
    if ((opts.id && opts.id === p.id) || (opts.sku && opts.sku === p.sku)) s += 4;
    return { p, s };
  });
  return scored.sort((a, b) => b.s - a.s).map((x) => x.p);
}

/**
 * انیمیشن «اسکن نقاط صورت»: شبکه‌ای از نقاط که روی صورت می‌نشینند
 * و خطوط اصلی صورت را می‌کشند (بازخورد بصریِ «دارم اندازه می‌گیرم»).
 */
export class FaceMeshScan {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.active = false;
    this.t0 = 0;
    this.seen = null;
    this.fade = 0;
  }
  start(ms = 2600) {
    this.active = true;
    this.dur = ms;
    this.t0 = performance.now();
  }
  stop(fadeMs = 500) {
    if (!this.active) return;
    this.active = false;
    this.fade = 1;
    this.fadeT = performance.now();
    this.fadeMs = fadeMs;
  }
  /** شبکه‌های خطی (زنجیره‌های ایندکس MediaPipe) */
  static LINES = [
    [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
    [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
    [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
    [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
    [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61],
    [168, 6, 197, 195, 5, 4, 1],
  ];

  draw(pose, accent = "#d8b478") {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    if (!this.active && !this.fade) {
      if (this.cleared) return;
      ctx.clearRect(0, 0, W, H);
      this.cleared = true;
      return;
    }
    this.cleared = false;
    if (!pose?.landmarks) return;
    const now = performance.now();
    const t = this.active ? clamp((now - this.t0) / this.dur, 0, 1) : 1;
    if (this.fade) {
      const f = 1 - clamp((now - this.fadeT) / this.fadeMs, 0, 1);
      if (f <= 0) {
        this.fade = 0;
        ctx.clearRect(0, 0, W, H);
        return;
      }
      var alpha = f;
    } else var alpha = 1;

    ctx.clearRect(0, 0, W, H);
    const lms = pose.landmarks;
    // نقاط: ظاهرشدن پلکانی
    const nPts = Math.floor(t * 90);
    ctx.fillStyle = `rgba(240,220,180,${0.55 * alpha})`;
    for (let i = 0; i < nPts; i++) {
      const l = lms[(i * 5) % 468];
      ctx.beginPath();
      ctx.arc(l.x * W, l.y * H, 1.15, 0, 6.3);
      ctx.fill();
    }
    // خطوط
    if (t > 0.22) {
      const lt = clamp((t - 0.22) / 0.66, 0, 1);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(216,180,120,${0.62 * alpha})`;
      for (const line of FaceMeshScan.LINES) {
        ctx.beginPath();
        const upto = Math.floor(lt * line.length);
        for (let i = 0; i < upto; i++) {
          const l = lms[line[i]];
          if (i === 0) ctx.moveTo(l.x * W, l.y * H);
          else ctx.lineTo(l.x * W, l.y * H);
        }
        ctx.stroke();
      }
    }
    // هایلایتِ پیشرفت
    ctx.strokeStyle = `rgba(255,240,210,${0.85 * alpha})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.34, -Math.PI / 2, -Math.PI / 2 + t * 6.283);
    ctx.stroke();
    void accent;
  }
}
