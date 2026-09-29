---
name: camera-best-practices
description: Best practices for robust browser camera handling — MediaDevices, permissions, constraints fallback, torch/zoom, mirroring, orientation, RVFC, iOS quirks. Use when building or refactoring camera modules.
---

# Camera Best Practices (Browser)

Curated from GitHub top camera libs (react-camera-pro, WebRTC samples, Twilio guide) + MDN + W3C spec.

## Quick Start - Robust Camera Module

```javascript
class Camera {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute('playsinline','');
  }
  async start({ facing='user', width=960, height=720 } = {}) {
    if (!window.isSecureContext) throw new Error('HTTPS required');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('MediaDevices unavailable');

    // Fallback chain: exact deviceId → exact facing → ideal facing → ideal res → true
    const tries = [
      { video: { facingMode: { exact: facing }, width: { ideal: width }, height: { ideal: height } } },
      { video: { facingMode: { ideal: facing }, width: { ideal: width }, height: { ideal: height } } },
      { video: { width: { ideal: width }, height: { ideal: height } } },
      { video: true }
    ];
    let lastErr;
    for (const c of tries) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ ...c, audio: false });
        this.video.srcObject = stream;
        await new Promise((res, rej) => {
          const onMeta = () => { if (this.video.videoWidth) res(); };
          this.video.addEventListener('loadedmetadata', onMeta, { once: true });
          setTimeout(() => rej(new Error('metadata timeout')), 15000);
        });
        await this.video.play();
        return stream;
      } catch (e) { lastErr = e; if (['NotAllowedError','SecurityError'].includes(e.name)) break; }
    }
    throw lastErr;
  }
}
```

## Core Concepts

### Secure Context & Support Check
```javascript
if (!window.isSecureContext && location.hostname !== 'localhost') throw new Error('HTTPS required');
if (!('mediaDevices' in navigator) || typeof navigator.mediaDevices.getUserMedia !== 'function') throw new Error('getUserMedia unsupported');
```

### Permission States (optional but UX gold)
```javascript
try {
  const st = await navigator.permissions.query({ name: 'camera' });
  // st.state: 'granted' | 'denied' | 'prompt'
  st.onchange = () => console.log('permission changed', st.state);
} catch {}
```

### Enumerate & Score Devices
- Labels are empty until permission granted — handle gracefully.
- Score devices by torch, continuous focus, facingMode, label heuristics.
```javascript
const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
function scoreDevice(dev, caps) {
  let s=0;
  if (caps?.torch) s+=10;
  if (caps?.focusMode?.includes('continuous')) s+=6;
  const l = dev.label.toLowerCase();
  if (l.includes('back')||l.includes('rear')) s+=5;
  return s;
}
```

### Constraints: Ideal vs Exact
- `exact` throws OverconstrainedError if not satisfied → use as first try, then fallback to `ideal`.
- Never use exact for facingMode alone on unknown devices; provide fallback.
- Width/height: use ideal with max to avoid over-constraint.

### Torch / Zoom
```javascript
const caps = track.getCapabilities();
if (caps.torch) await track.applyConstraints({ advanced: [{ torch: true }] });
if (caps.zoom) await track.applyConstraints({ advanced: [{ zoom: Math.min(caps.zoom.max, 2) }] });
```

### Mirroring
- Front camera (`user`) should be mirrored for selfie UX, but tracking uses unmirrored coordinates.
- Use CSS `transform: scaleX(-1)` on video/canvas containers, controlled by `--vt-mirror` var.
- For snapshots, flip canvas manually if mirrored.

### Frame Timing
- Prefer `video.requestVideoFrameCallback` (rVFC) over rAF for camera frames — synced to actual camera frame delivery, lower latency, battery friendly.
- Fallback to rAF if not supported.

### iOS Quirks
- Video must be `playsInline`, `muted`, `autoplay`, and ideally attached to DOM (even 1px hidden).
- `play()` may require user gesture — catch NotAllowedError.
- Disable picture-in-picture.

### Lifecycle
- Always `track.stop()` on stop/dispose.
- Listen to `devicechange`, `visibilitychange`, `orientationchange`.
- Pause frame loop when hidden to save battery.
- Use ResizeObserver for container size changes.

### Error Mapping
```javascript
const map = {
  NotAllowedError: 'permDenied',
  NotFoundError: 'noCamera',
  NotReadableError: 'busy',
  OverconstrainedError: 'overconstrained',
  SecurityError: 'needHttps'
};
```

## Common Pitfalls
1. Forgetting to stop tracks → camera light stays on.
2. Using exact constraints without fallback → OverconstrainedError on many devices.
3. Not handling empty device labels before permission.
4. Mirroring background incorrectly → transmission shader mismatch.
5. Using currentTime comparison for frame dedup — use rVFC metadata or track settings.

## Performance
- Don't recreate CanvasTexture each frame; reuse and set needsUpdate.
- Sample light estimation on 32x32 canvas, not full-res.
- Throttle light matching (700ms) and hair segmentation (130ms).

## See Also
- threejs-fundamentals (scene setup)
- MediaDevices MDN, W3C mediacapture-main spec
