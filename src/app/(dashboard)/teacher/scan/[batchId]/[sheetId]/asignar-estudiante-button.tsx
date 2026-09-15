"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { asignarEstudianteHojaAction } from "./actions";

/** Lo que necesita el selector para mostrar y enviar la asociación. La forma
 *  se mantiene chiquita a propósito: el listado puede ser largo y esto viaja
 *  serializado al cliente. */
export interface StudentOption {
  id: string;
  code: string;
  /** "APELLIDO1 APELLIDO2, NOMBRE1 NOMBRE2" — mismo formato que
   *  `nombreCompleto` para no reinventar. */
  name: string;
  groupName: string;
}

/** Selector + botón Asignar para cuando el worker no detectó el QR y la hoja
 *  quedó huérfana. Aparece solo si el lote viene de un Cuadernillo: con
 *  formulación suelta no hay un "curso del cuadernillo" del que sacar el
 *  alcance (ver página que lo monta).
 *
 *  Save explícito con botón "Asignar" (no auto-save al elegir) porque la
 *  operación cambia la identidad de la hoja y un click de más cuesta menos
 *  que un error silencioso. Tras asignar, `router.refresh()` repinta el
 *  encabezado con el nombre del estudiante. */
export function AsignarEstudianteButton({
  sheetId,
  batchId,
  students,
}: {
  sheetId: string;
  batchId: string;
  students: StudentOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAsignar() {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    const result = await asignarEstudianteHojaAction({
      sheetId,
      batchId,
      studentId: selected,
    });
    setSaving(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  if (students.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
        <p className="font-medium text-amber-900">
          QR no detectado y no hay estudiantes activos en el curso de este
          cuadernillo. Asigná uno desde administración y vuelve a reprocesar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">
        QR no detectado. Asigná manualmente a qué estudiante pertenece esta hoja:
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={saving}
          className="bg-background min-w-72 rounded border px-2 py-1 text-sm"
          aria-label="Estudiante a asignar"
        >
          <option value="">— elegir estudiante —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.groupName} — {s.code}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onAsignar}
          disabled={!selected || saving}
          className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? "Asignando…" : "Asignar"}
        </button>
      </div>
      {error && <p className="text-red-700 text-xs">{error}</p>}
    </div>
  );
}
