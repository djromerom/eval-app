"use client";

import { useEffect } from "react";

import {
  computePrintImageCapPx,
  computePrintImageMetrics,
  DEFAULT_IMAGE_MIN_DPI,
} from "@/shared/print/image-sizing";

/**
 * Ajusta el tamaño de las imágenes al imprimir para que no salgan borrosas.
 *
 * El ancho que el docente fija arrastrando la imagen en el editor se guarda
 * como porcentaje (`width="N%"`) y el navegador lo aplica tal cual: la
 * imagen se dibuja a N% del contenedor, sin mirar cuántos píxeles tiene el
 * archivo. Una imagen de 150 px arrastrada al 100% de una columna se
 * imprimía a 21 DPI — peor que en la pantalla (96 DPI).
 *
 * Este componente mide el tamaño natural de cada imagen ya cargada y le
 * pone un tope ABSOLUTO (`max-width: min(<n>px, 100%)`), con n = el ancho
 * que la imagen puede ocupar sin bajar de la resolución objetivo.
 *
 * Por qué el tope es absoluto y no relativo al contenedor: con un ancho
 * ya puesto en la etiqueta, el tamaño intrínseco de la imagen se recalcula
 * con ese ancho, y cualquier tope relativo (`max-content`, `min(100%,…)`)
 * deja de recortar (verificado en Chromium). Un tope en px es además
 * independiente del layout: la imagen ocupa lo mismo en una columna de
 * 85 mm que en una de 175 mm, así que el resultado en el papel es el mismo
 * que en la vista previa y que en el PDF que genera el worker.
 *
 * El `min(…, 100%)` conserva el comportamiento anterior: la imagen nunca
 * se sale de su columna.
 *
 * Se aplica en las rutas /print, no en el editor: el ancho que se ve en
 * pantalla es una preferencia de maquetación y se respeta tal cual (salvo
 * que la imagen se amplíe más allá de sus píxeles, que es el caso que se
 * corrige aquí).
 */
export function PrintImageSizer({
  minDpi = DEFAULT_IMAGE_MIN_DPI,
}: {
  /** DPI mínimo garantizado en el papel. 96 = igual que en pantalla. */
  minDpi?: number;
}) {
  useEffect(() => {
    let cancelled = false;

    const apply = () => {
      if (cancelled) return;

      const images = document.querySelectorAll<HTMLImageElement>(".booklet img");
      images.forEach((img) => {
        if (img.dataset.printSized === "1") return;
        // La portada tiene reglas propias (fondo a sangre, logo con alto
        // fijo): un tope de calidad las deformaría.
        if (img.closest(".cover-logo, .cover-custom")) return;

        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;
        // 0 = imagen rota o que no llegó a cargar.
        if (!naturalWidth || !naturalHeight) return;

        // Ancho pedido por el docente (el `N%` ya resuelto contra el
        // contenedor). Se mide ANTES de aplicar el tope.
        const requestedWidth = img.getBoundingClientRect().width;
        if (!requestedWidth) return;

        const capPx = computePrintImageCapPx(naturalWidth, minDpi);
        if (!capPx) return;

        const metrics = computePrintImageMetrics({
          naturalWidth,
          naturalHeight,
          requestedWidth,
          capPx,
        });

        img.style.maxWidth = `min(${capPx}px, 100%)`;
        img.dataset.printSized = "1";

        if (metrics.clamped) {
          console.warn(
            `[print-image] La imagen mide ${naturalWidth}×${naturalHeight} px y se iba a ` +
              `imprimir a ${metrics.requestedWidthMm.toFixed(1)} mm ` +
              `(${metrics.requestedDpi.toFixed(0)} DPI). Se recorta a ` +
              `${metrics.finalWidthMm.toFixed(1)} mm (${metrics.dpi.toFixed(0)} DPI) ` +
              `para que no salga borrosa. Si la quieres más grande, sube una ` +
              `versión de mayor resolución.`,
            img.getAttribute("src") ?? "(sin src)",
          );
        }
      });
    };

    // Se espera al `load` (todas las imágenes cargadas) y a dos frames para
    // que el layout esté asentado antes de medir.
    const schedule = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(apply);
      });
    };

    if (document.readyState === "complete") {
      schedule();
    } else {
      window.addEventListener("load", schedule, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", schedule);
    };
  }, [minDpi]);

  return null;
}
