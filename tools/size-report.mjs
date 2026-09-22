/** tools/size-report.mjs — اندازهٔ بارِ نهایی افزونه (برای README و صفحهٔ فروش) */
import fs from "node:fs";
import path from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const files = ["dist/tryon.js", "dist/tryon.debug.js", "products.json", "lib/tasks-vision/vision_bundle.mjs", "lib/tasks-vision/wasm", "lib/face_landmarker.task"];
let total = 0;
console.log("فایل".padEnd(38) + "خام".padStart(11) + "gzip".padStart(11) + "brotli".padStart(11));
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) {
    console.log(f.padEnd(38) + "—");
    continue;
  }
  if (fs.statSync(p).isDirectory()) {
    const n = fs.readdirSync(p).length;
    console.log(f.padEnd(38) + (n + " فایل").padStart(11));
    continue;
  }
  const b = fs.readFileSync(p);
  const g = gzipSync(b).length,
    br = brotliCompressSync(b).length;
  if (f.startsWith("dist/tryon.js") || f === "products.json") total += b.length;
  const kb = (n) => (n / 1024).toFixed(1) + "K";
  console.log(f.padEnd(38) + kb(b.length).padStart(11) + kb(g).padStart(11) + kb(br).padStart(11));
}
console.log("مجموع بار لازم افزونه (tryon.js + products.json): " + (total / 1024).toFixed(1) + "K خام");
