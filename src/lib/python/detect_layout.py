#!/usr/bin/env python3
"""
Detector de regiones de página para saber-extractor.

Corre DocLayout-YOLO (DocStructBench) sobre las páginas indicadas de un PDF y
escribe en stdout un JSON con las regiones detectadas y sus cajas normalizadas.

Existe porque estimar el bbox de una figura con un LLM es impreciso y ajustarlo
con heurísticas de píxeles solo funciona en algunos maquetados. Este modelo está
entrenado justo para esta tarea, así que da cajas ajustadas de forma determinista.

Uso:
    detect_layout.py --pdf examen.pdf --pages 3,5,8 [--dpi 150] [--conf 0.25]

Salida (stdout, una sola línea JSON):
    {"ok": true, "model": "...", "pages": {"3": [
        {"label": "figure", "score": 0.94, "bbox": [x0, y0, x1, y1]}
    ]}}

Las cajas van normalizadas 0-1 sobre la página, origen arriba-izquierda, que es
el mismo convenio que usa el resto del pipeline.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

MODEL_REPO = "wybxc/DocLayout-YOLO-DocStructBench-onnx"
MODEL_FILE = "doclayout_yolo_docstructbench_imgsz1024.onnx"
MODEL_URL = f"https://huggingface.co/{MODEL_REPO}/resolve/main/{MODEL_FILE}"
IMG_SIZE = 1024


def cache_dir() -> Path:
    base = os.environ.get("SABER_MODEL_DIR")
    if base:
        return Path(base)
    return Path.home() / ".cache" / "saber-extractor"


def ensure_model(quiet: bool = True) -> Path:
    """Descarga el modelo la primera vez y lo deja cacheado."""
    path = cache_dir() / MODEL_FILE
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    if not quiet:
        print(f"descargando modelo ({MODEL_REPO})...", file=sys.stderr)
    import urllib.request

    with urllib.request.urlopen(MODEL_URL, timeout=300) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(path)
    return path


def render_pages(pdf: str, pages: list[int], dpi: int, outdir: str) -> dict[int, str]:
    """Rasteriza las páginas pedidas con pdftoppm (ya es dependencia del proyecto)."""
    out: dict[int, str] = {}
    for p in pages:
        prefix = os.path.join(outdir, f"p{p}")
        subprocess.run(
            ["pdftoppm", "-png", "-r", str(dpi), "-f", str(p), "-l", str(p), pdf, prefix],
            check=True,
            capture_output=True,
        )
        produced = sorted(f for f in os.listdir(outdir) if f.startswith(f"p{p}-"))
        if produced:
            out[p] = os.path.join(outdir, produced[0])
    return out


def letterbox(image, size: int, stride: int = 32):
    """Escala manteniendo proporción y rellena hasta múltiplo de `stride`."""
    import cv2

    h, w = image.shape[:2]
    r = min(size / h, size / w)
    rh, rw = int(round(h * r)), int(round(w * r))
    image = cv2.resize(image, (rw, rh), interpolation=cv2.INTER_LINEAR)
    pad_w = (size - rw) % stride
    pad_h = (size - rh) % stride
    top, bottom = pad_h // 2, pad_h - pad_h // 2
    left, right = pad_w // 2, pad_w - pad_w // 2
    image = cv2.copyMakeBorder(
        image, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    return image


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--pages", required=True, help="lista separada por comas, 1-based")
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--check", action="store_true", help="solo comprobar dependencias")
    args = ap.parse_args()

    try:
        import cv2  # noqa: F401
        import numpy as np
        import onnxruntime as ort
    except ImportError as e:
        print(json.dumps({"ok": False, "error": f"falta dependencia: {e}"}))
        return 1

    if args.check:
        print(json.dumps({"ok": True, "check": True}))
        return 0

    try:
        model_path = ensure_model()
    except Exception as e:  # red caída, disco lleno, etc.
        print(json.dumps({"ok": False, "error": f"no se pudo obtener el modelo: {e}"}))
        return 1

    session = ort.InferenceSession(
        str(model_path), providers=["CPUExecutionProvider"]
    )
    meta = session.get_modelmeta().custom_metadata_map
    names = ast.literal_eval(meta["names"]) if "names" in meta else {}
    input_name = session.get_inputs()[0].name

    pages = [int(p) for p in args.pages.split(",") if p.strip()]
    result: dict[str, list] = {}

    with tempfile.TemporaryDirectory() as tmp:
        rendered = render_pages(args.pdf, pages, args.dpi, tmp)
        for page, png in rendered.items():
            img = cv2.imread(png)
            if img is None:
                continue
            orig_h, orig_w = img.shape[:2]
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            padded = letterbox(rgb, IMG_SIZE)
            new_h, new_w = padded.shape[:2]
            blob = padded.transpose(2, 0, 1)[None].astype(np.float32) / 255.0

            preds = session.run(None, {input_name: blob})[0]
            preds = preds[preds[..., 4] > args.conf]

            # Deshacer el letterbox para volver a coordenadas de la página.
            gain = min(new_h / orig_h, new_w / orig_w)
            pad_x = round((new_w - orig_w * gain) / 2 - 0.1)
            pad_y = round((new_h - orig_h * gain) / 2 - 0.1)

            boxes = []
            for d in preds:
                x0, y0, x1, y1 = d[:4]
                x0 = (x0 - pad_x) / gain
                x1 = (x1 - pad_x) / gain
                y0 = (y0 - pad_y) / gain
                y1 = (y1 - pad_y) / gain
                boxes.append(
                    {
                        "label": names.get(int(d[-1]), str(int(d[-1]))),
                        "score": round(float(d[4]), 4),
                        "bbox": [
                            round(float(max(0.0, min(1.0, x0 / orig_w))), 5),
                            round(float(max(0.0, min(1.0, y0 / orig_h))), 5),
                            round(float(max(0.0, min(1.0, x1 / orig_w))), 5),
                            round(float(max(0.0, min(1.0, y1 / orig_h))), 5),
                        ],
                    }
                )
            boxes.sort(key=lambda b: -b["score"])
            result[str(page)] = boxes

    print(json.dumps({"ok": True, "model": MODEL_FILE, "pages": result}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
