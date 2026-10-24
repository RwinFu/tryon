# Locally installed skills

## Three.js skills
- Source: https://github.com/CloudAI-X/threejs-skills
- Pinned revision: `b1c623076c661fc9b03dac19292e825a5d106823`
- Selected: `threejs-materials`, `threejs-textures`, `threejs-geometry`, `threejs-lighting`
- Installed: 2026-09-26. Only Markdown reference files were copied; no upstream installer or executable was run.
- License: upstream README declares MIT; preserved in `UPSTREAM-README.md`.

These are development reference skills, not browser/runtime dependencies. They were selected for this project's existing Three.js + MediaPipe stack, not as a claim of a universal "best" ranking. API examples must be verified against the pinned Three.js r169 source (some upstream examples target other releases).

## REA clean-room workflow skill

- Source: https://github.com/thisisntartificial/rea-agent-skill
- Revision installed: `731ff8185c6b3b7b2cf23e216784c9826e4ec731`
- Installed: 2026-10-24
- Purpose: evidence-tagged, behavior-only analysis of the public Glasses.com try-on experience.
- Note: upstream repository did not declare an SPDX license at install time; retained here as agent instructions/reference, not shipped as a runtime dependency.

## Camera best-practices skill
- Sources:
  - https://github.com/Strangersknowme/react-camera-pro-with-torch (torch + facing switch)
  - https://github.com/webrtc/samples (enumerateDevices, facingMode handling)
  - https://www.twilio.com/blog/choosing-cameras-javascript-mediadevices-api
  - MDN MediaDevices, W3C mediacapture-main spec
- Created: 2026-09-29 — curated from top GitHub camera libs + MDN best practices
- Purpose: robust camera module design — constraints fallback chain, permission states, torch/zoom, mirroring, rVFC, iOS quirks, lifecycle
- License: MIT (own curation, no copied code)
- Used to redesign src/engine/camera.js and refactor tracking.js + stage.js + widget.js

