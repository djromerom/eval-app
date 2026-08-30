"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ReviewActionButtonProps {
  /** Server action que recibe FormData con `evaluationId`. */
  action: (formData: FormData) => Promise<void>;
  evaluationId: string;
  /** Texto literal del toast al terminar OK (sin formato). */
  successMessage: string;
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline";
}

/** Wrapper client-side para los botones de acción "simples" del módulo de
 *  revisión (Aprobar, Publicar, Volver a borrador desde PUBLICADAS).
 *
 *  Reemplaza al patrón anterior `<form action={approveAction}><Button>…`
 *  para poder disparar `toast.success()` al terminar la transición. El
 *  server action sigue siendo el mismo; el wrapper solo orquesta el
 *  pending state vía `useTransition` y muestra la confirmación.
 *
 *  NO se usa para Rechazar/Rechazo tardío porque ese caso necesita un
 *  <form> con textarea para el comentario obligatorio (ver `reject-form.tsx`).
 *
 *  Sprint 2026-08-30: feedback explícito post-cambio de estado. */
export function ReviewActionButton({
  action,
  evaluationId,
  successMessage,
  label,
  pendingLabel,
  variant = "default",
}: ReviewActionButtonProps) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const fd = new FormData();
    fd.set("evaluationId", evaluationId);
    startTransition(async () => {
      await action(fd);
      toast.success(successMessage);
    });
  }

  return (
    <Button type="button" size="sm" variant={variant} disabled={pending} onClick={handleClick}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
