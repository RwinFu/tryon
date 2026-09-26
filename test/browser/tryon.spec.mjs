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

test("studio photo contours survive direct try-on and product replacement", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/studio.html");
  const data = await page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = 600;
    cv.height = 240;
    const x = cv.getContext("2d");
    x.fillStyle = "white";
    x.fillRect(0, 0, 600, 240);
    x.strokeStyle = "#222";
    x.lineWidth = 14;
    for (const cx of [170, 430]) {
      x.beginPath();
      x.ellipse(cx, 120, 98, 65, 0, 0, Math.PI * 2);
      x.stroke();
    }
    x.beginPath();
    x.moveTo(267, 105);
    x.quadraticCurveTo(300, 85, 333, 105);
    x.stroke();
    return cv.toDataURL().split(",")[1];
  });
  await page
    .locator("#photo")
    .setInputFiles({
      name: "frame.png",
      mimeType: "image/png",
      buffer: Buffer.from(data, "base64"),
    });
  await expect(page.locator("#photoOut")).toContainText(
    "خط لنز از عکس گرفته شد",
  );
  await page.locator("#btnTryOn").click();
  await expect(page.locator("virtual-tryon")).toBeVisible();
  const contours = await page
    .locator("virtual-tryon")
    .evaluate((el) => ({
      left: el.product.spec.lensPathL?.length,
      right: el.product.spec.lensPathR?.length,
    }));
  expect(contours.left).toBeGreaterThan(20);
  expect(contours.right).toBeGreaterThan(20);
  await page.locator("virtual-tryon #close").click();
  await page.locator("#btnTryOn").click();
  await expect(page.locator("virtual-tryon")).toBeVisible();
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
