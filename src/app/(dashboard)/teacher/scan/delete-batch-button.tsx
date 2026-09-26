"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
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
import { deleteBatchAction, type BatchDeleteState } from "./actions";

/** Submit interno: muestra "Eliminando…" mientras la action corre.
 *
 *  NO usamos `<AlertDialogAction>` acá: Radix hace que ese botón cierre el
 *  dialog al click, y al estar dentro de un `<form action={formAction}>`
 *  con `useActionState`, la carrera es desordenada y el submit se pierde
 *  (el form se desmonta antes de mandar). Un `<Button type="submit">` normal
 *  dispara el submit y deja que el `useEffect` de arriba cierre al éxito.
 *  Mismo patrón que `delete-sheet-button.tsx:20-40`. */
function DeleteBatchSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      disabled={pending}
      className={cn(buttonVariants({ variant: "destructive", size: "sm" }))}
    >
      {pending ? "Eliminando…" : "Eliminar lote"}
    </Button>
  );
}

/** Botón "Eliminar lote" + AlertDialog de confirmación.
 *
 *  El padre (`batch-cards-list.tsx`) decide cuándo montar este componente
 *  según el filtro de acceso (TEACHER dueño / ECU_LIDER institucional /
 *  uploader para unclassified). Aquí NO validamos permisos: eso lo hace
 *  el use case en el server action.
 *
 *  Los conteos `total` / `calificadas` / `sinClasificar` se DERIVAN en el
 *  padre desde `BatchForList.sheets` y el count de unclassified. Esta prop
 *  API hace explícito que el modal SIEMPRE los conoce (no los recalcula). */
export function DeleteBatchButton({
  batchId,
  shortId,
  total,
  calificadas,
  sinClasificar,
}: {
  batchId: string;
  shortId: string;
  total: number;
  calificadas: number;
  sinClasificar: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<BatchDeleteState, FormData>(deleteBatchAction, {});

  // Cerrar al éxito: el action devuelve `{}` cuando no hay error Y ya
  // revalidó las rutas. La transición `open=false` se hace UNA sola vez
  // por request exitosa; como `state` se queda en `{}`, el effect no se
  // vuelve a disparar. Mismo patrón que delete-sheet-button.tsx:71-75.
  useEffect(() => {
    if (state && !state.error) {
      setOpen(false);
    }
  }, [state]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Eliminar lote ${shortId}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-destructive hover:text-destructive",
          )}
        >
          <Trash2 className="size-3.5" />
          Eliminar lote
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar lote</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a eliminar el lote <span className="font-mono">{shortId}</span> con {total} hoja
            {total === 1 ? "" : "s"} ({calificadas} calificada{calificadas === 1 ? "" : "s"}) y{" "}
            {sinClasificar} sin clasificar. Las notas calificadas NO se conservan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction} className="contents">
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
            <DeleteBatchSubmit />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
