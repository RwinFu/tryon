# نصب و راه‌اندازی افزونهٔ پرو مجازی عینک

مخاطب این سند: برنامه‌نویس یا فروشگاه‌دار سایت. سه راه نصب وجود دارد — **بدون کدنویسی** (فقط attribute)، **Shopify**, **WooCommerce** — و یک راه **API** برای پروژه‌های سفارشی.

همه‌چیز سمت کلاینت است: WebGL + MediaPipe. **هیچ تصویری از مشتری به سرور شما فرستاده نمی‌شود.** تنها نیاز فنی: صفحه باید `https` باشد (دوربین در HTTP باز نمی‌شود).

---

## ۰) فایل‌ها

```
dist/tryon.js          ← همین را در سایت بگذارید (تک‌فایل، بدون وابستگی npm)
dist/tryon.debug.js    ← نسخهٔ خوانا + سورس‌مپ (فقط برای دیباگ، build شده؛ در گیت نیست)
dist/tryon.esm.js      ← برای پروژه‌های bandlerدار (Vite/Next/Rollup)
products.json          ← کاتالوگ فریم‌ها (از store شما یا فایل آماده)
lib/                   ← مدل‌های MediaPipe + wasm (آفلاین کار کردن)
assets/frames/*.glb    ← خروجی npm run bake (برای مدل سه‌بعدی صفحهٔ محصول / AR)
```

`npm run build` بعد از هر تغییر در `src/` لازم است؛ `dist/tryon.js` هم‌زمان با `src/ui/styles.css` ساخته می‌شود (تست `templates.test.mjs` جا‌ماندن را می‌گیرد).

اگر نمی‌خواهید مدل‌های MediaPipe را میزبانی کنید، افزونه خودش به `cdn.jsdelivr.net` و بعد `unpkg` می‌رود؛ ولی برای فروشگاه ایرانی، میزبانی محلی + کش مرورگر سریع‌تر و مستقل‌تر است.

---

## ۱) نصب بدون کدنویسی (توصیه‌شده)

یک `<script>` در `<head>` یا انتهای `body`:

```html
<script
  src="/tryon/dist/tryon.js"
  data-tryon-products="/tryon/products.json"
  data-tryon-lang="fa"
  data-tryon-accent="#d8b478"
  data-tryon-whatsapp="989190051635"
  defer
></script>
```

سپس هر جا خواستید، یکی از این دو:

```html
<!-- الف) پرو به‌صورت بلوک داخل صفحه (روی صفحهٔ محصول عالی است) -->
<div data-tryon data-tryon-mode="inline" data-tryon-sku="AR-104" style="height: 620px"></div>

<!-- ب) دکمه که پرو تمام‌صفحه را باز می‌کند -->
<button data-tryon-open data-tryon-sku="AR-104">پرو مجازی این مدل</button>
```

attributeهایی که روی المان میزبان خوانده می‌شوند:

| attribute | معنا |
| --- | --- |
| `data-tryon` | حضورش کافی است تا همان‌جا نصب شود |
| `data-tryon-mode` | `inline` \| `overlay` \| `fullscreen` (پیش‌فرض inline داخل المان) |
| `data-tryon-products` | URL به `products.json` یا مسیر SKUهای جدا با کاما |
| `data-tryon-sku` | با این مدل شروع کن (و فقط همین + مدل‌های هم‌شکل را نشان بده) |
| `data-tryon-lang` | `fa` \| `en` (پیش‌فرض `fa`) |
| `data-tryon-theme` | `auto` \| `light` \| `dark` — `auto` رنگ بدنهٔ صفحهٔ شما را می‌سنجد |
| `data-tryon-accent` / `-whatsapp` / `-brand` | رنگ دکمه‌ها، شماره واتساپ، نام فروشگاه |
| `data-tryon-cart` | `event` \| `whatsapp` \| `link` |
| `data-tryon-deep-link` | با هر انتخاب، `#f=<id>` را در نشانی صفحه می‌نویسد (برای لینک‌شدن مدل در دموی مستقل) |
| `data-tryon-config` | هر JSON از `init()` (برای موارد خاص) |

نکتهٔ ظاهری: المان میزبان باید ارتفاع داشته باشد (`height: 560–720px` یا `aspect-ratio: 4/5`). داخل سایهٔ component است، پس CSS شما روی آن اثر ندارد — به‌جایش از `part`ها و متغیرها استفاده کنید:

```css
virtual-tryon {
  --vt-accent: #c9a24a;
  --vt-radius: 18px;
  --vt-font: "IRANSans", Tahoma, sans-serif;
  border: 1px solid #e5e5e5;
}
virtual-tryon::part(stage) { background: #fff; }
virtual-tryon::part(dock) { backdrop-filter: none; }
```

---

## ۲) Shopify

### الف) سریع‌ترین راه: یک Section

`sections/tryon.liquid`:

```liquid
{% style %}
  #Tryon-{{ section.id }} { height: {{ section.height }}px; }
{% endstyle %}
<div id="Tryon-{{ section.id }}"
     data-tryon
     data-tryon-mode="inline"
     data-tryon-sku="{{ product.selected_or_first_available_variant.sku }}"
     style="max-width: {{ section.width }}px"></div>

{% schema %}
{ "name": "پرو مجازی عینک", "settings": [
  { "type": "image_picker", "id": "logo", "label": "لوگو (اختیاری)" },
  { "type": "range", "id": "height", "label": "ارتفاع", "min": 420, "max": 900, "step": 20, "unit": "px", "default": 620 },
  { "type": "range", "id": "width", "label": "پهنا", "min": 360, "max": 1200, "step": 20, "unit": "px", "default": 720 }
], "presets": [{ "name": "پرو مجازی عینک" }] }
{% endschema %}
```

و `data-tryon.js` را در تم include کنید (تنظیمات سراسری در `theme.liquid`):

```html
<script src="{{ 'tryon.js' | asset_url }}"
        data-tryon-products="{{ 'tryon-products.json' | asset_url }}"
        data-tryon-brand-name="{{ shop.name | escape }}"
        data-tryon-accent="{{ settings.tryon_accent | default: '#d8b478' }}"
        defer></script>
```

### ب) کاتالوگ از خود Shopify (بدون فایل JSON)

برای هر محصول، یک **metafield** از نوع `JSON` با کلید `custom.tryon_frame`:

```json
{ "shape": "cateye", "material": "acetate", "size": "53-19-145", "finish": "tortoise", "bestFor": ["round", "square"] }
```

و در تم، همان لحظه که محصول رندر می‌شود:

```js
window.TryOn.init({
  mode: "inline",
  mount: document.querySelector("#tryon"),
  products: [
    TryOn.fromShopify({
      id: {{ product.id }},
      title: {{ product.title | json }},
      handle: {{ product.handle | json }},
      vendor: {{ product.vendor | json }},
      price: {{ product.price }},
      available: {{ product.available | json }},
      options: {{ product.options_with_values | json }},
      variants: {{ product.variants | json }},
      images: {{ product.images | json }},
    }, {{ product.metafields.custom.tryon_frame.value | json }}),
  ],
});
```

`fromShopify` کارهای خسته‌کننده را انجام می‌دهد: رنگ‌ها را از `options` (با نام «رنگ» / «Color») می‌سازد، اسم رنگ را به هگز تبدیل می‌کند، `soldOut` را از `available` می‌خواند، سایز را از گزینهٔ «قواره/Size» برمی‌دارد، و متافیلد `tryon_frame` همیشه برنده است.

### ج) مدل سه‌بعدی صفحهٔ محصول

`npm run bake` فایل `assets/frames/<SKU>.glb` را می‌سازد. همان را در `3D model` محصول (Shopify supports GLB) آپلود کنید: مشتری موبایل‌آیفون می‌تواند با AR Quick Look عینک را در فضای اتاق بیندازد. `products.json` هم می‌تواند به‌جای هندسهٔ رویه‌ای، همان GLB را بار کند:

```json
{ "id": "AR-104", "name": "گربه‌ای استات", "glb": "/files/ar-104.glb", "widthMM": 138 }
```

`widthMM` مهم است: مدل با آن به میلی‌متر واقعی مقیاس می‌شود تا روی صورت درست بنشیند.

---

## ۳) WooCommerce

پلاگین آماده (`wp-content/plugins/tryon/`):

```php
<?php
/* Plugin Name: پرو مجازی عینک */
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_script('tryon', content_url('/tryon/tryon.js'), [], null, true);
  wp_add_inline_script('tryon', 'window.__TRYON__ = ' . wp_json_encode([
    'products' => content_url('/tryon/products.json'),
    'brand'    => [ 'name' => get_bloginfo('name'), 'whatsapp' => get_option('tryon_whatsapp') ],
    'lang'     => (function_exists('get_locale') && str_starts_with(get_locale(), 'fa')) ? 'fa' : 'en',
    'cart'     => [ 'mode' => 'event' ],
  ]) . ';', 'before');
});

add_shortcode('tryon', function ($a) {
  $sku = sanitize_text_field($a['sku'] ?? '');
  return '<div data-tryon data-tryon-mode="inline" data-tryon-sku="' . esc_attr($sku) . '" style="height:620px"></div>';
});

// فیلد اختیاری «فریم سه‌بعدی» روی محصول — همان JSON متافیلد Shopify
add_action('init', function () {
  register_post_meta('product', '_tryon_frame', [ 'type' => 'string', 'single' => true, 'show_in_rest' => true ]);
});
```

برای تبدیل محصول ووکامرس به محصول افزونه، از REST API هم می‌توانید مستقیم استفاده کنید:

```js
const p = await fetch(`/wp-json/wc/store/v1/products/${id}`).then((r) => r.json());
window.TryOn.init({ products: [window.TryOn.fromWoo(p, p._tryon_frame)] });
```

---

## ۴) API کامل (هر سایت دیگری)

```js
const tryon = window.TryOn.init({
  mount: "#tryon-slot",            // سلکتور یا Element
  mode: "overlay",                 // inline | overlay | fullscreen
  products: "/tryon/products.json", // یا آرایهٔ آبجکت
  lang: "fa",
  theme: "auto",
  quality: "auto",                 // auto | high | lite
  brand: { name: "اپتیک آروین", tagline: "پرو هوشمند", accent: "#d8b478", whatsapp: "989190051635", url: "https://…" },
  cart: { mode: "event", add: (item) => myCart.add(item) },
  features: { faceScan: true, hairLayer: true, contactShadow: true, lightMatch: true, thumbnails: true, photo: true, fitSheet: true, snapshot: true, cart: true, pd: true },
  tracking: { pd: 63, autoPd: true, focalScale: 0.75, vertexDistance: 13 },
  deepLink: false,                 // نشانی صفحه را با #f= عوض نکند
  watermark: true,
});
```

متدهای نمونه:

| متد | کار |
| --- | --- |
| `open()` / `close()` / `toggle()` | نمایش و پنهان (فقط در حالت overlay) |
| `select(idOrSku)` | انتخاب فریم |
| `setVariant(i)` | رنگ i ام |
| `setProducts(list)` | تعویض کاتالوگ (مثلاً بر اساس دسته‌بندی) |
| `fitReport()` | آرایهٔ ۴ چک: پهنای فریم، دسانتراسیون، پل، ارتفاع عدسی |
| `fitScore()` | `{ score 0..100, level: good\|ok\|poor, summary }` |
| `measurements()` | `{ pd, faceW, faceH, nose }` به میلی‌متر |
| `screenshot()` | عکس پرو (blob) با واترمارک فروشگاه |
| `on(name, fn)` / `off` | رویدادها |
| `destroy()` | حذف کامل + قطع دوربین |

رویدادها (روی همان المان یا `document` با `bubbles`):
`tryon:ready` · `tryon:product` · `tryon:variant` · `tryon:fit` · `tryon:faceshape` · `tryon:snapshot` · `tryon:cart` · `tryon:log` · `tryon:error`

اتصال به سبد خرید:

```js
tryon.on("tryon:cart", (e) => {
  addToCart({ sku: e.detail.sku, variant: e.detail.variant, qty: 1 });
});
```

اگر `cart.mode = "whatsapp"` باشد، لینک واتساپ با نام و قیمت محصول باز می‌شود؛ `"link"` صفحه را به `product.url` می‌برد.

---

## ۵) اسکیمای `products.json`

```jsonc
{
  "version": 2,
  "products": [
    {
      "id": "AR-104",
      "sku": "AR-104",
      "name": "گربه‌ای استات",
      "brand": "آروین",
      "price": 6200000,
      "currency": "تومان",
      "url": "/products/arvin-cateye",
      "shape": "cateye",              // round|oval|panto|square|rectangle|cateye|aviator|browline|geometric|hexagon|octagon|shield|butterfly|triangle|roundmetal|oversize
      "style": "full",                // full|half|brow|rimless|clip
      "material": "acetate",          // acetate|metal|mixed|titanium
      "finish": "tortoise",           // یکی از ۱۸ finishing در FINISHES
      "size": "53□19-145",            // همان عدد چاپی روی دسته
      "lens": "clear",                // clear|light-gray|gradient-gray|brown-gradient|mirror-blue|mirror-silver|yellow|polarized-gray
      "gender": "female",             // male|female|unisex
      "tags": ["sun", "fashion"],
      "bestFor": ["round", "square", "heart"],
      "colors": [
        { "name": "لاک‌پشتی", "color": "#8a5a2b", "finish": "tortoise", "lens": "brown-gradient", "accentColor": "#d8b478" }
      ],
      "spec": { "lensW": 53, "lensH": 41, "dbn": 19, "rimW": 5.2, "catAmp": 9, "templeLen": 145 },
      "glb": null                     // اگر مدل آماده دارید؛ اگر نه هندسه از spec ساخته می‌شود
    }
  ]
}
```

فیلدهای اجباری فقط `name` هستند؛ بقیه در صورت نبودن از `shape`/`size` و پیش‌فرض‌های امن پر می‌شوند. `spec` در صورت نیاز دستی نوشته می‌شود — ولی معمولاً `shape + size` کافی است.

---

## ۶) فریم جدید، بدون Blender

`studio.html` (همان `dist/studio.js`) ابزار ساخت کاتالوگ است:

1. عکس تمام‌جبههٔ فریم (PNG با پس‌زمینهٔ شفاف بهترین است) را بدهید؛
2. عدد چاپی روی دسته (`52□18`) را وارد کنید تا مقیاس واقعی شود؛
3. افزونه لبهٔ عدسی‌ها را دنبالی می‌کند (`lensPath` در میلی‌متر) و ارتفاع عدسی، پهنای پل و ضخامت رینگ را درمی‌آورد؛
4. با اسلایدرها صاف کنید، «تبدیل به پارامتر» بزنید تا به `shape` معمولی تبدیل شود؛
5. خروجی‌ها: **GLB** (برای صفحهٔ محصول/AR)، **PNG** (برای تامبنیل)، **JSON** (یک فریم) یا **`products.json`** (کاتالوگ کامل).

برای ردیف‌کردن کاتالوگ به‌صورت دسته‌ای: `node tools/case-catalog.mjs && npm run bake`.

---

## ۷) حریم خصوصی، مرورگرها، عیب‌یابی

- دوربین با `getUserMedia` باز می‌شود؛ تصویر هیچ‌جا ذخیره/آپلود نمی‌شود. اگر میزبان بخواهد، با `features.photo` حالت «پرو با عکس» هم فعال است (باز هم محلی).
- نیاز: WebGL 2 (سه‌بعدی) + `https` یا `localhost`. iOS 14.3+/Chrome 88+؛ در دستگاه ضعیف‌تر خودکار به `lite` می‌رود (سایه و لایهٔ مو خاموش).
- `tryon:error` را گوش کنید؛ دلایل رایج: `NotAllowedError` (کاربر اجازه نداده)، `NotFoundError` (دوربینی نیست)، `wasm` (مسیر `lib/` غلط است → `baseURL` را تنظیم کنید).
- اگر افزونه در iframe است: `allow="camera"` را روی تگ iframe بگذارید.
- اگر سایت شما CSP سخت‌گیرانه دارد: `script-src 'self'` کافی است (بدون inline اضافه); `connect-src` برای CDN و مدل‌ها، `img-src data:` برای تامبنیل‌ها.

```html
<iframe src="…" allow="camera; microphone"></iframe>
```
