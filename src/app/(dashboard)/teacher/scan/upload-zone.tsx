"use client";

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createScanBatchAction, type ScanTargetKind } from "./actions";

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className="text-primary-foreground inline-flex h-10 items-center justify-center rounded-lg bg-black px-6 text-sm font-medium transition-colors hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Subiendo…" : `Subir y escanear (${count} hoja${count !== 1 ? "s" : ""})`}
    </button>
  );
}

/** Objetivo del escaneo: formulación individual o cuadernillo. */
export type ScanTarget =
  { kind: "evaluation"; id: string; title: string } | { kind: "bundle"; id: string; title: string };

interface UploadZoneProps {
  /** Lista mixta de formulaciones + cuadernillos a mostrar en el selector. */
  targets: ScanTarget[];
}

export function UploadZone({ targets }: UploadZoneProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // `selected` = `${kind}:${id}` para que un bundle y una formulación con
  // el mismo id nunca colisionen en el <select>.
  const grouped = useMemo(() => {
    const evaluations = targets.filter(
      (t): t is Extract<ScanTarget, { kind: "evaluation" }> => t.kind === "evaluation",
    );
    const bundles = targets.filter(
      (t): t is Extract<ScanTarget, { kind: "bundle" }> => t.kind === "bundle",
    );
    return { evaluations, bundles };
  }, [targets]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (dropped.length > 0) setFiles((prev) => [...prev, ...dropped]);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    setFiles((prev) => [...prev, ...selected]);
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Resolver kind + id a partir del value "kind:id" seleccionado.
  function readSelection(
    form: HTMLFormElement,
  ): { kind: ScanTargetKind | "auto"; id: string } | null {
    const value = (form.elements.namedItem("target") as HTMLSelectElement | null)?.value ?? "";
    const [kind, id] = value.split(":");
    if (!kind || !id) return null;
    return { kind: kind as ScanTargetKind | "auto", id };
  }

  async function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const sel = readSelection(form);
    if (!sel) {
      setMessage({ ok: false, text: "Selecciona una formulación o un cuadernillo." });
      return;
    }
    // Inyectamos kind + id como campos hidden antes de serializar.
    form
      .querySelectorAll<HTMLInputElement>("input[name='kind'],input[name='id']")
      .forEach((el) => el.remove());
    const k = document.createElement("input");
    k.type = "hidden";
    k.name = "kind";
    k.value = sel.kind;
    form.appendChild(k);
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = "id";
    i.value = sel.id;
    form.appendChild(i);

    setMessage(null);
    const formData = new FormData(form);
    const result = await createScanBatchAction(formData);
    if (result.ok) {
      // El modo automático crea varios lotes y puede dejar hojas afuera: el
      // mensaje tiene que decir exactamente qué entró y qué no, o el usuario
      // se queda creyendo que subió 68 hojas cuando entraron 66.
      const lotes = result.lotes;
      const rechazadas = result.rechazadas ?? [];
      if (lotes) {
        const detalle = lotes.map((l) => `${l.cuadernillo}: ${l.hojas}`).join(" · ");
        const sobrantes = rechazadas.length
          ? ` · ${rechazadas.length} sin clasificar (${rechazadas
              .map((r) => `${r.nombre}: ${r.motivo}`)
              .join("; ")})`
          : "";
        setMessage({
          ok: rechazadas.length === 0,
          text: `${lotes.length} lote(s) creado(s) — ${detalle}${sobrantes}`,
        });
      } else {
        setMessage({ ok: true, text: `Lote creado. ${files.length} hoja(s) encolada(s).` });
      }
      setFiles([]);
      form.reset();
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  return (
    <form ref={formRef} onSubmit={onFormSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium">Objetivo del escaneo</label>
        <select
          name="target"
          required
          defaultValue=""
          className="border-input bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-black focus:outline-none"
        >
          <option value="" disabled>
            Seleccionar formulación o cuadernillo…
          </option>
          <option value="auto:auto">Automático — según el QR de cada hoja</option>
          {grouped.evaluations.length > 0 && (
            <optgroup label="Formulaciones">
              {grouped.evaluations.map((t) => (
                <option key={`evaluation:${t.id}`} value={`evaluation:${t.id}`}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          )}
          {grouped.bundles.length > 0 && (
            <optgroup label="Cuadernillos">
              {grouped.bundles.map((t) => (
                <option key={`bundle:${t.id}`} value={`bundle:${t.id}`}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium">Hojas escaneadas</label>
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-muted-foreground/25 mt-1 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm transition-colors hover:border-black/50"
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            name="files"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <svg
            className="text-muted-foreground size-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
            />
          </svg>
          <span className="text-muted-foreground">
            {files.length === 0
              ? "Arrastra imágenes aquí o haz clic para seleccionar"
              : `${files.length} archivo(s) seleccionado(s)`}
          </span>
        </div>
      </div>

      {files.length > 0 && (
        <ul className="divide-border max-h-40 divide-y overflow-y-auto rounded-lg border text-sm">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between px-3 py-2">
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-muted-foreground ml-2 shrink-0 hover:text-red-500"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <SubmitButton count={files.length} />

      {message && (
        <p className={`text-sm ${message.ok ? "text-green-600" : "text-red-500"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
