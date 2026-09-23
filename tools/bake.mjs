/**
 * tools/bake.mjs — بایک کردن کاتالوگ به فایل‌های GLB آماده (برای صفحهٔ محصول و AR)
 *
 *   node tools/bake.mjs            → assets/frames/*.glb + assets/frames/index.json
 *   node tools/bake.mjs --pretty → با گزارش اندازه
 *
 * هر فریم فقط از پارامترهای میلی‌متری ساخته می‌شود؛ هیچ فایل مدلی در مخزن
 * نگه‌داری نمی‌شود و همین اسکریپت همهٔ آن‌ها را دوباره می‌سازد.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, toEngineSpec } from "../src/frame/catalog.js";
import { buildFrame } from "../src/frame/geometry.js";
import { exportGLB } from "../src/frame/glb.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "assets", "frames");
fs.mkdirSync(outDir, { recursive: true });
const rows = [];
let total = 0;
for (const p of CATALOG) {
  const spec = toEngineSpec(p);
  const built = buildFrame(spec);
  const bytes = exportGLB(spec, {
    name: p.name,
    color: p.colors?.[0]?.color,
    finish: p.finish,
    metalColor: p.colors?.[0]?.metalColor,
    lens: p.lens,
  });
  const file = `${p.id}.glb`;
  fs.writeFileSync(path.join(outDir, file), bytes);
  total += bytes.length;
  rows.push({
    id: p.id,
    name: p.name,
    glb: `assets/frames/${file}`,
    kb: +(bytes.length / 1024).toFixed(1),
    triangles: built.meta.tris,
    mm: { w: built.meta.size[0], h: built.meta.size[1], d: built.meta.size[2] }.w
      ? `${built.meta.size[0].toFixed(0)}×${built.meta.size[1].toFixed(0)}×${built.meta.size[2].toFixed(0)}`
      : "",
  });
}
fs.writeFileSync(
  path.join(outDir, "index.json"),
  JSON.stringify({ generated: new Date().toISOString(), unit: "millimeter", frontAxis: "+Z", frames: rows }, null, 2),
);
console.log(`✓ ${rows.length} فریم بیک شد · ${(total / 1024 / 1024).toFixed(2)} MB مجموع`);
if (process.argv.includes("--pretty")) console.table(rows);
