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

from omr_reader import analyze_sheet, check_structure, read_qr


def build_sheet_data(data: bytes, suffix: str = ".jpg",
                     letters: str = "ABCDEFGH") -> dict:
    """
    Corre el motor OMR sobre los bytes de una imagen y produce la estructura
    que consume el componente de revisión: identificación del estudiante
    (leída del QR), respuestas, ratios de relleno y un recorte (base64 JPEG)
    por pregunta con las detecciones dibujadas.
    """
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        tmp = f.name
    try:
        gray, questions, thr, qr, thr_warn, rotation = analyze_sheet(tmp, letters)
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
            # x,y,r en coords de la imagen procesada: el lado TS reconstruye
            # la bbox de cada burbuja (BubbleCellRecord) sin volver a detectar.
            # Si la hoja entró girada, van en el sistema ya rotado; `rotacion`
            # (abajo) dice cuánto se giró respecto del original subido.
            "fills": [{"l": b.letter, "f": round(b.fill, 2), "m": bool(b.marked),
                       "x": int(round(b.x)), "y": int(round(b.y)),
                       "r": int(round(b.r))}
                      for b in q.bubbles],
            # Aviso por item del motor (p. ej. "letras ambiguas", "falta la
            # opcion A"). Aditivo: el lado TS lo ignora sin romperse.
            "aviso": q.warning,
            "crop": base64.b64encode(buf).decode() if ok else "",
        })
    ident = qr if isinstance(qr, dict) else {}
    return {
        "thr": round(thr, 3),
        "questions": out,
        "student": ident.get("student", ""),
        "sheet": ident.get("sheet", ""),
        "qr": qr,
        "aviso": thr_warn,
        "rotacion": rotation,
        # Verificacion estructural (huecos entre filas, bloques desparejos).
        # Es la red contra la falla silenciosa: una fila no leida corre la
        # numeracion y produce una lectura completa y verosimil pero mal
        # asignada. Lista vacia = la estructura cierra.
        "estructura": check_structure(questions),
    }


def decode_qr(data: bytes, suffix: str = ".jpg") -> dict:
    """
    Decodifica SOLO el QR de identificacion, sin detectar burbujas.

    Existe como fallback del decoder del lado TS (`sharpQrDecoder`): cuando
    aquel no logra leer el QR, el use case reintenta contra este servicio, que
    usa el decodificador WeChat de opencv-contrib (mucho mas tolerante con los
    escaneos degradados). Es deliberadamente mas barato que `build_sheet_data`
    -- no corre deteccion de burbujas ni genera recortes -- porque en ese punto
    del flujo todavia no se sabe cuantas opciones tiene la hoja.

    `text` es el contenido crudo del QR, no una re-serializacion del dict: la
    firma HMAC aguas arriba se verifica sobre lo que estaba impreso.
    """
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        tmp = f.name
    try:
        img = cv2.imread(tmp)
        if img is None:
            raise ValueError("no se pudo leer la imagen")
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    finally:
        Path(tmp).unlink(missing_ok=True)

    payload, box, raw = read_qr(gray)
    return {
        "found": raw is not None,
        "text": raw or "",
        "payload": payload if isinstance(payload, dict) else None,
        "bbox": list(box) if box is not None else None,
    }
