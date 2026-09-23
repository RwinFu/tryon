/**
 * استودیو در لحظهٔ لود، کدِ سطحِ ماژول اجرا می‌کند؛ اگر به یک const/let که پایین‌تر تعریف شده
 * دست بزند → Temporal Dead Zone → صفحهٔ سفید («Ec is not a function» در نسخهٔ مینیفای‌شده).
 * این تست همان ترتیب را استاتیک چک می‌کند (برای widget/plugin هم که سطحِ ماژول دارند).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");

function topLevelBlocks(src) {
  const lines = src.split("\n");
  const blocks = [];
  let cur = null;
  let depth = 0; // عمق آکولاد/پرانتز تا شروع بلوک‌های سطح‌بالا را درست تشخیص دهیم
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (depth === 0 && /^\S/.test(ln) && !/^[}\])]/.test(ln)) {
      cur = { start: i + 1, text: "" };
      blocks.push(cur);
    }
    if (cur) cur.text += ln + "\n";
    for (const ch of ln.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    }
  }
  return blocks;
}

function tdzViolations(src) {
  const blocks = topLevelBlocks(src);
  const declared = new Map(); // نام → شمارهٔ خطِ تعریف (const/let)
  for (const b of blocks) {
    const m = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(b.text);
    if (m) declared.set(m[1], b.start);
  }
  const bad = [];
  for (const b of blocks) {
    // بدنهٔ تابع/کلاس/تابعِ پیکانی هنگام لود اجرا نمی‌شود
    if (/^(?:export\s+)?(?:async\s+)?function\b|^(?:export\s+)?class\b|^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/.test(b.text)) continue;
    if (/^(?:import|export)\b/.test(b.text)) continue;
    const own = /^(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(b.text)?.[1];
    for (const [name, at] of declared) {
      if (name === own || at <= b.start) continue;
      // callbackهای داخل بلوک (map/forEach/…) هم معمولاً همان لحظه اجرا می‌شوند؛ محافظه‌کارانه همه را می‌شماریم
      if (new RegExp("(?<![\\w$.])" + name.replace(/\$/g, "\\$") + "\\s*\\(").test(b.text)) bad.push(`${name}() در خط ${b.start} استفاده شده ولی در خط ${at} تعریف می‌شود`);
    }
  }
  return bad;
}

for (const f of ["src/studio/studio.js", "src/plugin.js", "src/ui/widget.js", "src/loader.js"]) {
  test(`${f}: کدِ سطحِ ماژول به const/let پایین‌تر از خودش دست نمی‌زند (TDZ)`, () => {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.deepEqual(tdzViolations(src), []);
  });
}

test("تشخیص TDZ روی نمونهٔ خراب کار می‌کند", () => {
  const sample = `const $ = (s) => s;\n$("#x").innerHTML = list.map((p) => esc(p.name)).join("");\nconst esc = (s) => String(s);\n`;
  assert.equal(tdzViolations(sample).length, 1);
});
