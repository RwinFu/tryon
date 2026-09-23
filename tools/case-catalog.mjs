/**
 * tools/case-catalog.mjs — ساخت products.json برای فروشگاه از کاتالوگ داخلی
 * node tools/case-catalog.mjs [--out products.json] [--only id1,id2]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, toEngineSpec } from "../src/frame/catalog.js";

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const only = get("only", "").split(",").filter(Boolean);
const KEYS = ["shape","style","material","lensW","lensH","dbn","templeLen","rimW","rimT","bevel","baseCurve","pantoDeg","splayDeg","templeW","templeT","templeTaper","earDrop","bridgeDrop","bridgeArch","doubleBridge","highBridge","nosePads","hinge","endpiece","metalRimW","metalRimT","catAmp","catWidth","teardrop","nasalNotch","topWide","exp","depth","lensTiltDeg"];

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", get("out", "products.json"));
const products = CATALOG.filter((p) => !only.length || only.includes(p.id)).map((p) => {
  const spec = toEngineSpec(p);
  const entry = {
    id: p.id,
    sku: p.sku || p.id,
    name: p.name,
    brand: p.brand || "آروین",
    price: p.price,
    currency: p.currency || "تومان",
    size: p.size,
    shape: p.shape,
    style: p.style || "full",
    material: p.material || "acetate",
    finish: p.finish,
    lens: p.lens || "clear",
    gender: p.gender || "unisex",
    tags: p.tags || [],
    bestFor: p.bestFor || [],
    url: p.url,
    colors: p.colors,
    spec: Object.fromEntries(KEYS.filter((k) => spec[k] !== undefined).map((k) => [k, spec[k]])),
  };
  return entry;
});
fs.writeFileSync(out, JSON.stringify({ version: 2, updated: new Date().toISOString().slice(0, 10), products }, null, 2));
console.log(`✓ ${out} — ${products.length} فریم`);
