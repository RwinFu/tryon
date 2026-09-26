# پرو مجازی عینک — افزونهٔ فروشگاه اپتیک

<p dir="rtl">
نسخهٔ ۲٫۰ — یک <b>افزونه</b> برای سایت فروشگاه‌های عینک: مشتری دکمهٔ «پرو مجازی» را می‌زند، عینک با
مقیاس واقعی روی صورتش می‌نشیند، رنگ‌ها را عوض می‌کند، برگهٔ فیت با میلی‌مترهای واقعی می‌بیند و به سبد
اضافه می‌کند. همه‌چیز روی دستگاه مشتری؛ هیچ عکسی آپلود نمی‌شود.
</p>

```html
<!-- لودر حدود ۲KB: موتور حدود ۲۳۸KB فقط با اولین کلیک (یا نزدیک‌شدن اسلات inline به دید) دانلود می‌شود -->
<script src="/tryon/dist/tryon-loader.js" data-tryon-products="/tryon/products.json" defer></script>

<!-- کنار هر عینک: با کلیک، overlay تمام‌صفحه با همان فریم روی صورت مشتری باز می‌شود -->
<button class="tryon-btn" data-tryon-open data-tryon-sku="AR-104">پرو مجازی</button>

<!-- اختیاری: نسخهٔ داخل صفحه -->
<div data-tryon data-tryon-mode="inline" data-tryon-sku="AR-104" style="height:620px"></div>
```

پوشهٔ `dist/` و `lib/` را کنار هم (مثلاً زیر `/tryon/`) بگذارید؛ افزونه مدل‌ها را نسبت به **آدرس خودِ اسکریپت**
پیدا می‌کند، نه آدرس صفحهٔ محصول. اگر جای دیگری هستند: `data-tryon-base-u-r-l="/cdn/tryon"`.
برای بارگذاری فوری (بدون لودر): `dist/tryon.js` را مستقیم بگذارید.

نصب کامل (Shopify / WooCommerce / API / حریم خصوصی / عیب‌یابی):
📄 **[docs/INSTALL.html](docs/INSTALL.html)** · 📐 **[docs/EMBEDDING.md](docs/EMBEDDING.md)**
دموی زنده: **https://rwinfu.github.io/tryon/** · ابزار ساخت فریم: **/tryon/studio.html**

---

## چه چیزی این را از «افکت بامزه» جدا می‌کند

| | توضیح |
| --- | --- |
| **مقیاس میلی‌متری واقعی** | فاصلهٔ مردمک از قطر عنبیه در تصویر زنده محاسبه می‌شود (نه فرض ۶۳mm)؛ سایز چاپی روی دستهٔ عینک (`52□18-145`) مستقیم به هندسه تبدیل می‌شود. |
| **برگهٔ فیت** | چهار چک واقعی اپتیک: پهنای فریم نسبت به عرض صورت، انحراف مرکز عدسی از مردمک، پهنای پل نسبت به پل بینی، ارتفاع عدسی نسبت به ارتفاع صورت — با عدد، رنگ و دلیل. |
| **پیشنهاد بر اساس شکل صورت** | هفت شکل صورت از نسبت‌های استخوانی (پیشانی/گونه/فک) با انیمیشن اسکن نقاط؛ فریم‌های مناسب همان شکل بالاتر می‌آیند. |
| **رندر «سنگینِ» واقعی** | فلز با metalness/roughness map، استات با clearcoat و لبهٔ بِوِل، عدسی با transmission و ضخامت حجمی، HDRI استودیوییِ تولیدشده در لحظه، هم‌رنگ‌سازی با نور اتاق، سایهٔ تماسی روی پوست، و لایهٔ مو روی دستهٔ عینک. |
| **کاتالوگ بدون Blender** | ۲۸ فریم آماده + استودیویی که از **عکس محصول** خط عدسی را دنبالی می‌کند و مدل سه‌بعدی و GLB می‌سازد. |
| **اتصال به فروشگاه** | رویداد `tryon:cart` برای سبد خرید، واتساپ یا لینک؛ `fromShopify()` و `fromWoo()` رنگ‌ها/سایزها/قیمت را از خودِ محصول می‌سازند. |

## معماری

```
src/
  plugin.js            API عمومی · init/autoEmbed/fromShopify/fromWoo · window.TryOn
  frame/               هندسهٔ رویه‌ای فریم (بدون DOM، قابل تست در Node)
    shapes.js          ۱۶ قالب خط عدسی (مربعی، گربه‌ای، خلبانی، اکتاگون…)
    sweep.js           ساخت لوله/پروفیل روی مسیر (رینگ، دسته، پل)
    geometry.js        buildFrame(spec) → نقش‌ها، bbox، سایهٔ تماسی
    materials.js       ۱۸ فینیش استات/فلز + متریال عدسی + محیط استودیو
    catalog.js         ۲۸ محصول: نام، سایز، رنگ‌ها، بهترین فرم صورت
    photogram.js       عکس → ماسک جوهر → خط عدسی (mm) → spec
    glb.js             نویسندهٔ GLB (KHR_materials_clearcoat/ior/transmission)
    loaders.js         خواندن GLB فروشنده و مقیاس به mm واقعی
  engine/
    tracking.js        MediaPipe FaceLandmarker · One€ · چرخش سر · فاصلهٔ مردمک خودکار
    stage.js           صحنهٔ three.js · هم‌رنگ‌سازی نور · سایه · لایهٔ مو
    fit.js             شکل صورت · fitReport · fitScore · recommend
    thumbs.js          تامبنیل محصول با همان هندسه (بدون عکس‌سازی دستی)
  ui/
    widget.js          <virtual-tryon> در Shadow DOM (inline/overlay/fullscreen)
    styles.css         توکن‌های --vt-* و partها برای تم فروشگاه
    i18n.js            fa / en (ar → fa)
  studio/studio.js     استودیوی ساخت/ویرایش فریم و خروجی GLB·PNG·JSON
tools/
  build.mjs            esbuild → dist/tryon.js (+.debug, .esm, studio)
  bake.mjs             ساخت assets/frames/*.glb برای صفحهٔ محصول و AR
  case-catalog.mjs     تولید products.json از کاتالوگ
  preview.mjs grid.mjs رندر CPU برای بازبینی هندسه در ترمینال
  serve.mjs            سرور استاتیک توسعه
test/                  node:test — هندسه، فیت، عکس‌سنجی، GLB، DOM، هماهنگی قالب‌ها
lib/                   MediaPipe tasks-vision + مدل‌ها (میزبانی محلی، بدون CDN)
```

## توسعه

```bash
# Node.js 20.9+ (توسعه و تست)
npm ci
npm run build     # dist/tryon.js (حدود ۲۳۸KB gzip) + dist/studio.js
npm test          # ۷۶ تست: هندسه، فیت، ردیابی، GLB، عکس‌سنجی و DOM
npm run dev       # سرور محلی روی :8080 (دمو + استودیو)
npm run bake      # assets/frames/*.glb (خروجی تولیدی؛ در گیت نمی‌آید)
npm run size      # اندازهٔ خام/gzip/brotli فایل‌های نهایی
npx playwright install --with-deps chromium
npm run test:browser  # ۴ تست مرورگر: WebGL + MediaPipe واقعی، عکس/ویدیو، استودیو و GLB
```

قاعدهٔ کاری: `src/ui/styles.css` و `src/**` منبع‌اند؛ `dist/` و `src/ui/styles.gen.js`
تولیدی‌اند و با `npm run build` بازسازی می‌شوند (تست‌ها جا‌ماندن را می‌گیرند).

## مسیر عکس → مدل → پرو

1. `studio.html` را باز کنید و عکس **روبه‌روی محصول** را در بخش عکس انتخاب کنید.
2. عرض واقعی عدسی (عدد چاپ‌شده روی دسته، مثلاً ۵۲) را وارد کنید؛ شکل/ابعاد را در نمای سه‌بعدی بررسی کنید.
3. دکمهٔ **«پرو همین فریم روی صورت»**، همان خطوط استخراج‌شده را مستقیماً به پرو می‌فرستد.
4. برای تصویر چهره از **«پرو با عکس»** استفاده کنید؛ اجازهٔ دوربین لازم نیست. تعویض رنگ/مدل، اصلاح PD و ذخیرهٔ عکس در همین حالت فعال‌اند.
5. **«بازگشت به دوربین»** حالت زنده را دوباره با اجازهٔ کاربر فعال می‌کند.

چهار اسکیل مرجع Three.js از `CloudAI-X/threejs-skills` با نسخهٔ ثابت در `.agents/skills/` نصب شده‌اند؛
فقط راهنمای توسعه‌اند و وارد بستهٔ مرورگر نمی‌شوند. مبدأ/نسخه/مجوز در `PROVENANCE.md` ثبت شده است.
شرح اصلاحات و پوشش تست: [docs/REALISM-QA.md](docs/REALISM-QA.md).

---

## محدودیت‌ها (صریح)

- عدد فاصلهٔ مردمک از تصویر دوربین **تقریبی** است و جای اندازه‌گیری بالینی را نمی‌گیرد؛ دقت ثابت برای همهٔ دوربین‌ها و افراد تضمین نمی‌شود. برای فیت بهتر می‌توان PD اندازه‌گیری‌شده را دستی وارد کرد.
- چهرهٔ روبه‌رو و چرخش‌های ملایم بهترین نتیجه را می‌دهند؛ در زوایای شدید راهنمای روبه‌روشدن نمایش داده می‌شود. پوشاندن دسته‌ها با حجم تقریبی سر انجام می‌شود، نه اسکن دقیق سر هر فرد.
- رندر روی گوشی‌های خیلی قدیمی/ضعیف به `lite` می‌رود (سایهٔ تماسی و لایهٔ مو خاموش).
- تبدیل تک‌عکس محصول، خط عدسی را استخراج و ضخامت/دسته‌ها را به‌صورت رویه‌ای تخمین می‌زند؛ بازسازی کامل فوتوگرامتری نیست. عکس روبه‌رو با زمینهٔ روشن/شفاف و عدسی روشن لازم است؛ عدسی تیره یا زاویهٔ سه‌رخ ممکن است به مدل GLB یا ویرایش دستی نیاز داشته باشد.

## مجوز

فروش افزونه با مجوز تجاری به ازای هر دامنه است — ببین **[LICENSE.md](LICENSE.md)**.
کتابخانه‌های شخص ثالث و مجوز مدل‌ها: **[MODEL-LICENSES.txt](MODEL-LICENSES.txt)**
(three.js · MIT، MediaPipe Tasks · Apache-2.0، Vazirmatn · OFL).

---

### English (short)

A drop-in WebGL virtual try-on widget for optical shops. Real millimetre-scale frames generated
procedurally from the printed temple size, on-device face landmark tracking (MediaPipe) with
auto interpupillary-distance estimation, a four-point optical fit report, face-shape based frame
recommendation, product GLB export, and a photo→3D studio so no per-product modelling is needed.
Everything runs client-side; no customer image ever leaves the device.

MIT-licensed third parties are bundled (three.js, MediaPipe tasks-vision). Commercial use of this
plugin requires a per-domain license — see `LICENSE.md`.
