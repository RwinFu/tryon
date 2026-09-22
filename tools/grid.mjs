/**
 * tools/grid.mjs — رندر شبکه‌ای از فریم‌ها برای بازبینی چشمی
 *   node tools/grid.mjs --specs '[{...},{...}]' --views 3 --out /tmp/grid.png
 */
import { readFileSync } from "node:fs";
import { previewFrame } from "./preview.mjs";
const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const raw = get("specs", "[]");
const specs = JSON.parse(raw.startsWith("[") ? raw : readFileSync(raw, "utf8"));
const res = await previewFrame(specs, get("out", "/tmp/grid").replace(/\.png$/, ""), {
  views: +get("views", 3),
  bg: get("bg", "#14181d"),
});
console.log(res.file, JSON.stringify(res.metas));
