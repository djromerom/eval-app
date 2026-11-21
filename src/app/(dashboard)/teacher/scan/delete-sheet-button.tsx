"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants, Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteSheetAction, type SheetDeleteState } from "./actions";

/** Submit interno: muestra "Eliminando…" mientras la action corre.
 *
 *  NO usamos `<AlertDialogAction>` acá: Radix hace que ese botón cierre el
 *  dialog al click, y al estar dentro de un `<form action={formAction}>`
 *  con `useActionState`, la carrera es desordenada y el submit se pierde
 *  (el form se desmonta antes de mandar). Un `<Button type="submit">` normal
 *  dispara el submit y deja que el `useEffect` de arriba cierre al éxito. */
function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      disabled={pending}
      className={cn(buttonVariants({ variant: "destructive", size: "sm" }))}
    >
      {pending ? "Eliminando…" : "Eliminar"}
    </Button>
  );
}

/** Botón "Eliminar hoja" + AlertDialog de confirmación.
 *
 *  Se monta en las hojas REVIEW del listado (ver SheetsTable) y en el
 *  detalle de la hoja, donde el docente también puede quitar una hoja ya
 *  calificada (subió una hoja al lote equivocado, o quiere reescanearla).
 *  El éxito se detecta cuando el state de `useActionState` viene sin
 *  `error` Y el form ya no está pendiente — un cleanup useEffect cierra el
 *  modal y el padre re-renderiza la tabla sin esa fila. Si hay error, se
 *  muestra inline en el footer del diálogo y NO se cierra. */
export function DeleteSheetButton({
  batchId,
  sheetId,
  shortId,
  redirectTo,
}: {
  batchId: string;
  sheetId: string;
  /** Slice corto del id de la hoja, sólo para personalizar el copy
   *  ("Eliminar hoja a08d05…"). */
  shortId: string;
  /** A dónde ir cuando se elimina. En el detalle de la hoja la fila ya no
   *  existe: quedarse en esa URL mostraría una hoja que el servidor no
   *  encuentra, así que se vuelve al lote. */
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SheetDeleteState, FormData>(deleteSheetAction, {});
  // El estado inicial de `useActionState` es `{}` (mismo que el de éxito),
  // así que sin este flag no se distingue "recién monté" de "el action
  // terminó bien" — y con `redirectTo` eso era saltar al lote nada más
  // abrir la pantalla.
  const [enviado, setEnviado] = useState(false);
  const router = useRouter();

  // Cerrar al éxito: el action devuelve `{}` cuando no hay error Y ya
  // revalidó las rutas. Usamos el flag `success` derivado de la ausencia
  // de error. La transición `open=false` se hace UNA sola vez por
  // request exitosa; como `state` se queda en `{}`, el effect no se
  // vuelve a disparar.
  useEffect(() => {
    if (enviado && state && !state.error) {
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
    }
  }, [enviado, state, redirectTo, router]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Eliminar hoja ${shortId}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-destructive hover:text-destructive",
          )}
        >
          <Trash2 className="size-3.5" />
          Eliminar
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar hoja</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a eliminar la hoja <span className="font-mono">{shortId}</span> y su archivo del
            lote. La nota NO se conserva.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction} className="contents" onSubmit={() => setEnviado(true)}>
          <input type="hidden" name="sheetId" value={sheetId} />
          <input type="hidden" name="batchId" value={batchId} />
          {state.error ? (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
            >
              {state.error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={false}>Cancelar</AlertDialogCancel>
            <DeleteSubmit />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
