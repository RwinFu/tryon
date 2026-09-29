# بازطراحی ماژول دوربین — نسخه ۲۰۲۶

## چرا بازطراحی شد؟

ماژول قبلی (`tracking.js` قدیمی) چند باگ ساختاری داشت:

- `startCamera` فقط ۳ تلاش با constraints ثابت داشت، بدون enumerateDevices و بدون امتیازدهی لنزها
- مدیریت mirror فقط با CSS بود، بدون درک facingMode
- تشخیص portrait فقط یک‌بار در شروع، بدون ResizeObserver یا orientationchange
- حلقه رندر با `currentTime` مقایسه می‌شد، نه با `requestVideoFrameCallback` → تاخیر و مصرف باتری بیشتر
- خطاها به صورت generic throw می‌شدند، بدون نگاشت به کلیدهای i18n
- torch/zoom پشتیبانی نمی‌شد
- در Node/jsdom تست می‌شکست (video mock نداشت)
- تفکیک وظایف نبود: دوربین + ردیابی در یک کلاس

## معماری جدید

### 1. `src/engine/camera.js` — ماژول مستقل دوربین

یک کلاس `Camera` کامل با ماشین حالت:

```
idle → requesting → active → paused → stopped → error
```

**ویژگی‌ها:**
- ✅ بررسی secure context و MediaDevices support
- ✅ `permissions.query({name:'camera'})` برای UX بهتر (granted/denied/prompt)
- ✅ `enumerateDevices()` + امتیازدهی (torch, focusMode, facing, label) برای انتخاب بهترین لنز پشتی/جلو
- ✅ زنجیره fallback مقاوم:
  1. `deviceId exact` + ideal res
  2. `facingMode exact` + ideal res
  3. `facingMode ideal` + ideal res
  4. ideal res only
  5. `video:true`
- ✅ `waitForMetadata` + `play()` با timeout (۱۵ ثانیه)
- ✅ تشخیص capabilities: torch, zoom, focusMode
- ✅ `setTorch(bool)` و `setZoom(level)` با `applyConstraints`
- ✅ `switchFacing()` و `switchDevice(deviceId)`
- ✅ مدیریت mirror: `isMirrored = facing === 'user'`
- ✅ فریم‌کال‌بک با `requestVideoFrameCallback` (دقیق، کم‌مصرف) + fallback به rAF
- ✅ رویدادها: `state`, `resize`, `frame`, `devicechange`, `torch`, `zoom`, `permission`
- ✅ مدیریت lifecycle: `visibilitychange` (pause loop نه stop stream)، `orientationchange`، `devicechange`
- ✅ iOS quirks: `playsInline`, `webkit-playsinline`, `disablePictureInPicture`, DOM attach مخفی
- ✅ `getSnapshotCanvas()` و `toBlob()` با در نظر گرفتن mirror
- ✅ تحمل محیط تست (mock video بدون setAttribute)

**برگرفته از بهترین منابع GitHub:**
- `react-camera-pro-with-torch` (torch + switch)
- `webrtc/samples` (enumerateDevices pattern)
- Twilio guide (ideal vs exact)
- MDN + W3C spec

### 2. `src/engine/tracking.js` — ردیابی خالص

اکنون از `Camera` استفاده می‌کند:

- `this.camera = new Camera(...)`
- `startCamera()` → `camera.start()` با portrait detection
- `switchCamera()`, `setTorch()`, `setZoom()` به camera delegate می‌شود
- `process()` سایز را از `camera.W/H` می‌گیرد
- `pose` شامل `mirrored` و `facing` برای stage
- تست‌ها با mock document سازگار شدند

### 3. `src/engine/stage.js` — هماهنگ با دوربین جدید

- `setMirrored(bool)` → CSS var `--vt-mirror`
- `updateVideoRef(cameraOrVideo)` برای switch
- `updateBackground` دیگر texture را هر فریم نمی‌سازد، reuse می‌کند
- `place(pose)` mirror را از pose می‌خواند
- `drawHairLayer` از `this.video` استفاده می‌کند

### 4. `src/ui/widget.js` — UX دوربین

- هدر جدید: `camTools` با دکمه switch و torch
- `portraitCamera()` با `matchMedia("(orientation: portrait)")`
- `pickQuality()` با `deviceMemory`, `connection.saveData`, cores
- `boot()` موازی: stage اول ساخته می‌شود، سپس دوربین + مدل
- `setupResizeObserver()` با ResizeObserver + orientationchange + camera resize event
- `updateCameraUI()` نمایش دکمه‌ها بر اساس capabilities
- `handleCameraSwitch()` و `handleTorchToggle()`
- `loop()` با rVFC: اگر `requestVideoFrameCallback` موجود باشد، از آن استفاده می‌کند (هماهنگ با فریم واقعی دوربین)
- `syncSize()` از `camera.W/H` می‌گیرد، نه فقط videoWidth
- `stopLoop()` هر دو rAF و rVFC را cancel می‌کند
- `resume()` mirror را از camera می‌گیرد، نه حذف
- `close()` camTools را مخفی می‌کند

### 5. `src/ui/styles.css`

- `.camTools`, `.camBtn` با حالت `data-on="1"` برای torch روشن

### 6. مهارت جدید

`.agents/skills/camera-best-practices/SKILL.md` شامل تمام الگوهای بالا با کد نمونه

## تست‌ها

- `npm test` → ۹۲ تست پاس
- `npm run build` → dist ۹۳۶KB raw / ۲۵۸KB gzip

## استفاده

```javascript
import { Camera } from "./engine/camera.js";
const cam = new Camera({ log: console.log });
await cam.init();
await cam.enumerateDevices();
const stream = await cam.start({ facing: "user", width: 960, height: 720, portrait: false });
cam.on("resize", ({w,h}) => console.log("new size", w, h));
cam.onFrame((now, meta) => { /* tracking */ });
if (cam.torchSupported) await cam.setTorch(true);
```

## بهبودهای آینده

- [ ] pinch-to-zoom با gesture
- [ ] focus tap (focusMode manual)
- [ ] HDR / exposure compensation اگر مرورگر پشتیبانی کند
- [ ] WebCodecs برای encode سریع snapshot
