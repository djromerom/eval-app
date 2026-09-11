"use client";

import { useEffect } from "react";

/**
 * Auto-imprime la página cuando la URL lleva `?autoprint=1`.
 *
 * Usado por:
 * - el botón "Descargar PDF" del answer-sheets student picker (sep 2026)
 *   para los bundles: en lugar de descargar un HTML con extensión `.pdf`
 *   (que el visor PDF del navegador no puede parsear → "Failed to load PDF
 *   document"), abrimos la ruta /print en una ventana popup y disparamos
 *   `window.print()` desde DENTRO de la propia popup. El diálogo del
 *   navegador ofrece "Guardar como PDF" como destino, así el docente
 *   obtiene un PDF real sin pasar por la cola asíncrona del worker PDF
 *   (puppeteer+BullMQ).
 * - el botón "Generar hojas de respuestas" del teacher dashboard (sep
 *   2026): la server action redirige a /print/bulk-answer-sheets con
 *   `&autoprint=1` y esta misma página abre el diálogo de impresión al
 *   cargar, sin paso manual de "ir al HTML y pulsar Imprimir".
 *
 * Por qué se llama desde dentro y no desde la opener: Chrome bloquea
 * `popup.print()` invocado desde la ventana padre por políticas anti-popup
 * (sólo permite `print()` cuando es la propia popup la que lo llama, en
 * respuesta al gesto del usuario que la abrió).
 */
export function AutoPrint() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoprint") !== "1") return;

    const trigger = () => {
      // Pequeño delay para que el navegador termine de pintar el contenido
      // (imágenes, fuentes) antes de abrir el diálogo.
      setTimeout(() => {
        try {
          window.focus();
          window.print();
        } catch (err) {
          console.error("[autoprint] print() failed:", err);
        }
      }, 250);
    };

    if (document.readyState === "complete") {
      trigger();
    } else {
      window.addEventListener("load", trigger, { once: true });
    }
  }, []);

  return null;
}
