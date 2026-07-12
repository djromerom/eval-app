# workers/

Procesos independientes que consumen las colas BullMQ. **No** son parte del
servidor Next.js: corren como procesos aparte (PM2 en el VPS) para no bloquear
el request/response de la app. Ver REQUERIMIENTOS_v2.md §3.6 y §9.

| Worker          | Cola             | Responsabilidad                                                       |
| --------------- | ---------------- | --------------------------------------------------------------------- |
| `omr.worker.ts` | `omr-scan`       | Califica cada hoja escaneada: QR → alineación → burbujas → puntaje.   |
| `pdf.worker.ts` | `pdf-generation` | Genera PDFs server-side con Puppeteer (descarga masiva de cartillas). |

## Desarrollo

```bash
pnpm worker:omr   # tsx workers/omr.worker.ts
pnpm worker:pdf   # tsx workers/pdf.worker.ts
```

Requieren Redis en marcha (`docker compose up -d`) y las mismas variables de
entorno que la app (`REDIS_URL`, `DATABASE_URL`, `QR_SIGNING_SECRET`, `STORAGE_DIR`).

## Producción (PM2)

Cada worker es un proceso long-running con apagado ordenado (SIGTERM/SIGINT).
El pipeline OMR usa `sharp` + heurística; el microservicio Python/OpenCV es un
fallback **solo si** la precisión baja del 95 % — no se construye de forma preventiva.
