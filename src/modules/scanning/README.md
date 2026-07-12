# Módulo: scanning

Escaneo y calificación automática (OMR + QR). Pipeline por hoja:
QR (identifica evaluación/estudiante, verifica firma) → alineación por fiducials →
detección de burbujas → calificación contra la clave de la versión publicada.

- `domain/bubble-classification.ts` — umbrales y clasificación de marcas (regla pura, con tests).
- `domain/qr-payload.ts` — esquema del contenido del QR firmado.
- `infrastructure/preprocess-image.ts` — preprocesamiento con sharp.
- El procesamiento corre asíncrono en `workers/omr.worker.ts` vía BullMQ (lotes de hasta 200 hojas).

**Regla del spec**: el microservicio Python/OpenCV es un fallback SOLO si la precisión
del algoritmo heurístico cae por debajo de 95%. No construirlo preventivamente.
