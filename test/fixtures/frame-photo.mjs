/** در مرورگر یک ImageData واقعی، در Node یک شیء ساده (بدون DOM) */
const imageLike = (w, h, data) =>
  typeof ImageData !== "undefined" ? new ImageData(new Uint8ClampedArray(data), w, h) : { width: w, height: h, data };

/**
 * frame-photo.mjs — سازندهٔ «عکسِ گوشی» برای تستِ خطِ عکس → سه‌بعدی
 *
 * عکس در دو برابر اندازه کشیده و بعد به‌طور میانگین به اصلش کوچک می‌شود
 * (supersampling) تا لبه‌ها ضدلبه و پیوسته باشند — همان چیزی که یک عکسِ واقعی
 * دارد و آستانه‌گذاریِ رنگی را سخت می‌کند.
 *
 * چیزهایی که عمداً بازسازی شده‌اند: میز با گرادیان و رگه، سایهٔ نرم زیر فریم،
 * رینگِ چندپیکسلی با هایلایت، پل، لولا، دستهٔ باز، و دو حالتِ عدسیِ شفاف/تیره.
 */

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/**
 * @param {object} o
 * @param {number} o.tilt       چرخشِ دوربین حول مرکز (درجه)
 * @param {number[]} o.rim      رنگِ بدنهٔ فریم
 * @param {boolean} o.metal     فریم فلزی (باریک و براق)
 * @param {boolean} o.lensDark  عدسی تیره ⇒ سوراخی در عکس نیست
 * @param {string} o.desk       "wood" | "white" | "grey"
 * @param {boolean} o.temple    دستهٔ باز دیده شود
 * @param {number} o.lensW      عرض عدسی بر حسب پیکسل
 * @param {number} o.lensH      ارتفاع عدسی بر حسب پیکسل
 * @param {number} o.rimW       ضخامت رینگ بر حسب پیکسل
 * @param {number} o.gap        فاصلهٔ لبه تا لبهٔ دو عدسی (پیکسل)
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function phonePhoto(o = {}) {
  const {
    tilt = 0,
    rim = [46, 34, 28],
    metal = false,
    lensDark = false,
    desk = "wood",
    temple = true,
    lensW = 210,
    lensH = 130,
    rimW = 18,
    gap = 44,
    W = 900,
    H = 560,
  } = o;
  const S = 2; // ضریب supersampling
  const w = W * S,
    h = H * S;
  const hi = new Float32Array(w * h).fill(1);
  const lo = new Uint8ClampedArray(w * h * 3);
  const set = (x, y, r, g, b) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    lo[i] = r;
    lo[i + 1] = g;
    lo[i + 2] = b;
    hi[y * w + x] = 0;
  };
  const wood = desk === "wood";
  const base = wood ? [206, 188, 164] : desk === "grey" ? [150, 150, 152] : [238, 236, 232];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const grain = wood ? 9 * Math.sin(x / (11 * S) + y / (150 * S)) + 5 * Math.sin(x / 47) : 2 * Math.sin(x / 23);
      const n = (((x * 7919 + y * 104729) % 13) - 6) * 0.6;
      const shade = 1 - 0.08 * Math.exp(-((y / S - H * 0.62) ** 2) / 24000);
      lo[i] = clamp8((base[0] + grain) * shade + n);
      lo[i + 1] = clamp8((base[1] + grain * 0.8) * shade + n);
      lo[i + 2] = clamp8((base[2] + grain * 0.6) * shade + n);
    }

  const a = (tilt * Math.PI) / 180,
    cos = Math.cos(a),
    sin = Math.sin(a);
  const cx = w / 2,
    cy = h / 2 - 10 * S;
  const put = (px, py, r, g, b) => {
    const X = cx + px * cos - py * sin;
    const Y = cy + px * sin + py * cos;
    set(X, Y, r, g, b);
  };
  const line = (x0, y0, x1, y1, r, g, b) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, g, b);
  };
  const k = 4,
    p = 2 / k;
  const sq = (v, half) => Math.sign(v) * Math.pow(Math.abs(v), p) * half;
  /** نصف‌عرضِ سوپربیضی در ارتفاع y (برای پرکردنِ نوارِ رینگ بدون شکاف) */
  const halfAt = (y, hw, hh) =>
    Math.abs(y) >= hh ? 0 : hw * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(y) / hh, k)), 1 / k);
  const cRim = metal ? [176, 172, 164] : rim;
  const shadeAt = (x, y) => (metal ? 0.68 + 0.5 * Math.max(0, Math.sin(y / (7 * S) + x / (30 * S))) : 0.78 + 0.5 * Math.max(0, Math.sin((x + y) / (26 * S))));

  for (const side of [1, -1]) {
    const cxl = side * (gap / 2 + lensW / 2) * S;
    const iw = (lensW / 2) * S,
      ih = (lensH / 2) * S,
      ow = iw + rimW * S,
      oh = ih + rimW * S;
    for (let y = -oh; y <= oh; y += 0.5) {
      const xo = halfAt(y, ow, oh),
        xi = halfAt(y, iw, ih);
      const spans = xi > 0 ? [[-xo, -xi], [xi, xo]] : [[-xo, xo]];
      for (const [x0, x1] of spans) {
        const step = 0.5;
        for (let x = x0; x <= x1; x += step) {
          const s = Math.abs(x) / (xo || 1);
          const f = 0.82 + 0.3 * s; // لبهٔ بیرونی تیره‌تر، لبهٔ داخلی براق‌تر
          put(cxl + x, y, cRim[0] * f, cRim[1] * f, cRim[2] * f);
        }
      }
    }
    if (lensDark)
      for (let y = -ih + 2; y <= ih - 2; y += 0.5)
        for (let x = -iw + 2; x <= iw - 2; x += 0.5) {
          if (Math.hypot(Math.abs(x / iw) ** k, Math.abs(y / ih) ** k) > 1) continue;
          const sh = 0.75 + 0.5 * Math.max(0, Math.sin(x / 60 + y / 90));
          put(cxl + x, y, 30 * sh + 8, 34 * sh + 8, 40 * sh + 8);
        }
  }
  // پل
  for (let t = -gap / 2 - rimW; t <= gap / 2 + rimW; t += 0.5)
    for (let y = -lensH / 2 - rimW; y <= -lensH / 2 + 16; y += 0.5) {
      const f = 0.85;
      put(t * S, y * S, cRim[0] * f, cRim[1] * f, cRim[2] * f);
    }
  // لولا و دستهٔ باز
  if (temple)
    for (const side of [1, -1]) {
      const x0 = side * (gap / 2 + lensW + rimW) * S;
      const y0 = (-lensH / 2 + 18) * S;
      for (let t = 0; t <= 70 * S; t += 0.5) {
        const f = 0.72 + 0.2 * (t / (70 * S));
        line(x0 + side * t, y0 + t * 0.42, x0 + side * t, y0 + t * 0.42 + 6 * S, cRim[0] * f, cRim[1] * f, cRim[2] * f);
      }
    }

  // کوچک‌کردن به اندازهٔ اصلی (میانگین ۲×۲ ⇒ ضدلبه و نرم)
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) {
          const i = ((y * S + dy) * w + x * S + dx) * 3;
          r += lo[i];
          g += lo[i + 1];
          b += lo[i + 2];
        }
      const n = S * S,
        o = (y * W + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  return imageLike(W, H, out);
}

/** عکسِ نمای جانبی: بازوی دسته با نسبتِ واقعی نسبت به ارتفاعِ عدسی */
export function sidePhoto({ templeLenPx = 580, lensHPx = 168, W = 760, H = 320 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const grain = 8 * Math.sin(x / 11);
      data[i] = 224 + grain;
      data[i + 1] = 220 + grain;
      data[i + 2] = 210 + grain;
      data[i + 3] = 255;
    }
  const x0 = (W - templeLenPx) / 2,
    y0 = (H - lensHPx) / 2;
  for (let y = y0; y < y0 + lensHPx; y++)
    for (let x = x0; x < x0 + templeLenPx; x++) {
      const i = (y * W + Math.round(x)) * 4;
      const f = 0.7 + 0.35 * Math.max(0, Math.sin((y - y0) / 9));
      data[i] = 44 * f;
      data[i + 1] = 46 * f;
      data[i + 2] = 50 * f;
    }
  return imageLike(W, H, data);
}
