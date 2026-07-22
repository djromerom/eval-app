import puppeteer from "puppeteer";
import { env } from "@/config/env";
import { signPrintToken } from "@/shared/infrastructure/crypto/print-token";
import { decodeQrWithPoints } from "@/modules/scanning/infrastructure/qr-decoder";
import type { SheetTemplate, TemplateBubble } from "../domain/sheet-template";

/**
 * Captura la geometría REAL de una hoja de respuestas de compendio abriendo
 * la misma ruta `/print/answer-sheets/bundle/[id]` que usa el generador de
 * PDF, y midiendo con `getBoundingClientRect()` dónde quedó cada burbuja.
 *
 * Esta es la pieza que garantiza que el OMR y la impresión no puedan
 * desincronizarse: no hay un segundo cálculo de posiciones: se lee el
 * resultado del único render que existe.
 *
 * Coste: un arranque de Chromium (~1–2 s). Se ejecuta **una vez por
 * compendio** y el resultado se cachea (la rejilla no depende del
 * estudiante), así que no está en el camino caliente del escaneo.
 */
/** Carta (8.5×11 in) a 96 DPI, la caja que usa Puppeteer para
 *  `format: "letter"`. Medir en otra caja desalinea la rejilla. */
const LETTER_PX = { width: 816, height: 1056 } as const;

/** Multiplicador de resolución de la captura para que el QR sea legible. */
const SCREENSHOT_SCALE = 3;

export async function captureSheetGeometry(input: {
  bundleId: string;
  /** Institución dueña del compendio: el token de impresión la exige y la
   *  ruta la usa para filtrar por tenant. */
  institutionId: string;
  /** Un studentId cualquiera del compendio: la ruta exige al menos uno para
   *  renderizar, pero la rejilla resultante es idéntica para todos. */
  sampleStudentId: string;
}): Promise<SheetTemplate> {
  const token = signPrintToken({
    bundleId: input.bundleId,
    institutionId: input.institutionId,
    kind: "answer-sheets-bundle",
  });
  const baseUrl = env.PRINT_BASE_URL ?? env.AUTH_URL ?? "http://localhost:3000";
  const url =
    `${baseUrl}/print/answer-sheets/bundle/${input.bundleId}` +
    `?t=${encodeURIComponent(token)}&students=${encodeURIComponent(input.sampleStudentId)}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    // CRÍTICO: hay que medir en las MISMAS condiciones en que se imprime.
    // El layout usa CSS grid con `1fr`, así que las posiciones dependen del
    // ancho del contenedor: medir en un viewport de pantalla (p. ej.
    // 1200×1600) da una rejilla distinta de la que produce
    // `page.pdf({format:"letter"})`. Medido a 1200×1600, las burbujas
    // salían ~45 px a la izquierda y con filas de más al comparar contra el
    // escaneo real.
    //
    // Carta a 96 DPI = 816×1056 px, que es la caja que usa Puppeteer al
    // generar el PDF, y `emulateMediaType("print")` activa las mismas
    // reglas @media print (print.css declara `size: letter portrait`).
    // `deviceScaleFactor` NO altera el layout (las medidas siguen en CSS px)
    // pero multiplica la resolución de la captura, que es lo que necesita el
    // decodificador de QR: a 816 px de ancho el QR mide ~120 px y no
    // decodifica; a ×3 son ~360 px y sí.
    await page.emulateMediaType("print");
    await page.setViewport({
      width: LETTER_PX.width,
      height: LETTER_PX.height,
      deviceScaleFactor: SCREENSHOT_SCALE,
    });
    const res = await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
    if (!res || !res.ok()) {
      throw new Error(`No se pudo cargar la hoja para medir (HTTP ${res?.status()})`);
    }
    if (page.url().includes("/login")) {
      throw new Error("Acceso a /print rechazado al medir geometría (token inválido)");
    }

    // OJO: el callback de `evaluate` se serializa y corre DENTRO del
    // navegador, donde no existen los helpers que esbuild/tsx inyecta para
    // `keepNames`. Declarar una función auxiliar aquí (p. ej. `const norm =
    // (r) => …`) revienta con `__name is not defined`. Por eso el callback
    // solo recoge rectángulos crudos y la normalización se hace en Node.
    const measured = await page.evaluate(() => {
      const sheet = document.querySelector(".sheet");
      if (!sheet) return null;
      const s = sheet.getBoundingClientRect();
      if (s.width <= 0 || s.height <= 0) return null;

      const qrEl = sheet.querySelector("[data-omr-qr]");
      const q = qrEl ? qrEl.getBoundingClientRect() : null;

      const raw: { question: number; key: string; l: number; t: number; w: number; h: number }[] =
        [];
      sheet.querySelectorAll("[data-omr-q][data-omr-key]").forEach((el) => {
        const num = Number(el.getAttribute("data-omr-q"));
        const key = el.getAttribute("data-omr-key");
        if (!Number.isFinite(num) || !key) return;
        const r = el.getBoundingClientRect();
        raw.push({ question: num, key, l: r.left, t: r.top, w: r.width, h: r.height });
      });

      return {
        sheet: { l: s.left, t: s.top, w: s.width, h: s.height },
        qr: q ? { l: q.left, t: q.top, w: q.width, h: q.height } : null,
        raw,
      };
    });

    if (!measured) throw new Error("No se encontró el elemento .sheet al medir geometría");
    if (!measured.qr) throw new Error("No se encontró el QR ([data-omr-qr]) al medir geometría");
    if (measured.raw.length === 0) {
      throw new Error("No se midió ninguna burbuja ([data-omr-q][data-omr-key])");
    }

    const s = measured.sheet;
    const normalize = (r: { l: number; t: number; w: number; h: number }) => ({
      x: (r.l - s.l) / s.w,
      y: (r.t - s.t) / s.h,
      w: r.w / s.w,
      h: r.h / s.h,
    });

    const bubbles: TemplateBubble[] = measured.raw.map((b) => ({
      question: b.question,
      key: b.key,
      rect: normalize(b),
    }));

    // Finder patterns del QR sobre una captura de la hoja. Se usa el MISMO
    // decodificador que en el escaneo para que la correspondencia sea
    // punto-a-punto (ver `SheetTemplate.qrFinders`).
    const shot = await page.screenshot({
      clip: { x: s.l, y: s.t, width: s.w, height: s.h },
      type: "png",
    });
    // Diagnóstico: `OMR_DEBUG_SHOT=/ruta.png` vuelca la captura que se usó
    // para localizar el QR. Imprescindible cuando el registro no cuadra —
    // fue así como se detectó que una hoja escaneada correspondía a una
    // versión anterior del layout.
    if (process.env.OMR_DEBUG_SHOT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.OMR_DEBUG_SHOT, Buffer.from(shot));
    }
    let qrFinders: { x: number; y: number }[] = [];
    try {
      const detected = await decodeQrWithPoints(Buffer.from(shot));
      if (detected) {
        // La captura sale a `SCREENSHOT_SCALE`× el tamaño CSS del clip, así
        // que hay que dividir por él para normalizar contra `.sheet`.
        // Burbujas y finders quedan así en el MISMO marco, que es lo único
        // que exige el registro (el marco en sí es arbitrario: se cancela
        // al resolver plantilla → escaneo).
        qrFinders = detected.points.map((p) => ({
          x: p.x / (s.w * SCREENSHOT_SCALE),
          y: p.y / (s.h * SCREENSHOT_SCALE),
        }));
      }
    } catch {
      // Registro caerá al ajuste por aspecto; no es fatal.
    }

    return {
      version: 1,
      aspectRatio: s.w / s.h,
      qr: normalize(measured.qr),
      qrFinders,
      bubbles,
    };
  } finally {
    await browser.close();
  }
}
