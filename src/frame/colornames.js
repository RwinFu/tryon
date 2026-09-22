/**
 * colornames.js — اسم رنگ (فارسی/انگلیسی) → هگز
 * فروشگاه‌ها معمولاً رنگ را فقط در «عنوانِ» گزینه دارند (مشکی براق / Havana Tan)؛
 * این جدول همان عنوان را به رنگِ متریال تبدیل می‌کند تا فریم سه‌بعدی درست دیده شود.
 */
export const COLOR_WORDS = [
  ["مشکی", "#1c1c1e", "black"],
  ["ذغالی", "#25262a", "charcoal"],
  ["سفید", "#f1efe9", "white"],
  ["کرم", "#e8ddc7", "cream|ivory|bone"],
  ["بژ", "#d9c6a5", "beige|sand"],
  ["قهوه‌ای", "#5a3a24", "brown|havana|coffee"],
  ["عسلی", "#b3803a", "honey|amber|tortoiseshell"],
  ["شتری", "#9c6b3f", "camel|tan"],
  ["طوسی", "#8b8f94", "gray|grey|smoke"],
  ["آبی", "#1f4e79", "blue"],
  ["سرمه‌ای", "#1b2740", "navy"],
  ["آبی‌روی", "#3f6f8f", "steel|denim"],
  ["سبز", "#2f5d3f", "green|olive|khaki"],
  ["یشمی", "#1f6f6a", "teal|turquoise"],
  ["قرمز", "#8e2020", "red|crimson"],
  ["زرشکی", "#5d1f2c", "burgundy|wine|merlot"],
  ["مس", "#a3603b", "rose gold|copper|bronze"],
  ["صورتی", "#c98a95", "pink|rose"],
  ["بنفش", "#4a3560", "purple|violet|plum"],
  ["طلایی", "#c9a24a", "gold|brass"],
  ["نقره‌ای", "#c7ccd1", "silver|palladium"],
  ["عنابی", "#6d1f2a", "garnet"],
  ["شفاف", "#dfe6e8", "clear|transparent|crystal"],
  ["دودی", "#4a4a4d", "smoke|grey fade|gradient"],
];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** #hex مستقیم، یا اسم → هگز؛ اگر نشناخت مشکی برمی‌گرداند (نه undefined) */
export function guessColorHex(name, fallback = "#24262b") {
  if (!name) return fallback;
  const s = String(name).trim();
  if (HEX.test(s)) return s.length === 4 ? "#" + [...s.slice(1)].map((c) => c + c).join("") : s;
  const low = s.toLowerCase();
  for (const [fa, hex, en] of COLOR_WORDS) {
    if (s.includes(fa)) return hex;
    if (en && new RegExp("\\b(?:" + en.split("|").join("|") + ")\\b", "i").test(low)) return hex;
  }
  const m = low.match(/#[0-9a-f]{6}/);
  return m ? m[0] : fallback;
}

/** آیا این عنوانِ گزینه، «رنگ» است؟ (برای جدا کردن رنگ از سایز در Shopify/Woo) */
export function isColorOption(title) {
  return /رنگ|color|رنگب|رنگ‌بندی|finish|رنگ‌بندی/i.test(String(title || ""));
}

/** «قواره: 54□17» → { size: "54□17" }؛ هر گزینه‌ای که سایز باشد */
export function pickSizeOption(title) {
  return /سایز|size|قواره|dimension|size\(mm\)/i.test(String(title || ""));
}
