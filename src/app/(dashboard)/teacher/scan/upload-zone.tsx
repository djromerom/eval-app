"use client";

import { useState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { createScanBatchAction } from "./actions";

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

interface UploadZoneProps {
  evaluations: { id: string; title: string }[];
}

export function UploadZone({ evaluations }: UploadZoneProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const result = await createScanBatchAction(formData);
    if (result.ok) {
      setMessage({ ok: true, text: `Lote creado. ${files.length} hoja(s) encolada(s).` });
      setFiles([]);
      form.reset();
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium">Evaluación</label>
        <select
          name="evaluationId"
          required
          className="border-input bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-black focus:outline-none"
        >
          <option value="">Seleccionar evaluación…</option>
          {evaluations.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
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
