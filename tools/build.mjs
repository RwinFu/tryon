/**
 * tools/build.mjs — بسته‌بندی افزونه (تک‌فایل، بدون وابستگی شبکه)
 *
 *   npm run build      →  dist/tryon.js (IIFE), dist/tryon.esm.js, dist/studio.js
 *   خروجی: اندازهٔ min + gzip
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { execSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });
const version = process.env.VT_VERSION || readVersion();

/* ── styles.css → ماژول JS (تا هم در باندل و هم در Node/test قابل import باشد) ── */
{
  const cssPath = path.join(root, "src/ui/styles.css");
  const raw = fs.readFileSync(cssPath, "utf8");
  const escaped = raw.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\$\\{");
  const body =
    "/* ساخته‌شده از src/ui/styles.css توسط tools/build.mjs — دستی ویرایش نکنید */\nexport default `" +
    escaped +
    "`;\n";
  const gen = path.join(root, "src/ui/styles.gen.js");
  if (!fs.existsSync(gen) || fs.readFileSync(gen, "utf8") !== body) fs.writeFileSync(gen, body);
}

const common = {
  bundle: true,
  absWorkingDir: root,
  loader: { ".css": "text" },
  define: { __VT_VERSION__: JSON.stringify(version) },
  target: ["chrome88", "safari14", "firefox82", "edge88"],
  legalComments: "none",
  logLevel: "warning",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/plugin.js"],
    outfile: "dist/tryon.js",
    format: "iife",
    minify: true,
    sourcemap: false,
  },
  {
    ...common,
    entryPoints: ["src/plugin.js"],
    outfile: "dist/tryon.debug.js",
    format: "iife",
    minify: false,
    sourcemap: "linked",
  },
  {
    ...common,
    entryPoints: ["src/plugin.js"],
    outfile: "dist/tryon.esm.js",
    format: "esm",
    minify: true,
  },
  {
    ...common,
    entryPoints: ["src/loader.js"],
    outfile: "dist/tryon-loader.js",
    format: "iife",
    minify: true,
  },
  {
    ...common,
    entryPoints: ["src/studio/studio.js"],
    outfile: "dist/studio.js",
    format: "iife",
    minify: true,
  },
  {
    ...common,
    entryPoints: ["src/frame/index.js", "src/frame/catalog.js"],
    outdir: "dist/frame",
    format: "esm",
    minify: true,
  },
];

try {
  await Promise.all(builds.map((b) => esbuild.build(b)));
} catch (e) {
  console.error("build failed");
  process.exit(1);
}

// kpiها
const rows = [];
for (const f of ["dist/tryon.js", "dist/tryon.esm.js", "dist/tryon-loader.js", "dist/studio.js"]) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  rows.push({ file: f, raw: kb(buf.length), gzip: kb(gzipSync(buf, { level: 9 }).length) });
}
fs.writeFileSync(
  path.join(out, "build-info.json"),
  JSON.stringify({ version, at: new Date().toISOString(), rows }, null, 2),
);
console.table(rows);
console.log("✓ dist آماده شد (نسخه " + version + ")");

function kb(n) {
  return (n / 1024).toFixed(1) + " KB";
}
function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0";
  } catch (e) {
    return "0.0.0";
  }
}
void execSync;
