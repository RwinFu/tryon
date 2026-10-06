/**
 * kit.js — خطِ تولیدِ «۳ عکس → فریمِ آمادهٔ پرو»
 *
 * فرمولِ ثابت (هر بار با همین ترتیب اجرا می‌شود):
 *
 *   ۱) مات‌گیری (matte.js):    حذف پس‌زمینه، سایه و هاله برای هر سه عکس
 *   ۲) اندازه‌گیری (photogram): خطِ عدسی، پل، ضخامتِ رینگ، مقیاسِ میلی‌متری
 *   ۳) رخِ دسته (templeProfile): طول، ضخامت، تaper و خمِ پشتِ گوش از هر دسته
 *   ۴) چفت‌کردن (stitch):      یک‌کاره‌کردنِ اندازه‌ها، ترازِ دو دسته، ساختِ spec
 *   ۵) کنترلِ کیفیت (QA):      هر مرحله بررسی می‌شود؛ خطاها با اصلاحِ خودکار یا پیشنهاد
 *   ۶) خروجی:                 spec + بافت‌های برش‌خورده (decals) + JSONِ محصول
 *
 * خروجیٔ اصلی {@link buildFrameKit} است؛ UI (صفحهٔ build.html و استودیو) فقط
 * همین را صدا می‌زند و گزارش را نشان می‌دهد. همه‌چیز محلی و بدون آپلود است.
 */

import { cutout, isBlank } from "./matte.js";
import { frameFromImage, guessShape, appearanceOf, mirrorImageData } from "./photogram.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round = (v, n = 1) => +Number(v).toFixed(n);
/** میانگینِ متحرک برای هموارکردنِ نمودارِ ستونی */
function smoothArr(arr, win = 5) {
  const out = new Array(arr.length);
  const r = win >> 1;
  for (let i = 0; i < arr.length; i++) {
    let s = 0,
      n = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= arr.length || !Number.isFinite(arr[j])) continue;
      s += arr[j];
      n++;
    }
    out[i] = n ? s / n : arr[i];
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۱) کمک‌ها
 * ───────────────────────────────────────────────────────────────────────── */

/** چرخش ۹۰ درجه (وقتی عکسِ دسته عمودی گرفته شده) — ابعاد جابه‌جا می‌شود */
export function rotate90(image, dir = 1) {
  const { width: w, height: h, data } = image;
  const nw = h,
    nh = w;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      // dir=1 ⇒ ۹۰° ساعت‌گرد: ستونِ آخر می‌شود سطرِ اول
      const nx = dir > 0 ? h - 1 - y : y;
      const ny = dir > 0 ? x : w - 1 - x;
      const o = (ny * nw + nx) * 4;
      out[o] = data[s];
      out[o + 1] = data[s + 1];
      out[o + 2] = data[s + 2];
      out[o + 3] = data[s + 3];
    }
  return { width: nw, height: nh, data: out };
}

/** آینهٔ افقیِ یک تصویرِ RGBA */
export function flipX(image) {
  const { width: w, height: h, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + (w - 1 - x)) * 4,
        o = (y * w + x) * 4;
      out[o] = data[s];
      out[o + 1] = data[s + 1];
      out[o + 2] = data[s + 2];
      out[o + 3] = data[s + 3];
    }
  return { width: w, height: h, data: out };
}

/** ماسکِ سخت از کانالِ آلفای یک برش */
function alphaMask(image, min = 24) {
  const m = new Uint8Array(image.width * image.height);
  for (let i = 0, p = 3; i < m.length; i++, p += 4) m[i] = image.data[p] > min ? 1 : 0;
  return m;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۲) رخِ دسته از عکسِ دسته
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * از عکسِ نمای‌جانبیِ یک دسته: طول، ضخامت، نسبتِ باریک‌شوندگی و خمِ پشتِ گوش.
 *
 * فرض: دسته در عکس افقی است (اگر عمودی باشد، خودکار می‌چرخد). جهتِ canonical
 * این است که **لولا در چپ** و **نوکِ پشت‌گوش در راست** باشد؛ اگر عکس برعکس
 * باشد، برمی‌گردد و در خروجی علامت می‌زند.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image برشِ تمیز (RGBA)
 * @param {{templeLen?:number, mmPerPx?:number, side?:'L'|'R'}} opts
 *        templeLen طولِ چاپی (مثلاً ۱۴۵) ⇒ مقیاس دقیق؛ در نبودش از mmPerPx یا ۱۴۵mm فرضی
 */
export function templeProfile(image, opts = {}) {
  let img = image;
  const rotated = img.height > img.width * 1.05;
  if (rotated) img = rotate90(img, img.height > img.width ? 1 : -1);
  const w = img.width,
    h = img.height;
  const mask = alphaMask(img);

  // ستون‌های هر ستون: بالا، پایین، ضخامت، میانه
  const top = new Array(w).fill(NaN),
    bot = new Array(w).fill(NaN);
  for (let x = 0; x < w; x++) {
    let t = -1,
      b = -1;
    for (let y = 0; y < h; y++) {
      if (!mask[y * w + x]) continue;
      if (t < 0) t = y;
      b = y;
    }
    if (t >= 0) {
      top[x] = t;
      bot[x] = b;
    }
  }
  let ink = top.map((v) => Number.isFinite(v));
  if (!ink.some(Boolean)) return { ok: false, reason: "empty" };
  let x0 = ink.indexOf(true);
  let x1 = w - 1;
  while (x1 > x0 && !ink[x1]) x1--;
  const lenPx = x1 - x0 + 1;
  const heights = [];
  const mids = [];
  const tops = [];
  const bots = [];
  for (let x = x0; x <= x1; x++) {
    const t = Number.isFinite(top[x]) ? top[x] : NaN;
    const b = Number.isFinite(bot[x]) ? bot[x] : NaN;
    heights.push(Number.isFinite(t) ? b - t + 1 : NaN);
    mids.push(Number.isFinite(t) ? (t + b) / 2 : NaN);
    tops.push(t);
    bots.push(b);
  }
  // جاهای خالی (سوراخِ بینِ دسته و زمینه) را درون‌یابی می‌کنیم
  const fillGaps = (arr) => {
    const out = arr.slice();
    for (let i = 0; i < out.length; i++) {
      if (Number.isFinite(out[i])) continue;
      let a = i - 1,
        b = i + 1;
      while (a >= 0 && !Number.isFinite(out[a])) a--;
      while (b < out.length && !Number.isFinite(out[b])) b++;
      out[i] = a >= 0 && b < out.length ? (out[a] + out[b]) / 2 : a >= 0 ? out[a] : b < out.length ? out[b] : NaN;
    }
    return out;
  };
  const H = smoothArr(fillGaps(heights), 7);
  const M = smoothArr(fillGaps(mids), 9);

  // ── جهت: کدام سر لولاست؟ انتهای کلفت‌تر + صاف‌تر = لولا؛ نوکِ پشت‌گوش باریک و خمیده
  const n = H.length;
  const seg = Math.max(4, Math.round(n * 0.15));
  const avg = (a, from, to) => {
    let s = 0,
      c = 0;
    for (let i = from; i < to; i++)
      if (Number.isFinite(a[i])) {
        s += a[i];
        c++;
      }
    return c ? s / c : 0;
  };
  const hLeft = avg(H, 0, seg),
    hRight = avg(H, n - seg, n);
  const slope = (from, to) => {
    const a = M[from],
      b = M[to - 1];
    return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / Math.max(1, to - from) : 0;
  };
  const sLeft = slope(0, seg),
    sRight = slope(n - seg, n);
  // امتیاز: هر سر که ضخیم‌تر و کم‌شیب‌تر است لولاست
  const scoreL = hLeft / Math.max(0.5, hRight) + Math.abs(sRight) - Math.abs(sLeft) * 0.5;
  const hingeAtLeft = scoreL >= 1;
  let flipped = false;
  if (!hingeAtLeft) {
    H.reverse();
    M.reverse();
    tops.reverse();
    bots.reverse();
    flipped = true;
  }

  // ── مقیاس: عددِ چاپیِ طولِ دسته (اگر هست) از مقیاسِ عکسِ جلو معتبرتر است،
  //    چون دسته معمولاً در عکسِ جداگانه و با فاصلهٔ دیگر گرفته می‌شود.
  const mmPerPx = opts.templeLen
    ? opts.templeLen / Math.max(1, lenPx)
    : opts.mmPerPx && opts.mmPerPx > 0
      ? opts.mmPerPx
      : 145 / Math.max(1, lenPx);
  const lengthMm = round(lenPx * mmPerPx, 1);
  const hHinge = avg(H, 0, Math.max(3, Math.round(n * 0.12)));
  const hTip = avg(H, Math.max(0, n - Math.round(n * 0.12)), n);
  const hMax = Math.max(...H.filter(Number.isFinite));
  const heightMm = round(hHinge * mmPerPx, 1);
  const tipMm = round(hTip * mmPerPx, 1);
  const taper = round(clamp(hTip / Math.max(0.5, hHinge), 0.35, 1), 2);

  // ── خمِ پشتِ گوش: انحرافِ خطِ میانه از وترِ لولا→نوک
  const y0 = M[0],
    y1 = M[n - 1];
  const dev = M.map((y, i) => (Number.isFinite(y) ? (y - (y0 + ((y1 - y0) * i) / Math.max(1, n - 1))) * mmPerPx : 0));
  const dropMm = round(Math.max(...dev.map(Math.abs)), 1);
  // نقطهٔ شروعِ خم: جایی که انحراف از ۲۵٪ِ بیشینه می‌گذرد
  let bendAt = 0.82;
  const thr = Math.max(...dev.map(Math.abs)) * 0.25;
  for (let i = 0; i < dev.length; i++)
    if (Math.abs(dev[i]) >= thr) {
      bendAt = round(clamp(i / Math.max(1, n - 1), 0.5, 0.95), 2);
      break;
    }
  // انحنایِ به سمت پایین (علامت): در عکس y رو به پایین است ⇒ انحرافِ مثبت یعنی افت
  const dirDown = dev[dev.length - 1] >= 0 || dev.reduce((a, v) => a + v, 0) >= 0;

  /* نمایهٔ ستونی: برای هر ستون، بالا و پایینِ جوهر بر حسبِ کسری از بلندای عکس.
     decals.js با همین، عکس را روی نوارِ سه‌بعدیِ دسته می‌نشاند؛ بدون آن، خمِ
     پشتِ گوشِ خودِ عکس دوبار حساب می‌شود و نوکِ دسته کج می‌افتد. */
  const PN = 64;
  const profile = { n: PN, top: [], bot: [] };
  for (let k = 0; k < PN; k++) {
    const i = Math.min(n - 1, Math.round((k / (PN - 1)) * (n - 1)));
    const t = Number.isFinite(tops[i]) ? tops[i] : 0;
    const b2 = Number.isFinite(bots[i]) ? bots[i] : h - 1;
    profile.top.push(+clamp(t / Math.max(1, h - 1), 0, 1).toFixed(4));
    profile.bot.push(+clamp(b2 / Math.max(1, h - 1), 0, 1).toFixed(4));
  }

  const aspect = lenPx / Math.max(1, hMax);
  // معقول‌بودن را با اندازهٔ فیزیکی می‌سنجیم (نسبتِ پیکسلی به بزرگ‌نمایی بستگی دارد)
  const plausible =
    lengthMm > 100 && lengthMm < 172 && heightMm > 1.8 && heightMm < 14 && hMax * mmPerPx < 42 && aspect > 2.6;
  const coverage = H.filter((v, i) => Number.isFinite(v) && i % 7 === 0).length / Math.ceil(n / 7 || 1);

  return {
    ok: true,
    side: opts.side || null,
    lengthMm,
    heightMm,
    tipMm,
    maxHeightMm: round(hMax * mmPerPx, 1),
    taper,
    earDropMm: dirDown ? dropMm : -dropMm,
    earBendAt: bendAt,
    mmPerPx: +mmPerPx.toFixed(4),
    lengthPx: lenPx,
    rotated,
    flipped,
    aspect: +aspect.toFixed(2),
    profile,
    estimated: !opts.templeLen && !opts.mmPerPx,
    confidence: Math.round(
      clamp(58 + (plausible ? 22 : -14) + Math.min(14, coverage * 14) - (rotated ? 4 : 0) - (opts.templeLen ? 0 : 8), 8, 97),
    ),
    notes: { seg, hLeft: round(hLeft, 1), hRight: round(hRight, 1), sLeft: +sLeft.toFixed(3), sRight: +sRight.toFixed(3) },
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۳) کنترلِ کیفیت
 * ───────────────────────────────────────────────────────────────────────── */

const QA = {
  ok: (id, title, detail) => ({ id, level: "ok", title, detail }),
  warn: (id, title, detail, fix) => ({ id, level: "warn", title, detail, fix }),
  fail: (id, title, detail, fix) => ({ id, level: "fail", title, detail, fix }),
};

/* ─────────────────────────────────────────────────────────────────────────
 *  ۴) خطِ تولید
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * سه عکس (جلو + دستهٔ چپ + دستهٔ راست) → فریمِ آمادهٔ پرو.
 *
 * @param {{front?:object, templeL?:object, templeR?:object}} photos  تصویرهای ImageData
 * @param {{lensW?:number, dbn?:number, templeLen?:number, name?:string, id?:string,
 *          mirrorFront?:boolean, deskew?:boolean, tolerance?:number, shadow?:number}} opts
 * @returns {{ok:boolean, spec?:object, decals?:object, qa:Array, report?:object, product?:object, reason?:string}}
 */
export function buildFrameKit(photos = {}, opts = {}) {
  const qa = [];
  const { front, templeL, templeR } = photos;
  if (!front) return { ok: false, reason: "no-front", qa: [QA.fail("front.missing", "عکسِ روبه‌رو نیست", "دست‌کم عکسِ تمام‌جبهه لازم است.")] };

  /* ── ۱. مات‌گیریِ هر سه عکس ─────────────────────────────────────────── */
  const matteOpts = {
    tolerance: opts.tolerance,
    shadow: opts.shadow,
    feather: opts.feather ?? 1.6,
    pad: 2,
  };
  const frontCut = cutout(front, matteOpts);
  if (isBlank(frontCut.image)) return { ok: false, reason: "front-blank", qa: [QA.fail("front.blank", "عکسِ روبه‌رو خالی شد", "جداسازی چیزی پیدا نکرد؛ آستانه را کم کن یا پس‌زمینه را یکدست‌تر کن.", { type: "tolerance", value: 18 })] };
  qa.push(
    frontCut.meta.confidence >= 70
      ? QA.ok("front.matte", "جداسازیِ پس‌زمینه", `اطمینان ${frontCut.meta.confidence}٪ · قطعه‌های افتاده: ${frontCut.meta.dropped} · سوراخ‌های بازمانده: ${frontCut.meta.holesKept}`)
      : QA.warn(
          "front.matte",
          "جداسازیِ پس‌زمینه ضعیف است",
          `اطمینان ${frontCut.meta.confidence}٪. پس‌زمینهٔ یکدست یا آستانهٔ دستی نتیجه را بهتر می‌کند.`,
          { type: "tolerance", value: 26 },
        ),
  );

  /* ── ۲. اندازه‌گیریِ عکسِ جلو ───────────────────────────────────────── */
  const measured = frameFromImage(frontCut.image, {
    lensW: opts.lensW,
    dbn: opts.dbn,
    mirror: opts.mirrorFront,
    deskew: opts.deskew !== false,
  });
  if (!measured.ok) return { ok: false, reason: measured.reason, qa: [...qa, QA.fail("front.measure", "اندازه‌گیری ناموفق", `دلیل: ${measured.reason}. عکسِ تمام‌جبهه با نورِ یکنواخت لازم است.`)] };

  const look = appearanceOf(measured) || {};
  const shape = guessShape(measured.lensPath);
  const mmPerPx = measured.notes?.mmPerPx || 0.1;

  if (measured.source === "silhouette")
    qa.push(QA.warn("front.lens", "عدسی تیره/آینه‌ای است", "داخل عدسی دیده نمی‌شود؛ اندازه از لبهٔ بیرونی حدس زده شده (±۲mm)."));
  else if (measured.source === "rows")
    qa.push(QA.warn("front.lens", "خطِ عدسی از سطرها تخمین زده شد", "عکس را نزدیک‌تر و بدون سایه بگیر."));
  else qa.push(QA.ok("front.lens", "خطِ عدسی پیدا شد", `روش: ${measured.source} · کیفیتِ انطباق ${measured.match}٪`));

  if ((measured.symmetry ?? 1) < 0.96)
    qa.push(QA.warn("front.symmetry", "دو عدسی هم‌اندازه نیستند", `تقارن ${measured.symmetry}. عکس سه‌رخ است یا جداسازی خطا رفته؛ عددِ پل را دستی بده.`, { type: "dbn" }));
  if (!opts.lensW)
    qa.push(QA.warn("front.scale", "مقیاس فرضی است", "عددِ چاپیِ عرضِ عدسی (مثلاً ۵۲) را بده تا همهٔ اندازه‌ها دقیق شوند.", { type: "lensW", value: 52 }));
  if (Math.abs(measured.deskewDeg || 0) > 7)
    qa.push(QA.warn("front.deskew", `عکس ${Math.abs(measured.deskewDeg).toFixed(1)} درجه کج بود`, "تراز خودکار انجام شد؛ برای دقتِ بهتر عکس را صاف‌تر بگیر."));

  /* ── ۳. رخِ هر دو دسته ─────────────────────────────────────────────── */
  const templeParts = {};
  for (const [key, photo, side] of [
    ["right", templeR, "R"],
    ["left", templeL, "L"],
  ]) {
    if (!photo) continue;
    const cut = cutout(photo, { ...matteOpts, pieces: 1, maxHolePx: 400 });
    if (isBlank(cut.image)) {
      qa.push(QA.fail(`temple.${key}`, `عکسِ دستهٔ ${key === "right" ? "راست" : "چپ"} خالی شد`, "جداسازی چیزی پیدا نکرد.", { type: "tolerance", value: 20 }));
      continue;
    }
    const prof = templeProfile(cut.image, { templeLen: opts.templeLen, mmPerPx, side });
    if (!prof.ok) {
      qa.push(QA.fail(`temple.${key}`, `دستهٔ ${key === "right" ? "راست" : "چپ"} اندازه‌گیری نشد`, "عکسِ دسته باید افقی و کامل در کادر باشد."));
      continue;
    }
    templeParts[key] = { cut, prof, image: prof.flipped ? flipX(cut.image) : cut.image };
    const label = key === "right" ? "راست" : "چپ";
    qa.push(
      prof.confidence >= 65
        ? QA.ok(`temple.${key}`, `دستهٔ ${label}`, `طول ${prof.lengthMm}mm · ضخامت ${prof.heightMm}mm · افت ${Math.abs(prof.earDropMm)}mm${prof.flipped ? " · جهت اصلاح شد" : ""}`)
        : QA.warn(`temple.${key}`, `دستهٔ ${label} با اطمینانِ کم`, `اطمینان ${prof.confidence}٪ · نسبت ${prof.aspect}. عکس را افقی و تا انتهای دسته بگیر.`, { type: "templeLen" }),
    );
    if (prof.estimated)
      qa.push(QA.warn(`temple.${key}.scale`, "مقیاسِ دسته تخمینی است", "عددِ چاپیِ طولِ دسته (مثلاً ۱۴۵) را بده تا مقیاس دقیق شود.", { type: "templeLen", value: 145 }));
  }

  // تقارنِ دو دسته
  let templeLen = opts.templeLen ? +opts.templeLen : null;
  let earDrop = null,
    templeW = null,
    taper = null,
    bendAt = null;
  if (templeParts.right && templeParts.left) {
    const R = templeParts.right.prof,
      L = templeParts.left.prof;
    /* یک دسته ممکن است در عکس ناقص/کراپ‌شده باشد (مثلاً فقط نیمی از دسته در کادر).
       میانگین‌گرفتن در آن حالت نتیجه را خراب می‌کند (نه این، نه آن)؛ پس:
         • هر دو سالم و نزدیک ⇒ میانگینِ وزن‌دار؛
         • هر دو سالم ولی خیلی متفاوت ⇒ دستهٔ کامل‌تر (بلندتر) + هشدار؛
         • یکی ناسالم ⇒ همان یکیِ سالم + هشدار. */
    const sane = (p) => p.lengthMm >= 100 && p.lengthMm <= 172;
    let chosen = null;
    if (!templeLen) {
      if (sane(R) && sane(L)) {
        const d = Math.abs(R.lengthMm - L.lengthMm);
        const rel = d / Math.max(R.lengthMm, L.lengthMm);
        if (rel > 0.12) {
          chosen = R.lengthMm >= L.lengthMm ? R : L;
          qa.push(
            QA.warn(
              "temple.symmetry",
              "دو دسته هم‌اندازه نیستند",
              `اختلاف ${round(d, 1)}mm (${Math.round(rel * 100)}٪). یکی از عکس‌ها ناقص است؛ اندازهٔ دستهٔ کامل‌تر (${
                chosen.lengthMm
              }mm) استفاده شد و برای هر دو سمت به کار رفت.`,
              { type: "swapTemples" },
            ),
          );
        } else {
          const cr = R.confidence,
            cl = L.confidence;
          templeLen = round((R.lengthMm * cr + L.lengthMm * cl) / Math.max(1, cr + cl), 0);
          if (d > 4)
            qa.push(
              QA.warn("temple.symmetry", "دو دسته کمی متفاوت‌اند", `اختلاف ${round(d, 1)}mm — میانگینِ وزن‌دار گرفته شد.`, {
                type: "swapTemples",
              }),
            );
        }
      } else if (sane(R) || sane(L)) {
        chosen = sane(R) ? R : L;
        const bad = sane(R) ? L : R;
        qa.push(
          QA.warn(
            "temple.partial",
            "یکی از عکس‌های دسته ناقص است",
            `این عکس ${bad.lengthMm}mm را نشان می‌دهد (برای یک دسته بسیار کوتاه است). اندازه از دستهٔ دیگر (${chosen.lengthMm}mm) گرفته شد.`,
          ),
        );
      } else {
        templeLen = round((R.lengthMm + L.lengthMm) / 2, 0);
        chosen = R.confidence >= L.confidence ? R : L;
        qa.push(QA.warn("temple.short", "هر دو دسته کوتاه‌تر از حدِ معمول اندازه گرفته شدند", `میانگین ${templeLen}mm؛ عکس‌ها را تا انتهای دسته و افقی بگیر.`, { type: "templeLen", value: 145 }));
      }
      if (chosen) templeLen = chosen.lengthMm;
    }
    const a = templeParts.right.prof,
      b = templeParts.left.prof;
    const pick = chosen || (a.confidence >= b.confidence ? a : b);
    earDrop = round(Math.abs(pick.earDropMm), 1);
    templeW = round(pick.heightMm, 1);
    taper = pick.taper;
    bendAt = pick.earBendAt;
  } else if (templeParts.right || templeParts.left) {
    const p = (templeParts.right || templeParts.left).prof;
    templeLen = templeLen || p.lengthMm;
    earDrop = Math.abs(p.earDropMm);
    templeW = p.heightMm;
    taper = p.taper;
    bendAt = p.earBendAt;
    qa.push(QA.warn("temple.one", "فقط یک دسته اندازه‌گیری شد", "دستهٔ دیگر برای هر دو سمت کپی می‌شود (آینه). برای تقارنِ واقعی هر دو را بفرست."));
  } else {
    templeLen = templeLen || 145;
    qa.push(QA.warn("temple.none", "عکسِ دسته نداریم", "طولِ دسته فرضِ ۱۴۵mm شد؛ با عکسِ دسته یا عددِ چاپی دقیق‌تر می‌شود.", { type: "templeLen", value: 145 }));
  }

  /* ── ۴. چفت‌کردن: ساختِ spec ───────────────────────────────────────── */
  /* ضخامتِ رینگ: دو تخمین داریم —
       الف) پرتابِ پرتو از خطِ عدسی تا لبه (photogram.rimBand) که با بازتاب/بِوِل گول می‌خورد؛
       ب) قیدِ بستار روی سیلوئت: پهنای کلِ عکس = دو عدسی + پل + دو رینگ.
     هرگاه هر دو در دسترس باشند، وزنِ بیشتر به (ب) می‌دهیم چون یک رابطهٔ هندسی است
     نه اندازه‌گیریِ موضعی؛ اختلافِ زیاد را هم در گزارش می‌گوییم. */
  let rimW = measured.rimW;
  const rimSil = measured.totalWidth ? (measured.totalWidth - 2 * measured.lensW - measured.dbn) / 2 : null;
  if (rimSil != null && rimSil > 1.2 && rimSil < 9.5) {
    const blended = round(0.35 * measured.rimW + 0.65 * rimSil, 1);
    if (Math.abs(measured.rimW - rimSil) > 1.5)
      qa.push(
        QA.warn(
          "spec.rim",
          "ضخامتِ رینگ از پهنای کل تصحیح شد",
          `پرتو ${measured.rimW}mm و بستارِ سیلوئت ${round(rimSil, 1)}mm گفتند؛ ${blended}mm انتخاب شد. اگر رینگ را می‌دانی، دستی بده.`,
          { type: "rimW", value: blended },
        ),
      );
    rimW = blended;
  }

  const spec = {
    shape,
    style: "full",
    material: look.material || "acetate",
    lensW: round(clamp(measured.lensW, 30, 70), 1),
    lensH: round(clamp(measured.lensH, 18, 64), 1),
    dbn: round(clamp(measured.dbn, 9, 28), 1),
    rimW: round(clamp(rimW, 1.2, 9), 1),
    rimT: round(clamp(measured.rimW * 0.72, 1.4, 6), 1),
    templeLen: round(clamp(templeLen, 105, 170), 0),
    templeW: round(clamp(templeW ?? Math.max(3.4, measured.rimW * 0.92), 2.4, 9), 1),
    templeT: round(clamp((templeW ?? 5) * 0.54, 1.4, 5), 1),
    templeTaper: clamp(taper ?? 0.72, 0.35, 1),
    earDrop: round(clamp(earDrop ?? 8.5, 0, 22), 1),
    earBendAt: clamp(bendAt ?? 0.82, 0.55, 0.95),
    lensPath: measured.lensPath,
    lensPathR: measured.lensPathR,
    lensPathL: measured.lensPathL,
  };
  const finish = look.finish || (look.material === "metal" ? "gunmetal" : "polished-black");
  const color = look.color || "#22252b";
  const lens = look.lens || "clear";

  // sanity
  if (spec.templeLen < 110 || spec.templeLen > 170)
    qa.push(QA.fail("spec.temple", "طولِ دسته غیرِعادی است", `${spec.templeLen}mm خارج از بازهٔ ۱۱۰–۱۷۰ است؛ عددِ چاپی را بده.`, { type: "templeLen", value: 145 }));
  // پهنای کل = دو عدسی + پل + دو رینگ (رینگ بیرونِ خطِ عدسی است)
  const expectWidth = 2 * spec.lensW + spec.dbn + 2 * spec.rimW;
  if (measured.totalWidth && Math.abs(measured.totalWidth - expectWidth) > 12)
    qa.push(
      QA.warn(
        "spec.width",
        "پهنای کل با اندازه‌ها نمی‌خواند",
        `عکس ${measured.totalWidth}mm می‌گوید ولی محاسبه ${round(expectWidth, 1)}mm؛ احتمالاً عدسی‌ها کامل در کادر نیستند یا رینگ کلفت است.`,
        { type: "lensW" },
      ),
    );
  if (qa.every((q) => q.level !== "fail")) qa.push(QA.ok("spec.ready", "فریم آماده است", `${spec.lensW}□${spec.dbn}-${spec.templeLen} · ${qa.length} بررسی انجام شد.`));

  /* ── ۵. بافت‌ها (decals) ──────────────────────────────────────────── */
  const px = measured._pixels;
  const center = measured.notes?.center || { x: px ? px.w / 2 : 0, y: px ? px.h / 2 : 0 };
  const box = px?.box || frontCut.box;
  const decals = {
    front: px
      ? {
          kind: "front",
          image: px.imageData,
          wMm: round(box.w * mmPerPx, 2),
          hMm: round(box.h * mmPerPx, 2),
          dxMm: round(((box.x0 + box.x1) / 2 - center.x) * mmPerPx, 2),
          dyMm: round((center.y - (box.y0 + box.y1) / 2) * mmPerPx, 2),
          rimT: spec.rimT,
        }
      : null,
  };
  for (const key of ["right", "left"]) {
    const part = templeParts[key];
    if (!part) continue;
    const p = part.prof;
    decals[key === "right" ? "templeR" : "templeL"] = {
      kind: "temple",
      side: key === "right" ? "R" : "L",
      image: part.image,
      lengthMm: spec.templeLen,
      heightMm: p.heightMm,
      maxHeightMm: p.maxHeightMm,
      taper: p.taper,
      earDropMm: Math.abs(p.earDropMm),
      profile: p.profile,
    };
  }

  /* ── ۶. خروجی ────────────────────────────────────────────────────── */
  const id = opts.id || "KIT-" + String(Date.now()).slice(-5);
  const product = {
    id,
    name: opts.name || "فریم ساخته‌شده از عکس",
    size: `${Math.round(spec.lensW)}□${Math.round(spec.dbn)}-${Math.round(spec.templeLen)}`,
    lensH: spec.lensH,
    shape: spec.shape,
    material: spec.material,
    finish,
    color,
    lens,
    spec: stripPaths(spec),
    decals: {
      front: `assets/frames/${id}-front.png`,
      templeL: templeParts.left ? `assets/frames/${id}-temple-L.png` : null,
      templeR: templeParts.right ? `assets/frames/${id}-temple-R.png` : null,
    },
    source: "photo-kit",
    note: "ساخته‌شده با خطِ تولیدِ ۳ عکس (kit.js)؛ بافت‌ها از همان عکس‌ها و هندسه از خطِ عدسی استخراج شده است.",
  };

  return {
    ok: true,
    spec: { ...spec, finish, color, lens },
    decals,
    qa,
    product,
    report: {
      measured: {
        lensW: measured.lensW,
        lensH: measured.lensH,
        dbn: measured.dbn,
        rimW: measured.rimW,
        totalWidth: measured.totalWidth,
        match: measured.match,
        source: measured.source,
        symmetry: measured.symmetry,
        deskewDeg: measured.deskewDeg,
        mmPerPx: +mmPerPx.toFixed(3),
      },
      temples: {
        right: templeParts.right?.prof || null,
        left: templeParts.left?.prof || null,
      },
      matte: {
        front: frontCut.meta,
        templeL: templeParts.left?.cut.meta || null,
        templeR: templeParts.right?.cut.meta || null,
      },
      look: { material: look.material, finish, color, lens, confidence: look.confidence },
      cuts: {
        front: frontCut.image,
        templeL: templeParts.left?.image || null,
        templeR: templeParts.right?.image || null,
      },
    },
  };
}

/** spec بدونِ مسیرهای سنگین (برای JSON) */
function stripPaths(spec) {
  const out = { ...spec };
  for (const k of ["lensPath", "lensPathR", "lensPathL"]) delete out[k];
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  ۵) اصلاح‌های دستی (پنلِ UI)
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * اصلاح‌هایی که کاربر می‌تواند روی نتیجه اعمال کند؛ هرکدام یک بازسازیِ ارزان است.
 * @returns {Array<{id:string,label:string,kind:'number'|'bool'|'action',min?:number,max?:number,step?:number,value?:number}>}
 */
export function kitFixes(kit) {
  const fixes = [
    { id: "lensW", label: "عرض عدسی (mm)", kind: "number", min: 34, max: 70, step: 0.5, value: kit.spec.lensW },
    { id: "dbn", label: "پل (mm)", kind: "number", min: 10, max: 26, step: 0.5, value: kit.spec.dbn },
    { id: "templeLen", label: "طول دسته (mm)", kind: "number", min: 105, max: 170, step: 1, value: kit.spec.templeLen },
    { id: "rimW", label: "ضخامت رینگ (mm)", kind: "number", min: 1.2, max: 9, step: 0.1, value: kit.spec.rimW },
    { id: "templeW", label: "ارتفاع دسته (mm)", kind: "number", min: 2.4, max: 9, step: 0.1, value: kit.spec.templeW },
    { id: "earDrop", label: "افتِ پشت گوش (mm)", kind: "number", min: 0, max: 22, step: 0.5, value: kit.spec.earDrop },
    {
      id: "material",
      label: "جنس",
      kind: "select",
      options: [
        ["acetate", "استات (پلاستیک)"],
        ["metal", "فلز"],
        ["titanium", "تیتانیوم"],
        ["steel", "استیل"],
      ],
      value: kit.spec.material,
    },
    {
      id: "finish",
      label: "پرداخت",
      kind: "select",
      options: [
        ["polished-black", "مشکی براق"],
        ["matte-black", "مشکی مات"],
        ["gloss", "براق"],
        ["matte", "مات"],
        ["havana", "هاوانا"],
        ["crystal", "شفاف"],
        ["gold", "طلایی"],
        ["gunmetal", "گان‌متال"],
        ["rose-gold", "رزگلد"],
      ],
      value: kit.spec.finish,
    },
    { id: "color", label: "رنگ", kind: "color", value: kit.spec.color || "#22252b" },
  ];
  if (kit.report?.temples?.right && kit.report?.temples?.left)
    fixes.push({ id: "swapTemples", label: "جابه‌جاییِ دستهٔ چپ و راست", kind: "action" });
  return fixes;
}

/** اعمالِ یک اصلاح روی spec (بدون نیاز به اجرای دوبارهٔ کل خط) */
export function applyFix(kit, patch) {
  const spec = { ...kit.spec };
  const oldLensW = spec.lensW;
  if (patch.swapTemples && kit.decals?.templeL && kit.decals?.templeR) {
    const a = kit.decals.templeL;
    kit.decals.templeL = { ...kit.decals.templeR, side: "L" };
    kit.decals.templeR = { ...a, side: "R" };
  }
  for (const k of ["lensW", "dbn", "templeLen", "rimW", "templeW", "earDrop", "templeTaper", "earBendAt", "lensH"])
    if (patch[k] != null) spec[k] = patch[k];
  for (const k of ["material", "finish", "color"]) if (patch[k] != null) spec[k] = patch[k];
  if (patch.rimW != null) spec.rimT = round(clamp(patch.rimW * 0.72, 1.4, 6), 1);
  spec.templeLen = round(clamp(spec.templeLen, 105, 170), 0);
  /* عرضِ عدسی عوض شود، خطِ ترسیم‌شده و مستطیلِ بافتِ جلو باید هم‌مقیاس شوند؛
     وگرنه هندسه (از مسیر) و بافت (از عکس) دو اندازهٔ مختلف پیدا می‌کنند. */
  if (patch.lensW != null && oldLensW > 0 && Math.abs(patch.lensW - oldLensW) > 0.01) {
    const k = patch.lensW / oldLensW;
    for (const key of ["lensPath", "lensPathR", "lensPathL"])
      if (Array.isArray(spec[key]))
        spec[key] = spec[key].map((p) => (Array.isArray(p) ? [p[0] * k, p[1] * k] : { x: p.x * k, y: p.y * k }));
    const d = kit.decals?.front;
    if (d) {
      d.wMm = round(d.wMm * k, 2);
      d.hMm = round(d.hMm * k, 2);
      d.dxMm = round(d.dxMm * k, 2);
      d.dyMm = round(d.dyMm * k, 2);
    }
  }
  kit.spec = spec;
  if (kit.product) {
    kit.product.spec = stripPaths(spec);
    kit.product.size = `${Math.round(spec.lensW)}□${Math.round(spec.dbn)}-${Math.round(spec.templeLen)}`;
    for (const k of ["material", "finish", "color"]) if (spec[k] != null) kit.product[k] = spec[k];
  }
  if (kit.decals?.templeR) kit.decals.templeR.lengthMm = spec.templeLen;
  if (kit.decals?.templeL) kit.decals.templeL.lengthMm = spec.templeLen;
  return kit;
}
