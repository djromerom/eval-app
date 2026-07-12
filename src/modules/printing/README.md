# Módulo: printing

Generación de cartillas (cuadernillos doble carta formato ICFES) y hojas de respuesta OMR con QR firmado.

- Estrategia primaria: **Print CSS** (`@page` tabloid) — el docente imprime desde el navegador (rutas `src/app/print/*` + `src/styles/print.css`).
- Secundaria: Puppeteer + @sparticuz/chromium server-side (worker `pdf-generation`).
- `domain/print-spec.ts` — constantes de la plantilla institucional (validar contra el PDF de referencia).
- `infrastructure/qr-generator.ts` — QR firmado HMAC-SHA256 por institución.
