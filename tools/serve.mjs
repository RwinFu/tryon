/**
 * tools/serve.mjs — سرور استاتیک کوچک برای توسعه/پیش‌نمایش
 * node tools/serve.mjs [port]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = +(process.argv[2] || process.env.PORT || 8080);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".task": "application/octet-stream",
  ".tflite": "application/octet-stream",
  ".map": "application/json",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(root, url === "/" ? "/index.html" : url);
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("۴۰ — " + url);
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      res.end(buf);
    });
  })
  .listen(port, "0.0.0.0", () => console.log("tryon dev → http://0.0.0.0:" + port));
