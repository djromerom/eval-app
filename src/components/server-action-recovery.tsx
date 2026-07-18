"use client";

/**
 * Defensiva contra `UnrecognizedActionError` de Next.js (Server Action hash
 * mismatch). Puede ocurrir cuando:
 *
 *   - El usuario abrió una pestaña antes de un re-deploy y los IDs de las
 *     Server Actions cambiaron (Next.js los hashea por archivo + posición).
 *   - El navegador cacheó estado RSC de una sesión anterior (modo dev local,
 *     preview, etc.) y la página actual referencia IDs que ya no existen.
 *
 * Next.js ya responde con un error 404 "Server action not found", pero ese
 * error cae en el client component que llamó la action y la UI queda en estado
 * roto. Lo que hacemos acá es interceptar el error y forzar un único reload
 * limpio, que vuelve a fetchear todas las acciones desde el servidor actual.
 *
 * El flag `data-recovered` en sessionStorage evita bucles infinitos (un reload
 * por pestaña por sesión, no más).
 */
import { useEffect } from "react";

const RECOVERED_FLAG = "eval.serverActionRecovered";

export function ServerActionRecovery() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(RECOVERED_FLAG) === "1") return;

    const tryRecover = (message: string) => {
      if (!message.includes("Server Action")) return;
      if (!message.includes("not found")) return;
      // Marcamos ANTES de recargar para que el reload no re-dispare.
      window.sessionStorage.setItem(RECOVERED_FLAG, "1");
      // Forzamos recarga full (no RSC navigation) — limpia cualquier cache
      // en memoria del cliente Next.js.
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => {
      tryRecover(event.message ?? event.error?.message ?? "");
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message ?? (typeof event.reason === "string" ? event.reason : "");
      tryRecover(msg);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
