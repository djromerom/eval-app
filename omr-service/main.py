#!/usr/bin/env python3
"""
omr-service — microservicio de detección OMR para ecognIA.
==========================================================

FastAPI que envuelve el motor de visión (`omr_reader` + `omr_web_data`) validado
en el PoC. NO contiene lógica de negocio: solo recibe una imagen de hoja escaneada
y devuelve, por pregunta, la respuesta detectada, los ratios de relleno por opción
y un recorte (JPEG base64) con las burbujas marcadas dibujadas.

Consumido por el worker OMR de Node (`workers/omr.worker.ts` →
`HttpOmrDetector`). El QR, la clave correcta, el scoring y la persistencia viven
en el lado TS; aquí solo se procesan píxeles.

Arranque (solo loopback, nunca expuesto públicamente):
    uvicorn main:app --host 127.0.0.1 --port 8000

El contrato de `/analyze` es exactamente el que produce `build_sheet_data`:
    { "thr": float, "questions": [ { "n": int, "ans": str,
        "fills": [ {"l": str, "f": float, "m": bool}, ... ],
        "crop": "<base64 jpeg>" }, ... ] }
donde `ans` ∈ { "A".."H", "BLANCO", "MULTIPLE:XY" }.

`/qr` es un endpoint aparte, mucho más barato (solo decodifica el QR, sin
detección de burbujas): lo usa el lado TS como fallback cuando su propio
decoder no logra leer el QR de un escaneo degradado.
"""

from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from omr_web_data import build_sheet_data, decode_qr

app = FastAPI(title="ecognIA — omr-service", version="1.0.0")

LETTERS = "ABCDEFGH"


@app.get("/health")
async def health():
    return {"ok": True, "service": "omr-service"}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    letters: str = Form(LETTERS),
):
    """Corre el motor OMR sobre la imagen subida y devuelve el contrato de revisión.

    `letters` acota el número de opciones consideradas (default A–H).
    Una hoja ilegible responde 422 con `{error}` en vez de tumbar el servicio.
    """
    data = await file.read()
    suffix = Path(file.filename or "scan.jpg").suffix or ".jpg"
    try:
        result = build_sheet_data(data, suffix, letters or LETTERS)
        return JSONResponse(result)
    except Exception as e:  # hoja ilegible / formato no soportado
        return JSONResponse({"error": str(e)}, status_code=422)


@app.post("/qr")
async def qr(file: UploadFile = File(...)):
    """Decodifica solo el QR de identificación de la hoja.

    Fallback del decoder del lado TS (`sharpQrDecoder`): este usa el
    decodificador WeChat de opencv-contrib, que sobre escaneos degradados lee
    hojas que aquel no. No corre detección de burbujas, así que es varias veces
    más barato que `/analyze` — importa porque en ese punto del flujo TS aún no
    conoce el número de opciones de la hoja y no podría pedir un `/analyze` útil.

    Responde 200 con `{found: false, text: ""}` si la hoja es legible pero no
    tiene QR decodificable — eso NO es un error del servicio, es información
    que el llamador necesita para decidir. Solo una imagen ilegible da 422.

    `text` es el contenido crudo impreso en el QR: el lado TS verifica la firma
    HMAC sobre él, así que no puede ser una re-serialización.
    """
    data = await file.read()
    suffix = Path(file.filename or "scan.jpg").suffix or ".jpg"
    try:
        return JSONResponse(decode_qr(data, suffix))
    except Exception as e:  # imagen ilegible / formato no soportado
        return JSONResponse({"error": str(e)}, status_code=422)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
