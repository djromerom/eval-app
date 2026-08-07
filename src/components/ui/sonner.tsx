"use client";

import { Toaster as SonnerToaster } from "sonner";

/** Wrapper shadcn de sonner con los defaults del theme institucional.
 *
 *  - position top-right: no tapa el sidebar ni el contenido scrolleado.
 *  - richColors: success usa verde, sin redefinir CSS — hereda los tokens
 *    de globals.css (--background / --foreground / --primary).
 *  - closeButton: a11y WCAG 2.1.1 — descartable por teclado.
 *  - expand: si el copy crece en el futuro, el toast se expande en lugar
 *    de truncar.
 *  - duration 3500: balance entre leíble y no estorba. El reset interno
 *    de actionStatus (setTimeout 2500 ms) corre un poco antes.
 *
 *  Se monta una sola vez en src/app/layout.tsx. Cualquier ruta de la app
 *  puede disparar `toast.success(...)` desde sonner sin provider extra.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      expand
      duration={3500}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toaster]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toaster]:text-muted-foreground",
        },
      }}
    />
  );
}