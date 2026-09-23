/* ساخته‌شده از src/ui/styles.css توسط tools/build.mjs — دستی ویرایش نکنید */
export default `/* ══════════════════════════════════════════════════════════════════
   Virtual Try-On — استایل افزونه
   توکن‌ها از host قابل بازنویسی‌اند: --vt-accent, --vt-surface, …
   ══════════════════════════════════════════════════════════════════ */
:host {
  --vt-accent: #d8b478;
  --vt-accent-2: #f2d9a8;
  --vt-ink: #08090b;
  --vt-surface: #0e1114;
  --vt-surface-2: rgba(17, 21, 25, 0.92);
  --vt-text: #f6f8f9;
  --vt-muted: rgba(246, 248, 249, 0.56);
  --vt-line: rgba(255, 255, 255, 0.13);
  --vt-radius: 22px;
  --vt-good: #2fa06c;
  --vt-warn: #e0a53d;
  --vt-bad: #e2705f;
  --vt-font: Vazirmatn, "IRANSans", system-ui, Tahoma, sans-serif;
  --vt-shadow: 0 26px 70px rgba(0, 0, 0, 0.55);
  display: block;
  position: relative;
  font-family: var(--vt-font);
  color: var(--vt-text);
  -webkit-tap-highlight-color: transparent;
  contain: layout paint;
}
:host([hidden]) {
  display: none;
}
* {
  box-sizing: border-box;
  margin: 0;
}
button,
input {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
  border: 0;
  background: none;
  touch-action: manipulation;
}
:focus-visible {
  outline: 2px solid var(--vt-accent-2);
  outline-offset: 2px;
  border-radius: 6px;
}

/* ── قاب/صحنه ───────────────────────────────────────────────────── */
.wrap {
  position: absolute;
  inset: 0;
  display: block;
  overflow: hidden;
  border-radius: inherit;
  isolation: isolate;
  background: var(--vt-surface);
}
.stage-wrap {
  /* لایه‌ها از پایین: صحنه → سایه تماس → GL → پوشش‌ها */
  contain: layout paint style;
}
#gateBody {
  display: contents;
}
.stage.lite canvas#sh,
.stage.lite .scanline {
  display: none;
}
.stage.lite canvas#oc {
  opacity: 0.72;
}
.stage.scanning .scanline {
  opacity: 1;
}
.stage {
  position: absolute;
  inset: 0;
  background: #05070a;
  overflow: hidden;
  border-radius: inherit;
  isolation: isolate;
}
.stage canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(var(--vt-mirror, -1));
}
.stage canvas.ui-space {
  transform: none;
}
#cv {
  filter: brightness(1.03) saturate(1.02);
}
#gl,
#oc,
#sh,
#mesh {
  pointer-events: none;
}
.mode-inline .stage canvas {
  object-fit: cover;
}

/* ── نوار بالا ──────────────────────────────────────────────────── */
.top {
  position: absolute;
  z-index: 6;
  inset-inline: 0;
  top: 0;
  padding: 14px 16px 34px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  background: linear-gradient(180deg, rgba(4, 6, 8, 0.8), rgba(4, 6, 8, 0.15) 70%, transparent);
  pointer-events: none;
}
.top > * {
  pointer-events: auto;
}
.brand {
  position: relative;
  padding-inline-start: 13px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.3px;
  line-height: 1.15;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.6);
}
.brand::before {
  content: "";
  position: absolute;
  inset-inline-start: 0;
  top: 2px;
  width: 3px;
  height: 100%;
  border-radius: 9px;
  background: linear-gradient(var(--vt-accent-2), rgba(120, 92, 44, 0.5));
}
.brand small {
  display: block;
  margin-top: 3px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.52);
}
.topR {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border-radius: 99px;
  font-size: 9.5px;
  font-weight: 700;
  color: #f6e9cf;
  background: rgba(8, 11, 14, 0.6);
  border: 1px solid rgba(216, 180, 120, 0.34);
  backdrop-filter: blur(14px);
}
.status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5dd39e;
  box-shadow: 0 0 0 3px rgba(93, 211, 158, 0.14);
}
.status[data-state="search"] i {
  background: var(--vt-warn);
  box-shadow: 0 0 0 3px rgba(224, 165, 61, 0.16);
  animation: pulse 1.4s infinite;
}
.status[data-state="error"] i {
  background: var(--vt-bad);
  box-shadow: none;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.xbtn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 16px;
  color: #fff;
  background: rgba(8, 11, 14, 0.6);
  border: 1px solid var(--vt-line);
  backdrop-filter: blur(14px);
}
.xbtn:active {
  transform: scale(0.94);
}

/* ── راهنمای متنی (toast) ───────────────────────────────────────── */
.hint {
  position: absolute;
  z-index: 8;
  top: 74px;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(92%, 460px);
  padding: 9px 15px;
  border-radius: 99px;
  font-size: 11.5px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #fdf1d8;
  background: rgba(9, 11, 14, 0.9);
  border: 1px solid rgba(216, 180, 120, 0.3);
  backdrop-filter: blur(14px);
  opacity: 0;
  transition: opacity 0.35s;
  pointer-events: none;
}
.hint.show {
  opacity: 1;
}

/* ── داک پایین ──────────────────────────────────────────────────── */
.dock {
  position: absolute;
  z-index: 7;
  inset-inline: 0;
  bottom: 0;
  padding: 8px 10px calc(10px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 7px;
  background: linear-gradient(165deg, rgba(19, 22, 26, 0.94), rgba(6, 8, 10, 0.9));
  border-top: 1px solid var(--vt-line);
  backdrop-filter: blur(22px) saturate(1.2);
}
.mode-inline .dock {
  position: relative;
  border-radius: 0 0 var(--vt-radius) var(--vt-radius);
}
.pull {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--vt-line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  text-align: start;
}
.pull b {
  display: block;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: -0.2px;
}
.pull span {
  display: block;
  margin-top: 2px;
  font-size: 9.5px;
  color: var(--vt-muted);
}
.price {
  direction: ltr;
  font-size: 12.5px;
  font-weight: 800;
  padding: 6px 10px;
  border-radius: 12px;
  color: #16120b;
  background: linear-gradient(145deg, var(--vt-accent-2), var(--vt-accent));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
}
.price small {
  font-size: 8.5px;
  font-weight: 700;
  opacity: 0.7;
}

/* ردیف فریم‌ها با تامبنیلِ رندرشده */
.rail {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 2px 1px 4px;
  scrollbar-width: none;
}
.rail::-webkit-scrollbar {
  display: none;
}
.card {
  position: relative;
  scroll-snap-align: start;
  flex: 0 0 auto;
  width: 92px;
  padding: 5px 6px 7px;
  border-radius: 15px;
  border: 1px solid var(--vt-line);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
  text-align: center;
  transition: border-color 0.2s, transform 0.2s, background 0.2s;
}
.card img,
.card svg {
  display: block;
  width: 100%;
  height: 42px;
  object-fit: contain;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45));
}
.card em {
  display: block;
  margin-top: 3px;
  font-size: 9.5px;
  font-style: normal;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card[aria-pressed="true"] {
  border-color: rgba(255, 255, 255, 0.5);
  background: linear-gradient(160deg, rgba(242, 217, 168, 0.24), rgba(216, 180, 120, 0.08));
  transform: translateY(-2px);
}
.card.rec::after {
  content: "★";
  position: absolute;
  top: -5px;
  inset-inline-end: -4px;
  width: 17px;
  height: 17px;
  font-size: 10px;
  line-height: 17px;
  border-radius: 50%;
  color: #1b1608;
  background: var(--vt-accent-2);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.4);
}

.swatches {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 26px;
}
.dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: transform 0.16s, border-color 0.16s;
}
.dot[aria-pressed="true"] {
  border-color: #fff;
  transform: scale(1.08);
  box-shadow: 0 0 0 3px rgba(216, 180, 120, 0.5), 0 4px 12px #000;
}
.actions {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.btn {
  min-width: 0;
  height: 44px;
  border-radius: 13px;
  border: 1px solid var(--vt-line);
  background: rgba(255, 255, 255, 0.05);
  font-size: 10px;
  font-weight: 750;
  color: #eef2f3;
  display: grid;
  place-items: center;
  gap: 1px;
  padding: 0 4px;
  transition: transform 0.14s, filter 0.2s;
}
.btn small {
  font-size: 8px;
  font-weight: 600;
  color: var(--vt-muted);
}
.btn:active {
  transform: scale(0.965);
}
.btn.primary {
  color: #17120b;
  background: linear-gradient(145deg, #f0d59f, #c89d57);
  border-color: rgba(255, 245, 222, 0.6);
}
.btn.buy {
  color: #fff;
  background: linear-gradient(145deg, #1ba466, #117348);
  border-color: rgba(91, 235, 165, 0.24);
}

/* ── پنل «برگهٔ فیت» ─────────────────────────────────────────────── */
.sheet {
  position: absolute;
  z-index: 12;
  inset-inline: 0;
  bottom: 0;
  max-height: min(78%, 520px);
  overflow: auto;
  padding: 18px 18px calc(22px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(16, 19, 23, 0.97), rgba(8, 10, 12, 0.99));
  border-top: 1px solid var(--vt-line);
  border-radius: 26px 26px 0 0;
  box-shadow: var(--vt-shadow);
  transform: translateY(101%);
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
.sheet.open {
  transform: none;
}
.sheet h3 {
  font-size: 16px;
  font-weight: 850;
  margin-bottom: 3px;
}
.sheet p.lead {
  font-size: 11px;
  line-height: 1.8;
  color: var(--vt-muted);
  margin-bottom: 14px;
}
.specgrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.specgrid div {
  padding: 9px 6px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--vt-line);
  text-align: center;
}
.specgrid b {
  display: block;
  font-size: 15px;
  font-weight: 850;
  direction: ltr;
}
.specgrid span {
  display: block;
  margin-top: 2px;
  font-size: 8.5px;
  color: var(--vt-muted);
}
.fitrow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 10px;
  padding: 11px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  align-items: center;
}
.fitrow b {
  font-size: 12px;
  font-weight: 750;
}
.fitrow span {
  font-size: 10px;
  color: var(--vt-muted);
  line-height: 1.7;
  grid-column: 1 / -1;
}
.tag {
  padding: 4px 9px;
  border-radius: 99px;
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
  border: 1px solid currentColor;
}
.tag[data-status="good"] {
  color: #64d39c;
}
.tag[data-status="warn"] {
  color: #f0c476;
}
.tag[data-status="bad"] {
  color: #f09184;
}
.rowEnd {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.rowEnd .btn {
  flex: 1;
  height: 46px;
  font-size: 11.5px;
}
.field {
  display: grid;
  gap: 6px;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--vt-line);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.03);
}
.field label {
  font-size: 11px;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.field input[type="range"] {
  width: 100%;
  accent-color: var(--vt-accent);
}
.field .num {
  width: 100%;
  height: 46px;
  border-radius: 12px;
  border: 1px solid rgba(216, 180, 120, 0.32);
  background: rgba(0, 0, 0, 0.28);
  padding: 0 12px;
  font-size: 17px;
  font-weight: 800;
  direction: ltr;
}
.switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 14px;
  background: rgba(216, 180, 120, 0.07);
  border: 1px solid rgba(216, 180, 120, 0.22);
  font-size: 11.5px;
  font-weight: 700;
}
.switch small {
  display: block;
  font-weight: 500;
  color: var(--vt-muted);
  font-size: 9px;
  margin-top: 2px;
}
.switch input {
  display: none;
}
.switch i {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 24px;
  border-radius: 99px;
  background: #45494e;
  transition: background 0.2s;
}
.switch i::after {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  top: 3px;
  inset-inline-start: 3px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch input:checked + i {
  background: var(--vt-accent);
}
.switch input:checked + i::after {
  transform: translateX(18px);
  background: #17120b;
}

/* ── صفحهٔ خوش‌آمد / اجازهٔ دوربین ───────────────────────────────── */
.gate {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: radial-gradient(circle at 50% 18%, #2b251c 0, #101318 38%, #060708 82%);
  overflow: auto;
}
.gate[hidden] {
  display: none;
}
.gate .card2 {
  width: min(94%, 400px);
  padding: 24px 22px 20px;
  text-align: center;
  border-radius: 26px;
  background: linear-gradient(155deg, rgba(26, 30, 35, 0.94), rgba(9, 11, 14, 0.92));
  border: 1px solid var(--vt-line);
  box-shadow: var(--vt-shadow);
}
.gate .mark {
  width: 76px;
  height: 54px;
  margin: 0 auto 14px;
  display: grid;
  place-items: center;
  border-radius: 20px;
  background: linear-gradient(145deg, #f4dfb5, #c89b51);
  color: #13100b;
}
.gate h2 {
  font-size: 23px;
  font-weight: 900;
  letter-spacing: -0.6px;
}
.gate h2::after {
  content: attr(data-sub);
  display: block;
  margin-top: 6px;
  font-size: 7.5px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--vt-accent);
}
.gate .sub {
  margin: 12px auto 16px;
  max-width: 280px;
  font-size: 11px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.58);
}
.gateProd {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: -6px auto 14px;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.gateProd span {
  color: rgba(255, 255, 255, 0.55);
}
.gateProd b {
  color: var(--vt-accent-2, #f2d9a8);
  font-weight: 800;
}
.gateProd small {
  direction: ltr;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
}
.gateProd[hidden] {
  display: none;
}
.steps {
  display: grid;
  gap: 1px;
  text-align: start;
  font-size: 11px;
  padding: 4px 13px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 16px;
}
.steps div {
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  gap: 9px;
  align-items: baseline;
}
.steps div:last-child {
  border: 0;
}
.steps b {
  color: var(--vt-accent);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.go {
  width: 100%;
  height: 52px;
  border-radius: 15px;
  font-size: 14px;
  font-weight: 900;
  color: #17120b;
  background: linear-gradient(145deg, #f4dfb5, #d4aa62);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.34);
}
.go:active {
  transform: scale(0.985);
}
.priv {
  margin-top: 12px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.36);
  line-height: 1.7;
}
.err {
  margin-top: 12px;
  padding: 11px 13px;
  border-radius: 14px;
  font-size: 10.5px;
  line-height: 1.8;
  text-align: start;
  color: #ffd9d3;
  background: rgba(120, 30, 20, 0.35);
  border: 1px solid rgba(226, 112, 95, 0.4);
}
.err code {
  display: block;
  margin-top: 5px;
  font-size: 9px;
  opacity: 0.72;
  direction: ltr;
  white-space: normal;
  word-break: break-word;
}
.spin {
  width: 34px;
  height: 34px;
  margin: 0 auto 12px;
  border-radius: 50%;
  border: 2px solid rgba(216, 180, 120, 0.25);
  border-top-color: var(--vt-accent-2);
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(1turn);
  }
}
.busy .spin {
  display: block;
}

/* اسکن‌لاین‌های حین اسکن */
.scanline {
  position: absolute;
  inset-inline: 12%;
  top: 18%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(242, 217, 168, 0.85), transparent);
  box-shadow: 0 0 12px rgba(216, 180, 120, 0.6);
  opacity: 0;
  transition: opacity 0.4s;
  pointer-events: none;
  z-index: 5;
}
.scanning .scanline {
  opacity: 1;
  animation: sweep 2.4s ease-in-out infinite;
}
@keyframes sweep {
  0% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(210px);
  }
  100% {
    transform: translateY(0);
  }
}
.vt-toast {
  position: absolute;
  z-index: 30;
  bottom: calc(100% + 12px);
  inset-inline: 14px;
  padding: 11px 14px;
  border-radius: 14px;
  font-size: 11.5px;
  font-weight: 650;
  text-align: center;
  background: rgba(12, 14, 17, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
}

/* ── تم روشن (وقتی سایت میزبان روشن است) ────────────────────────── */
:host([theme="light"]) {
  --vt-surface: #ffffff;
  --vt-surface-2: rgba(255, 255, 255, 0.94);
  --vt-text: #14171a;
  --vt-muted: rgba(20, 23, 26, 0.6);
  --vt-line: rgba(0, 0, 0, 0.12);
  --vt-shadow: 0 20px 60px rgba(15, 20, 26, 0.18);
}
:host([theme="light"]) .dock {
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.96), rgba(243, 245, 247, 0.98));
}
:host([theme="light"]) .card {
  background: linear-gradient(160deg, #fff, #f1f3f5);
  border-color: rgba(0, 0, 0, 0.09);
}
:host([theme="light"]) .card em {
  color: #33383d;
}
:host([theme="light"]) .top {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0));
}
:host([theme="light"]) .brand {
  color: #14171a;
  text-shadow: none;
}
:host([theme="light"]) .brand small {
  color: rgba(20, 23, 26, 0.55);
}
:host([theme="light"]) .xbtn,
:host([theme="light"]) .status {
  color: #23272b;
  background: rgba(255, 255, 255, 0.86);
  border-color: rgba(0, 0, 0, 0.1);
}
:host([theme="light"]) .hint {
  color: #23272b;
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(0, 0, 0, 0.1);
}
:host([theme="light"]) .btn {
  color: #1b1e21;
  background: rgba(0, 0, 0, 0.045);
  border-color: rgba(0, 0, 0, 0.1);
}
:host([theme="light"]) .sheet {
  background: linear-gradient(180deg, #fff, #f6f7f9);
  color: #14171a;
}
:host([theme="light"]) .gate {
  background: radial-gradient(circle at 50% 15%, #f3ece0 0, #ffffff 55%);
}
:host([theme="light"]) .gate .card2 {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.08);
  color: #14171a;
}
:host([theme="light"]) .gate .sub,
:host([theme="light"]) .priv {
  color: rgba(20, 23, 26, 0.6);
}
:host([theme="light"]) .steps {
  background: #f7f8f9;
  border-color: rgba(0, 0, 0, 0.08);
  color: #33383d;
}

/* ── موبایل کوتاه / حالت سبک ─────────────────────────────────────── */
@media (max-height: 700px) {
  .rail {
    padding-bottom: 2px;
  }
  .card {
    width: 80px;
  }
  .card img,
  .card svg {
    height: 34px;
  }
  .actions .btn {
    height: 42px;
  }
}
@media (max-width: 480px) {
  .gate {
    padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom));
  }
  .gate .card2 {
    width: min(100%, 400px);
    max-height: 100%;
    overflow-y: auto;
    padding: 20px 16px 16px;
  }
  .gate h2 {
    font-size: 21px;
  }
  .gate .go {
    min-height: 52px;
  }
}
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001s !important;
    transition-duration: 0.001s !important;
  }
}
`;
