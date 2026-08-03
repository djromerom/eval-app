"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createBookletTypeAction, deleteBookletTypeAction } from "./actions";

interface BookletTypeRow {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Panel de gestión de tipos de cuadernillo dentro del drawer de edición
 * de prueba (Fase 11 — ago 2026).
 *
 * El admin configura desde aquí los tipos disponibles (Estándar, Especial,
 * Recuperación…) que después verá el docente al crear una formulación de
 * esa Prueba. El catálogo es por Prueba, no global.
 *
 * UX:
 * - Lista existente con botón eliminar (inline, confirmación con
 *   `window.confirm` igual que `PeriodEditForm`).
 * - Form inline para agregar; muestra error de validación/conflicto.
 * - Lockout anti-doble-submit con `useTransition`.
 */
export function BookletTypesManager({
  periodId,
  initialTypes,
}: {
  periodId: string;
  initialTypes: BookletTypeRow[];
}) {
  const [types, setTypes] = useState<BookletTypeRow[]>(initialTypes);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createBookletTypeAction(periodId, formData);
      if (!r.ok) {
        setError({ message: r.error ?? "Error", field: r.field });
        return;
      }
      // Optimista: lo agregamos a la lista local. El server action ya
      // disparó revalidatePath, así que en el próximo refresh server
      // llegaría la versión canónica.
      setTypes((prev) => [
        ...prev,
        {
          id: `tmp-${Date.now()}`,
          name: name.trim(),
          description: description.trim() || null,
        },
      ]);
      setName("");
      setDescription("");
    });
  };

  const handleDelete = (id: string, n: string) => {
    if (
      !window.confirm(
        `¿Eliminar el tipo "${n}"? Las evaluaciones que lo usen quedarán sin tipo asignado.`,
      )
    ) {
      return;
    }
    setDeletingId(id);
    startTransition(async () => {
      const r = await deleteBookletTypeAction(periodId, id);
      setDeletingId(null);
      if (!r.ok) {
        setError({ message: r.error ?? "Error" });
        return;
      }
      setTypes((prev) => prev.filter((t) => t.id !== id));
    });
  };

  return (
    <section className="mt-8 border-t pt-6">
      <header className="mb-4 space-y-1">
        <h2 className="font-display text-base font-bold">Tipos de cuadernillo</h2>
        <p className="text-muted-foreground text-xs">
          Catálogo de tipos disponibles para esta prueba (ej. Estándar, Especial). El docente los
          verá al crear una formulación.
        </p>
      </header>

      <form onSubmit={handleCreate} className="space-y-3">
        <div>
          <label htmlFor="booklet-name" className="mb-1 block text-sm font-medium">
            Nombre del tipo
          </label>
          <Input
            id="booklet-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Estándar, Especial, Recuperación"
            maxLength={50}
            required
            disabled={isPending}
          />
        </div>
        <div>
          <label htmlFor="booklet-description" className="mb-1 block text-sm font-medium">
            Descripción (opcional)
          </label>
          <Input
            id="booklet-description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Para todos los estudiantes / Solo NEE / …"
            disabled={isPending}
          />
        </div>
        {error && error.field === "name" && (
          <p className="text-destructive text-xs" role="alert">
            {error.message}
          </p>
        )}
        <Button type="submit" size="sm" disabled={isPending || !name.trim()} className="w-full">
          {isPending ? "Agregando…" : "Agregar tipo"}
        </Button>
      </form>

      {types.length > 0 && (
        <ul className="mt-5 space-y-2">
          {types.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name}</p>
                {t.description && (
                  <p className="text-muted-foreground truncate text-xs">{t.description}</p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleDelete(t.id, t.name)}
                disabled={isPending || deletingId === t.id}
                aria-label={`Eliminar tipo ${t.name}`}
              >
                Eliminar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && error.field !== "name" && (
        <p className="text-destructive mt-3 text-xs" role="alert">
          {error.message}
        </p>
      )}
    </section>
  );
}
