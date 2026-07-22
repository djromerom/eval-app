# omr-service

Microservicio de **detección OMR** (Python + OpenCV) para ecognIA. Envuelve el motor
de visión validado en el PoC (`omr_reader.py` + `omr_web_data.py`) tras una API REST
mínima (FastAPI). Lo consume el worker OMR de Node (`workers/omr.worker.ts` vía
`HttpOmrDetector`).

**Separación de responsabilidades:** este servicio solo procesa píxeles (deskew →
detección de burbujas → recortes). El QR, la verificación HMAC, la clave correcta, el
scoring y la persistencia viven en el lado TypeScript. El servicio **nunca** se expone
públicamente: escucha solo en loopback (`127.0.0.1`).

## Contrato

`GET /health` → `{ "ok": true }`

`POST /analyze` (multipart: `file`, `letters`=opcional, default `ABCDEFGH`)
→ JSON de `build_sheet_data`:

```json
{
  "thr": 0.504,
  "questions": [
    { "n": 1, "ans": "B",
      "fills": [ {"l":"A","f":0.23,"m":false}, {"l":"B","f":0.99,"m":true}, ... ],
      "crop": "<base64 jpeg>" }
  ]
}
```

`ans` ∈ `{ "A".."H", "BLANCO", "MULTIPLE:XY" }`. Hoja ilegible → `422 { "error": ... }`.

## Desarrollo local

```bash
cd omr-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Prueba rápida:

```bash
curl -s -F file=@../../omr-poc/uploads/<hoja>.jpg http://127.0.0.1:8000/analyze | head -c 300
```

Correr junto al resto del stack: `pnpm dev` + `pnpm worker:omr` + este uvicorn.
El worker lo descubre por `OMR_SERVICE_URL` (default `http://127.0.0.1:8000`).

## Producción (VPS)

Proceso `uvicorn` gestionado por PM2 junto a los workers omr/pdf, **solo en loopback**:

```bash
python3 -m venv /opt/ecognia/omr-service/.venv
/opt/ecognia/omr-service/.venv/bin/pip install -r requirements.txt
# PM2: uvicorn main:app --host 127.0.0.1 --port 8000  (ver deploy/)
```

nginx **no** debe proxyar este puerto. El acceso es solo desde el worker local.
