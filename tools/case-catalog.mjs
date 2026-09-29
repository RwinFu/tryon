/**
 * tools/case-catalog.mjs — ساخت products.json از کاتالوگ داخلی
 * node tools/case-catalog.mjs [--out products.json] [--only AR-101,AR-102]
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
const KEYS = [
  "shape", "style", "material", "lensW", "lensH", "dbn", "templeLen", "rimW", "rimT", "bevel",
  "baseCurve", "pantoDeg", "splayDeg", "templeW", "templeT", "templeTaper", "earDrop", "bridgeDrop",
  "bridgeArch", "doubleBridge", "highBridge", "nosePads", "hinge", "endpiece", "metalRimW", "metalRimT",
  "catAmp", "catWidth", "teardrop", "nasalNotch", "topWide", "exp", "depth", "lensTiltDeg", "hexBlend",
  "hexSides", "lensPath", "lensPathL", "lensPathR", "bridgeStyle", "bridgeMaterial", "browMaterial",
  "templeMaterial", "endpieceMaterial", "rimlessMounts", "profile", "lensInset",
];
const METADATA = [
  "id", "sku", "name", "brand", "modelCode", "modelFamily", "size", "shape", "style", "material",
  "composition", "lensH", "lensHSource", "finish", "color", "metalColor", "accentColor", "metalTint", "lens",
  "gender", "tags", "bestFor", "sourceUrl", "url", "sourceName", "sourceType", "sourceNote", "sourceChecked",
  "modelAssetStatus", "modelAssetNote", "modelAssetSource", "modelAssetLicense", "modelAssetAttribution",
  "glb", "glbOffset", "glbRotation", "glbScale", "widthMM", "colors",
];

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", get("out", "products.json"));
const products = CATALOG.filter((p) => !only.length || only.includes(p.id)).map((p) => {
  const spec = toEngineSpec(p);
  const entry = Object.fromEntries(METADATA.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
  entry.spec = Object.fromEntries(KEYS.filter((k) => spec[k] !== undefined).map((k) => [k, spec[k]]));
  return entry;
});
fs.writeFileSync(out, JSON.stringify({ version: 3, updated: new Date().toISOString().slice(0, 10), products }, null, 2));
console.log(`✓ ${out} — ${products.length} مدل واقعی با منبع ثبت‌شده`);
