#!/usr/bin/env python3
"""
Preparación de datos para la interfaz web de revisión OMR.
Módulo puro (sin Streamlit) para poder probarlo y reutilizarlo.
"""

import base64
import tempfile
from pathlib import Path

import cv2
import numpy as np

from omr_reader import analyze_sheet


def build_sheet_data(data: bytes, suffix: str = ".jpg",
                     letters: str = "ABCDEFGH") -> dict:
    """
    Corre el motor OMR sobre los bytes de una imagen y produce la estructura
    que consume el componente de revisión: respuestas, ratios de relleno y
    un recorte (base64 JPEG) por pregunta con las detecciones dibujadas.
    """
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        tmp = f.name
    try:
        gray, questions, thr = analyze_sheet(tmp, letters)
    finally:
        Path(tmp).unlink(missing_ok=True)

    h, w = gray.shape
    out = []
    for q in questions:
        xs = [b.x for b in q.bubbles]
        ys = [b.y for b in q.bubbles]
        r = float(np.median([b.r for b in q.bubbles]))
        x0 = max(0, int(min(xs) - 2.2 * r))
        x1 = min(w, int(max(xs) + 2.2 * r))
        y0 = max(0, int(min(ys) - 2.0 * r))
        y1 = min(h, int(max(ys) + 2.0 * r))
        crop = cv2.cvtColor(gray[y0:y1, x0:x1], cv2.COLOR_GRAY2BGR)
        for b in q.bubbles:
            color = (0, 0, 255) if b.marked else (0, 160, 0)
            cv2.circle(crop, (int(b.x - x0), int(b.y - y0)), int(b.r), color, 2)
        # sin upscale en servidor: el navegador amplía con image-rendering:
        # pixelated, y el payload por hoja se reduce ~8x
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
        out.append({
            "n": q.number,
            "ans": q.answer,
            # x,y,r en coords de la imagen original: el lado TS reconstruye la
            # bbox de cada burbuja (BubbleCellRecord) sin volver a detectar.
            "fills": [{"l": b.letter, "f": round(b.fill, 2), "m": bool(b.marked),
                       "x": int(round(b.x)), "y": int(round(b.y)),
                       "r": int(round(b.r))}
                      for b in q.bubbles],
            "crop": base64.b64encode(buf).decode() if ok else "",
        })
    return {"thr": round(thr, 3), "questions": out}
