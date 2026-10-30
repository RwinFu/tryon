#!/usr/bin/env python3
"""
tools/landmarks.py — لندمارکِ ۴۷۸ نقطه‌ای از یک عکس (MediaPipe Tasks, همان مدلِ مخزن)

برای ساختِ «فیکسچر طلایی» از عکس‌های تست استفاده می‌شود: خروجی همان شکلی است که
`FaceTracker.solve()` و `tools/seat-preview.mjs` می‌خوانند.

    python3 tools/landmarks.py --photo a.png --out a.json [--flip]

خروجی: { W, H, landmarks:[{x,y,z}…478], matrix:[16] | null, blendshapes:{…} }
(همهٔ x/y نرمالِ ۰..۱ با مبدأ بالا-چپ، مثلِ MediaPipe در مرورگر.)

نیازمندی: python3 -m venv + `pip install "numpy<2" opencv-python-headless mediapipe==0.10.21`
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_MODEL = os.path.join(ROOT, "lib", "face_landmarker.task")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--photo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max", type=int, default=1280, help="بیشترین بُعدِ تصویر (مثلِ widget)")
    ap.add_argument("--flip", action="store_true", help="نسخهٔ آینه‌ای (سلفی)")
    a = ap.parse_args()

    img = cv2.imread(a.photo, cv2.IMREAD_COLOR)
    if img is None:
        print("عکس خوانده نشد:", a.photo, file=sys.stderr)
        return 2
    if a.flip:
        img = cv2.flip(img, 1)
    h, w = img.shape[:2]
    k = min(1.0, a.max / max(w, h))
    if k < 1:
        img = cv2.resize(img, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]

    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    opts = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=a.model),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        res = lm.detect(mp_img)

    if not res.face_landmarks:
        print("صورت پیدا نشد:", a.photo, file=sys.stderr)
        return 3
    face = res.face_landmarks[0]
    matrix = None
    if res.facial_transformation_matrixes:
        matrix = [float(v) for v in np.asarray(res.facial_transformation_matrixes[0]).flatten()]
    shapes = {}
    if res.face_blendshapes:
        shapes = {c.category_name: round(float(c.score), 4) for c in res.face_blendshapes[0]}

    out = {
        "W": w,
        "H": h,
        "source": os.path.basename(a.photo),
        "flipped": bool(a.flip),
        "landmarks": [{"x": float(p.x), "y": float(p.y), "z": float(p.z)} for p in face],
        "matrix": matrix,
        "blendshapes": shapes,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"wrote {a.out} · {w}x{h} · {len(face)} landmarks · matrix={'yes' if matrix else 'no'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
