/**
 * همهٔ id/selectورهایی که کد دنبالشان می‌گردد باید در HTML/قالب وجود داشته باشند.
 * (بزرگ‌ترین منبع باگ این پروژه: تغییر نام یک id در قالب و گم شدنِ silent در JS.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function idsQueried(code, patterns) {
  const found = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code))) if (m[1]) found.add(m[1].replace(/^#/, ""));
  }
  return [...found];
}

function idsPresent(html) {
  const set = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) set.add(m[1]);
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) set.add("." + c);
  return set;
}

test("widget: هر this.$('id') داخل قالب build() هست", () => {
  const src = read("src/ui/widget.js");
  const tpl = src.slice(src.indexOf("build() {"), src.indexOf("renderRail()"));
  const queried = idsQueried(src, [/this\.\$\("([\w-]+)"\)/g, /this\.root\.querySelector\("#([\w-]+)"\)/g, /getElementById\("([\w-]+)"\)/g]);
  assert.ok(queried.length > 12, "استخراج selectorها کم بود: " + queried.length);
  const missing = queried.filter((id) => !new RegExp('id="' + id + '"').test(tpl));
  assert.deepEqual(missing, [], "این idها در قالب widget نیستند:\n" + missing.map((x) => "   ✗ " + x).join("\n"));
});

test("widget: هر کلاس CSS در styles.css تعریف شده (یا part است)", () => {
  const src = read("src/ui/widget.js");
  const css = read("src/ui/styles.css");
  const classes = new Set();
  for (const m of src.matchAll(/class="([^"$]+)"/g)) for (const c of m[1].trim().split(/\s+/)) if (c && !c.includes("{")) classes.add(c);
  const missing = [...classes].filter((c) => !css.includes("." + c));
  assert.deepEqual(missing, [], "کلاس‌های بی‌استایل:\n" + missing.map((x) => "   ✗ " + x).join("\n"));
});

test("studio: هر #id که studio.js می‌خواهد در studio.html هست", () => {
  const src = read("src/studio/studio.js");
  const html = read("studio.html");
  const queried = idsQueried(src, [/\$\("#([\w-]+)"\)/g, /getElementById\("([\w-]+)"\)/g, /querySelector\("#([\w-]+)"\)/g]);
  assert.ok(queried.length > 8, "استخراج selectorهای استودیو کم بود");
  const madeById = [...src.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
  const have = new Set([...idsPresent(html), ...madeById]);
  const missing = queried.filter((id) => !have.has(id));
  assert.deepEqual(missing, [], "استودیو این المان‌ها را پیدا نمی‌کند:\n" + missing.map((x) => "   ✗ #" + x).join("\n"));
});

test("دمو: فایل‌های اشاره‌شده در index.html وجود دارند", () => {
  const html = read("index.html");
  const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3, "ارجاعی پیدا نشد");
  for (const r of refs) assert.ok(fs.existsSync(path.join(root, r.replace(/^\.\//, ""))), "فایل گم‌شده: " + r);
});

test("i18n: هر برچسبی که widget با t() می‌خواند در دیکشنری هست", () => {
  const src = read("src/ui/widget.js");
  const i18n = read("src/ui/i18n.js");
  const keys = new Set();
  for (const m of src.matchAll(/\bt\((?:c\.lang|cfg\.lang|this\.cfg\.lang|this\.lang), "([\w]+)"\)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/L\("([\w]+)"\)/g)) keys.add(m[1]);
  assert.ok(keys.size > 25, "کلیدهای brچسب کم است: " + keys.size);
  const dict = i18n.slice(i18n.indexOf("fa: {"), i18n.indexOf("en: {"));
  const missing = [...keys].filter((k) => !new RegExp('"' + k + '":|\\b' + k + ":").test(dict));
  assert.deepEqual(missing, [], "کلید در دیکشنری فارسی نیست:\n" + missing.map((x) => "   ✗ " + x).join("\n"));
});
