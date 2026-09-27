import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/test/browser/harness.html");
  await page.waitForFunction(() => window.testModules);
});

test("WebGL glass transmits camera colors, shadows render, and resizing releases textures", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const report = await page.evaluate(() => {
    const { THREE, Stage } = testModules;
    const cv = document.createElement("canvas");
    cv.width = 640;
    cv.height = 480;
    const x = cv.getContext("2d");
    x.fillStyle = "#448899";
    x.fillRect(0, 0, 640, 480);
    const gl = document.createElement("canvas");
    document.body.append(gl);
    const stage = new Stage({ canvas: gl, THREE });
    stage.resize(640, 480);
    stage.buildEnv();
    stage.setProduct({ shape: "square", lens: "clear", pantoDeg: 0 });
    const pose = {
      x: 320,
      y: 240,
      z: 26,
      camZ: 640,
      scale: 2,
      q: [0, 0, 0, 1],
      faceWmm: 140,
      faceW: 280,
      eyes: { l: { x: 257, y: 240 }, r: { x: 383, y: 240 } },
      nose: { x: 320, y: 250 },
    };
    stage.place(pose);
    const shadow = document.createElement("canvas");
    shadow.width = 640;
    shadow.height = 480;
    const shadowOK = stage.drawContactShadow(shadow.getContext("2d"), pose);
    stage.updateBackground(cv);
    stage.render();
    const out = document.createElement("canvas");
    out.width = 640;
    out.height = 480;
    const ctx = out.getContext("2d");
    ctx.drawImage(gl, 0, 0);
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const lens = at(393, 240),
      background = at(20, 20);
    const original = stage.cameraTexture;
    let disposed = false;
    original.addEventListener("dispose", () => (disposed = true));
    stage.resize(320, 240);
    stage.updateBackground(cv);
    stage.render();
    const result = {
      lens,
      background,
      shadowOK,
      disposed,
      changed: original !== stage.cameraTexture,
    };
    stage.dispose();
    return result;
  });
  expect(errors).toEqual([]);
  expect(report.shadowOK).toBe(true);
  expect(report.disposed).toBe(true);
  expect(report.changed).toBe(true);
  expect(report.background).toEqual([68, 136, 153, 255]);
  for (let i = 0; i < 3; i++)
    expect(Math.abs(report.lens[i] - report.background[i])).toBeLessThan(18);
});

test("real MediaPipe photo → color/model change → no-face recovery → snapshot → video", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const result = await page.evaluate(async () => {
    const { init } = testModules;
    window.api = init({
      mount: document.querySelector("#mount"),
      mode: "inline",
      baseURL: location.origin,
      quality: "high",
      deepLink: false,
      features: { hairLayer: false },
      products: [
        {
          id: "square",
          name: "Square",
          shape: "square",
          size: "52-18-145",
          lens: "clear",
          colors: [
            { name: "black", color: "#111111" },
            { name: "red", color: "#660000" },
          ],
        },
        {
          id: "round",
          name: "Round",
          shape: "round",
          size: "48-19-140",
          lens: "clear",
        },
      ],
    });
    const image = new Image();
    image.src = "/test/fixtures/astronaut.jpg";
    await image.decode();
    // Large upload used to detect on a resized image but display a cropped original.
    const large = document.createElement("canvas");
    large.width = 2048;
    large.height = 2048;
    large.getContext("2d").drawImage(image, 0, 0, 2048, 2048);
    const el = api.el;
    const ok = await el.loadPhoto(large);
    const before = el.el.gl.toDataURL();
    el.setVariant(1);
    const variant = el.el.gl.toDataURL();
    el.select(1);
    const model = el.el.gl.toDataURL();
    const pose = el.pose;
    const blank = document.createElement("canvas");
    blank.width = 200;
    blank.height = 200;
    const noFace = await el.loadPhoto(blank);
    const retained = el.pose === pose && el.state === "photo";
    window.testImage = image;
    return {
      ok,
      noFace,
      retained,
      width: el.el.cv.width,
      height: el.el.cv.height,
      variantChanged: before !== variant,
      modelChanged: variant !== model,
      photoMode: el.tracker.photoMode,
      mirror: getComputedStyle(el.el.cv).transform,
      fit: getComputedStyle(el.el.cv).objectFit,
    };
  });
  expect(result).toMatchObject({
    ok: true,
    noFace: false,
    retained: true,
    width: 1280,
    height: 1280,
    variantChanged: true,
    modelChanged: true,
    photoMode: true,
    mirror: "matrix(1, 0, 0, 1, 0, 0)",
    fit: "contain",
  });
  const pdChange = await page.evaluate(() => {
    const el = api.el,
      before = el.pose.scale;
    el.openSheet(true);
    const auto = el.$("pdAuto");
    auto.checked = false;
    auto.dispatchEvent(new Event("change"));
    const input = el.$("pdIn");
    input.value = "70";
    input.dispatchEvent(new Event("input"));
    el.openSheet(false);
    return {
      pd: el.pose.pdMm,
      changed: el.pose.scale !== before,
      rows: el.fitRows.length,
    };
  });
  expect(pdChange).toEqual({ pd: 70, changed: true, rows: 4 });
  const download = page.waitForEvent("download");
  await page.evaluate(() => api.el.snapshot());
  expect((await download).suggestedFilename()).toBe("tryon.jpg");
  const video = await page.evaluate(async () => {
    const el = api.el;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    canvas.getContext("2d").drawImage(testImage, 0, 0, 640, 640);
    const stream = canvas.captureStream(30);
    const timer = setInterval(
      () => canvas.getContext("2d").drawImage(testImage, 0, 0, 640, 640),
      33,
    );
    // A prerecorded face stream, not a claim of physical-camera coverage.
    navigator.mediaDevices.getUserMedia = async () => stream;
    await el.resumeCamera();
    window.cleanupCamera = () => {
      clearInterval(timer);
      api.destroy();
      stream.getTracks().forEach((t) => t.stop());
    };
    return {
      state: el.state,
      photoMode: el.tracker.photoMode,
      mirror: getComputedStyle(el.el.cv).transform,
    };
  });
  expect(video).toEqual({
    state: "live",
    photoMode: false,
    mirror: "matrix(-1, 0, 0, 1, 0, 0)",
  });
  await expect
    .poll(() => page.evaluate(() => api.el.tracker.pose?.scale || 0))
    .toBeGreaterThan(0);
  await page.evaluate(() => cleanupCamera());
  expect(errors).toEqual([]);
});

test("studio: photo of a real frame → measurements, preview, try-on, flatten", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/studio.html");
  await page.waitForSelector("#view");
  // همان فیکسچرِ واقعیِ تست‌های Node: عکسِ گوشی با میزِ چوبی و نور محیط
  const data = await page.evaluate(async () => {
    const { phonePhoto } = await import("/test/fixtures/frame-photo.mjs");
    const img = phonePhoto({ tilt: 3 });
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    cv.getContext("2d").putImageData(img, 0, 0);
    return cv.toDataURL().split(",")[1];
  });
  await page
    .locator("#photo")
    .setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") });
  const out = page.locator("#photoOut");
  // تحلیلِ عکس در SwiftShader کند است؛ صبرِ کافی بده
  await expect(out).toContainText("کیفیت ردیابی", { timeout: 45000 });
  // پیش‌نمایشِ ترسیم باید روی عکس کشیده شده باشد
  await expect(page.locator("#photoPreview")).toBeVisible();
  const preview = await page.locator("#photoPreview").evaluate((c) => {
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let teal = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 1] > 150 && d[i + 2] > 130 && d[i] < 120) teal++;
    return { w: c.width, h: c.height, teal };
  });
  expect(preview.w).toBeGreaterThan(200);
  expect(preview.teal).toBeGreaterThan(400); // خط ترسیم‌شدهٔ عدسی‌ها
  // اندازه‌ها باید در محدودهٔ فیکسچر باشند (عرض عدسی ۲۱۰px برابر ۵۲mm)
  const mm = (label) =>
    out.evaluate((root, lbl) => {
      const row = [...root.querySelectorAll("tr")].find(
        (tr) => tr.firstElementChild?.textContent.trim() === lbl,
      );
      const v = row?.lastElementChild?.textContent || "";
      return parseFloat(v.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    }, label);
  expect(await mm("عرض عدسی")).toBeGreaterThan(50);
  expect(await mm("عرض عدسی")).toBeLessThan(54);
  expect(await mm("فاصلهٔ پل (DBL)")).toBeGreaterThan(8);
  expect(await mm("فاصلهٔ پل (DBL)")).toBeLessThan(14);
  expect(await mm("زاویهٔ تراز")).toBeGreaterThan(2);
  expect(await mm("زاویهٔ تراز")).toBeLessThan(4.5);
  expect(await mm("ضخامت فریم")).toBeGreaterThan(3);
  expect(await mm("ضخامت فریم")).toBeLessThan(6);
  // پروِ مستقیم با همان خطوطِ دنبالی‌شده
  await page.locator("#btnTryOn").click();
  await expect(page.locator("virtual-tryon")).toBeVisible();
  const contours = await page
    .locator("virtual-tryon")
    .evaluate((el) => ({
      left: el.product.spec.lensPathL?.length,
      right: el.product.spec.lensPathR?.length,
      shape: el.product.spec.shape,
    }));
  expect(contours.left).toBeGreaterThan(20);
  expect(contours.right).toBeGreaterThan(20);
  await page.locator("virtual-tryon #close").click();
  await page.locator("#btnTryOn").click();
  await expect(page.locator("virtual-tryon")).toBeVisible();
  // تبدیل به پارامتر: مسیر دنبالی حذف و اسلایدرها ساخته می‌شوند
  await page.locator("virtual-tryon #close").click();
  await page.locator("#flatten").click();
  await expect(out).toContainText("به پارامترهای قالب تبدیل شد");
  expect(await page.locator("#controls input[type=range]").count()).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test("professional face scan: real session, report, 3D mesh, and GLB export", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const result = await page.evaluate(async () => {
    const { FaceScan, headMeshFromLandmarks, suggestSize, LM } = await import("/src/engine/face-scan.js");
    const W = 960,
      H = 720;
    const pxPerMm = 0.0044;
    // سرِ ساختگی با نسبت‌های انسانی (PD=۶۳mm)
    const pts = new Array(478).fill(0).map(() => null);
    const put = (i, x, y, z = 0) => (pts[i] = { x: 0.5 + x * pxPerMm, y: 0.46 + y * pxPerMm, z: z * pxPerMm });
    put(LM.irisL, -31.5, 0, -14);
    put(LM.irisR, 31.5, 0, -14);
    put(LM.eyeOuterL, -39.5, 1);
    put(LM.eyeInnerL, -16, 1);
    put(LM.eyeOuterR, 39.5, 1);
    put(LM.eyeInnerR, 16, 1);
    for (const [up, lo, sgn] of [[159, 145, -1], [386, 374, 1]]) {
      put(up, sgn * 31.5, -5.5);
      put(lo, sgn * 31.5, 5.5);
    }
    put(LM.templeL, -63, -22);
    put(LM.templeR, 63, -22);
    put(LM.cheekL, -66, 14);
    put(LM.cheekR, 66, 14);
    put(LM.jawL, -58, 70);
    put(LM.jawR, 58, 70);
    put(LM.chin, 0, 93, -18);
    put(LM.top, 0, -93, 6);
    put(LM.noseBridgeTop, 0, 6, -20);
    put(LM.noseBridgeL, -9, 8, -16);
    put(LM.noseBridgeR, 9, 8, -16);
    put(LM.bridgeLoL, -10, 20, -22);
    put(LM.bridgeLoR, 10, 20, -22);
    put(LM.noseTip, 0, 32, -34);
    put(LM.noseAlarL, -8.5, 30, -24);
    put(LM.noseAlarR, 8.5, 30, -24);
    put(LM.mouthL, -24, 62, -14);
    put(LM.mouthR, 24, 62, -14);
    put(LM.lipUpper, 0, 58, -18);
    put(LM.lipLower, 0, 68, -18);
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 478; i++) {
      if (pts[i]) continue;
      const yy = 1 - (i / 477) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = ga * i;
      put(i, Math.cos(th) * rr * 88, yy * 96, 20 - Math.sin(th) * rr * 88);
    }
    const scan = new FaceScan({ need: 30 });
    scan.start(0);
    const ctx = { W, H, irisDiaPx: 11.7 * pxPerMm * W, fps: 30 };
    const stages = [];
    let out = null;
    for (let i = 0; i < 200 && !scan.done; i++) {
      out = scan.push(pts, { ...ctx, t: i * 33 });
      if (stages[stages.length - 1] !== out.stage) stages.push(out.stage);
    }
    const head = headMeshFromLandmarks(pts, { W, irisDiaPx: ctx.irisDiaPx });
    return {
      stages,
      report: out.report,
      size: suggestSize(out.report, ["48", "50", "52", "54"]),
      mesh: { triangles: head.mesh.triangles, vertices: head.mesh.vertices },
    };
  });
  expect(result.stages).toEqual(["position", "still", "measure", "done"]);
  expect(result.report.pd).toBeGreaterThan(61);
  expect(result.report.pd).toBeLessThan(65);
  expect(result.report.bridge).toBeGreaterThan(15);
  expect(result.report.bridge).toBeLessThan(21);
  expect(result.report.confidence.pd).toBeGreaterThan(70);
  expect(result.report.quality).toBeGreaterThan(70);
  expect(result.size.size).toBe("54");
  expect(result.mesh.triangles).toBeGreaterThan(300);
  // رندرِ مش و ساختِ GLB داخل مرورگر
  const ui = await page.evaluate(async () => {
    const { packGLB } = await import("/src/frame/glb.js");
    return { pack: typeof packGLB };
  });
  expect(ui.pack).toBe("function");
  expect(errors).toEqual([]);
});

test("professional scan UI: real MediaPipe landmarks → stages, table, 3D preview, GLB", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(async () => {
    const { init } = testModules;
    window.api = init({
      mount: document.querySelector("#mount"),
      mode: "inline",
      baseURL: location.origin,
      quality: "high",
      deepLink: false,
      features: { hairLayer: false, faceScan: true },
      products: [
        { id: "square", name: "Square", shape: "square", size: "52-18-145", lens: "clear" },
        { id: "round", name: "Round", shape: "round", size: "48-19-140", lens: "clear" },
      ],
    });
    const image = new Image();
    image.src = "/test/fixtures/astronaut.jpg";
    await image.decode();
    const cv = document.createElement("canvas");
    cv.width = 900;
    cv.height = 760;
    cv.getContext("2d").drawImage(image, 0, 0, cv.width, cv.height);
    await api.el.loadPhoto(cv);
  });
  const scanned = await page.evaluate(async () => {
    const el = api.el;
    el.runFaceScan();
    const stages = [];
    // مثل حلقهٔ رندرِ واقعی: هر فریم ~۱۶ میلی‌ثانیه (مرحلهٔ «بی‌حرکتی» به زمانِ واقعی نیاز دارد)
    for (let i = 0; i < 260 && !el.faceScan.done; i++) {
      el.collect(el.pose);
      const st = el.faceScan.stage;
      if (stages[stages.length - 1] !== st) stages.push(st);
      await new Promise((r) => setTimeout(r, 16));
    }
    return { stages, report: el.faceScan.report, done: el.faceScan.done };
  });
  expect(scanned.done).toBe(true);
  expect(scanned.stages).toEqual(["position", "still", "measure", "done"]);
  expect(scanned.report.frames).toBeGreaterThan(10);
  // اعدادِ اپتومتری باید در محدودهٔ انسانی باشند
  expect(scanned.report.pd).toBeGreaterThan(50);
  expect(scanned.report.pd).toBeLessThan(78);
  expect(scanned.report.bridge).toBeGreaterThan(8);
  expect(scanned.report.bridge).toBeLessThan(30);
  expect(scanned.report.temple).toBeGreaterThan(90);
  expect(scanned.report.temple).toBeLessThan(180);
  const card = page.locator("virtual-tryon #shapeBox");
  await expect(card).toContainText("فاصلهٔ دو مردمک");
  await expect(card).toContainText("عرض پل بینی");
  await expect(card).toContainText("اندازهٔ پیشنهادی");
  // پیش‌نمایشِ سه‌بعدی باید واقعاً پیکسل رنگ کند
  const painted = await card.locator("canvas#scanMesh").evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(2000);
  // دکمهٔ خروجیِ GLB باید فایل بسازد
  const dl = page.waitForEvent("download", { timeout: 20000 });
  await card.locator("#scanGlb").click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/face-scan-\d+(\.\d+)?mm\.glb/);
  expect(errors).toEqual([]);
});

test("late GLB responses cannot replace a newer frame; imported millimetres survive placement", async ({
  page,
}) => {
  const { exportGLB } = await import("../../src/frame/glb.js");
  const bytes = Buffer.from(exportGLB({ shape: "round", lensW: 48, dbn: 19 }));
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/delayed-frame.glb", async (route) => {
    await blocked;
    await route.fulfill({ contentType: "model/gltf-binary", body: bytes });
  });
  await page.evaluate(() => {
    const { THREE, Stage } = testModules;
    window.stage = new Stage({
      canvas: document.createElement("canvas"),
      THREE,
    });
    stage.resize(640, 480);
    window.loading = stage.setProduct({
      id: "old",
      glb: "/delayed-frame.glb",
      widthMM: 140,
    });
  });
  await page.evaluate(() =>
    stage.setProduct({ id: "new", shape: "square", lensW: 52 }),
  );
  release();
  const stale = await page.evaluate(async () => {
    await loading;
    return {
      id: stage.product.id,
      count: stage.group.children.length,
      pending: stage.pending,
    };
  });
  expect(stale).toEqual({ id: "new", count: 1, pending: null });
  await page.route("**/current-frame.glb", (route) =>
    route.fulfill({ contentType: "model/gltf-binary", body: bytes }),
  );
  const width = await page.evaluate(async () => {
    const { THREE } = testModules;
    await stage.setProduct({
      id: "current",
      glb: "/current-frame.glb",
      widthMM: 140,
    });
    stage.place({
      x: 320,
      y: 240,
      z: 26,
      scale: 2,
      camZ: 640,
      q: [0, 0, 0, 1],
      faceWmm: 140,
    });
    stage.scene.updateMatrixWorld(true);
    const normalized = stage.frame.group.children.find(
      (o) => o.name !== "occluder",
    );
    const width = new THREE.Box3()
      .setFromObject(normalized)
      .getSize(new THREE.Vector3()).x;
    stage.dispose();
    return width;
  });
  expect(width).toBeCloseTo(280, 1);
});
