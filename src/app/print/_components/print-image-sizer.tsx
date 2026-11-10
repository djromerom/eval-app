"use client";

import { useEffect } from "react";

import { DEFAULT_IMAGE_MIN_DPI } from "@/shared/print/image-sizing";
import {
  applyPrintImagePlan,
  describePrintImagePlan,
  planPrintImageSizing,
} from "@/shared/print/print-image-sizing";

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
 * AJUSTE POR LEGIBILIDAD (además del tope de nitidez)
 *
 * El tope de arriba evita que una imagen salga BORROSA, pero no evita que
 * salga ilegible: una captura de pantalla con rótulos de 10 px impresa a
 * 35 mm deja esos rótulos en 2,4 pt. Aquí se mide el texto que hay DENTRO
 * de la imagen y se calcula el ancho mínimo con el que ese texto llega a
 * `MIN_PRINT_TEXT_PT` (6 pt) sin ampliar la imagen más allá de sus píxeles.
 *
 * El ancho se fija en MILÍMETROS, no en píxeles, para que la vista previa y
 * el PDF coincidan: los píxeles CSS de la vista previa están a escala de
 * pantalla (la hoja se ve a 800 px de ancho), mientras que el milímetro es
 * absoluto y es lo mismo en el papel.
 *
 * DOS COLUMNAS
 *
 * El ancho mínimo se compara con la hoja completa, no con la columna: si el
 * texto cabe en la hoja pero la imagen está en una columna de 85 mm, se
 * agranda igual y el navegador la recorta al 100% del contenedor (`max-width`),
 * que es lo que hace que la imagen ocupe su columna sin desbordarla. Una
 * pregunta con imagen o tabla ya cruza las dos columnas por su cuenta
 * (`.question.wide { column-span: all }`), así que el ancho real del
 * contenedor es el que le toca a cada caso.
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
    // La misma imagen puede repetirse en varias preguntas: se analiza una
    // sola vez.
    const textHeightCache = new Map<string, number | null>();

    const apply = () => {
      if (cancelled) return;

      const images = document.querySelectorAll<HTMLImageElement>(".booklet img");
      images.forEach((img) => {
        if (img.dataset.printSized === "1") return;
        // La portada tiene reglas propias (fondo a sangre, logo con alto
        // fijo): un tope de calidad las deformaría.
        if (img.closest(".cover-logo, .cover-custom")) return;

        const plan = planPrintImageSizing(img, { minDpi, textHeightCache });
        if (!plan) return;

        applyPrintImagePlan(img, plan);
        img.dataset.printSized = "1";

        if (plan.widthMm != null) {
          console.warn(
            `[print-image] ${describePrintImagePlan(plan)}`,
            img.getAttribute("src") ?? "(sin src)",
          );
        }

        if (plan.metrics.clamped) {
          console.warn(
            `[print-image] La imagen mide ${plan.naturalWidthPx}×${img.naturalHeight} px y se iba a ` +
              `imprimir a ${plan.metrics.requestedWidthMm.toFixed(1)} mm ` +
              `(${plan.metrics.requestedDpi.toFixed(0)} DPI). Se recorta a ` +
              `${plan.metrics.finalWidthMm.toFixed(1)} mm (${plan.metrics.dpi.toFixed(0)} DPI) ` +
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
