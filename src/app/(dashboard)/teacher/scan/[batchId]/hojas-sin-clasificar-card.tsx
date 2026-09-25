"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clasificarHojaAction, estudiantesDelCuadernilloAction } from "./actions";
import type { StudentOption } from "./[sheetId]/asignar-estudiante-button";

export interface HojaSinClasificarRow {
  id: string;
  nombre: string;
  motivo: string;
  /** null mientras nadie la clasifique. */
  resuelta: {
    sheetId: string | null;
    batchId: string | null;
    estudiante: string;
    cuadernillo: string;
    /** El job no entró a la cola (Redis caído): hay que Reprocesarla. */
    sinEncolar: boolean;
  } | null;
}

/** Hojas de la carga automática cuyo QR no dijo el cuadernillo. Por cada una
 *  se elige cuadernillo y estudiante, y "Calificar" crea la hoja en el lote de
 *  ese cuadernillo y la manda al motor. */
export function HojasSinClasificarCard({
  batchId,
  hojas,
  cuadernillos,
  cuadernilloPorDefecto,
  estudiantesIniciales,
}: {
  batchId: string;
  hojas: HojaSinClasificarRow[];
  cuadernillos: { id: string; name: string }[];
  /** El cuadernillo del lote, si está LISTO: lo más probable para estas hojas. */
  cuadernilloPorDefecto: string;
  estudiantesIniciales: StudentOption[];
}) {
  // Estudiantes por cuadernillo, compartidos entre filas: cambiar el
  // cuadernillo en una fila no vuelve a pedir una lista ya traída.
  const [estudiantes, setEstudiantes] = useState<Record<string, StudentOption[]>>(
    cuadernilloPorDefecto ? { [cuadernilloPorDefecto]: estudiantesIniciales } : {},
  );

  async function cargarEstudiantes(bundleId: string) {
    if (!bundleId || estudiantes[bundleId]) return;
    const lista = await estudiantesDelCuadernilloAction(bundleId);
    setEstudiantes((prev) => ({ ...prev, [bundleId]: lista }));
  }

  const pendientes = hojas.filter((h) => !h.resuelta);
  const resueltas = hojas.filter((h) => h.resuelta);

  return (
    <section className="bg-card mb-6 space-y-4 rounded-xl border p-6 shadow-sm">
      <div>
        <h2 className="font-display text-lg font-semibold">Hojas sin clasificar</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          No se pudo identificar el cuadernillo de estas hojas por su QR. Elige el cuadernillo y el
          estudiante para calificarlas.
        </p>
      </div>

      {pendientes.length > 0 && (
        <ul className="divide-y">
          {pendientes.map((h) => (
            <FilaSinClasificar
              key={h.id}
              batchId={batchId}
              hoja={h}
              cuadernillos={cuadernillos}
              cuadernilloPorDefecto={cuadernilloPorDefecto}
              estudiantes={estudiantes}
              cargarEstudiantes={cargarEstudiantes}
            />
          ))}
        </ul>
      )}

      {resueltas.length > 0 && (
        <ul className="text-muted-foreground space-y-1 text-sm">
          {resueltas.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-2">
              <span className="text-foreground font-medium">{h.nombre}</span>
              {h.resuelta!.sinEncolar ? (
                <span className="text-red-700">
                  La hoja se creó pero no se pudo encolar. Ábrela y usa Reprocesar.
                </span>
              ) : (
                <span>
                  Calificada: {h.resuelta!.estudiante} · {h.resuelta!.cuadernillo}
                </span>
              )}
              {h.resuelta!.sheetId && h.resuelta!.batchId && (
                <Link
                  href={`/teacher/scan/${h.resuelta!.batchId}/${h.resuelta!.sheetId}`}
                  className="text-primary font-medium hover:underline"
                >
                  Ver hoja
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaSinClasificar({
  batchId,
  hoja,
  cuadernillos,
  cuadernilloPorDefecto,
  estudiantes,
  cargarEstudiantes,
}: {
  batchId: string;
  hoja: HojaSinClasificarRow;
  cuadernillos: { id: string; name: string }[];
  cuadernilloPorDefecto: string;
  estudiantes: Record<string, StudentOption[]>;
  cargarEstudiantes: (bundleId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [bundleId, setBundleId] = useState(cuadernilloPorDefecto);
  const [studentId, setStudentId] = useState("");
  const [cargando, setCargando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otraHoja, setOtraHoja] = useState<{ id: string; batchId: string } | null>(null);

  const lista = bundleId ? estudiantes[bundleId] : undefined;
  const imagen = `/api/scans/sin-clasificar/${hoja.id}`;

  async function onCuadernillo(id: string) {
    setBundleId(id);
    setStudentId("");
    setError(null);
    setOtraHoja(null);
    if (!id || estudiantes[id]) return;
    setCargando(true);
    try {
      await cargarEstudiantes(id);
    } finally {
      setCargando(false);
    }
  }

  async function onCalificar() {
    if (!bundleId || !studentId || saving) return;
    setSaving(true);
    setError(null);
    setOtraHoja(null);
    try {
      const result = await clasificarHojaAction({
        batchId,
        unclassifiedScanId: hoja.id,
        bundleId,
        studentId,
      });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
        if (result.otraHoja) setOtraHoja(result.otraHoja);
      }
    } catch {
      // Red caída o error del servidor: no se sabe si alcanzó a clasificarse.
      // Repintar muestra el estado real (pendiente o ya calificada) en vez de
      // dejar el botón trabado en "Calificando…".
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-wrap gap-4 py-4 first:pt-0 last:pb-0">
      <a href={imagen} target="_blank" rel="noopener noreferrer" className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imagen}
          alt={hoja.nombre}
          loading="lazy"
          className="bg-muted h-40 w-28 rounded border object-cover object-top"
        />
      </a>
      <div className="min-w-0 flex-1 space-y-3 text-sm">
        <div>
          <p className="truncate font-medium">{hoja.nombre}</p>
          <p className="text-muted-foreground text-xs">{hoja.motivo}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs font-medium">Cuadernillo</span>
            <select
              value={bundleId}
              onChange={(e) => void onCuadernillo(e.target.value)}
              disabled={saving}
              className="bg-background min-w-56 rounded border px-2 py-1 text-sm"
            >
              <option value="">Selecciona…</option>
              {cuadernillos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs font-medium">Estudiante</span>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              disabled={saving || cargando || !bundleId}
              className="bg-background min-w-72 rounded border px-2 py-1 text-sm"
            >
              <option value="">Selecciona…</option>
              {(lista ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.groupName} — {s.code}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onCalificar}
            disabled={!bundleId || !studentId || saving}
            className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Calificando…" : "Calificar"}
          </button>
        </div>
        {bundleId && lista && lista.length === 0 && (
          <p className="text-xs text-amber-700">El cuadernillo no tiene estudiantes activos.</p>
        )}
        {error && (
          <p className="text-xs text-red-700">
            {error}
            {otraHoja ? (
              <>
                {" "}
                <Link
                  href={`/teacher/scan/${otraHoja.batchId}/${otraHoja.id}`}
                  className="underline underline-offset-2"
                >
                  Ver esa hoja
                </Link>
              </>
            ) : null}
          </p>
        )}
      </div>
    </li>
  );
}
