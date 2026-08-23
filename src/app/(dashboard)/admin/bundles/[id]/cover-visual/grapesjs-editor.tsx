"use client";

/**
 * Componente client: monta el editor GrapesJS en un div.
 * =======================================================
 *
 * El módulo `grapesjs-config.ts` importa `grapesjs` directamente (browser-
 * only — manipula DOM). Por eso este archivo es `"use client"` y se carga
 * vía `dynamic({ ssr: false })` en `cover-visual-form.tsx`. Nunca llega al
 * server bundle.
 *
 * ## Lifecycle
 *
 *   1. Mount → `useEffect` crea el editor dentro del div ref.
 *   2. Cada cambio interno del editor → callback `onProjectChange` con
 *      `editor.getProjectData()`.
 *   3. Unmount → `editor.destroy()` para limpiar listeners y DOM.
 *
 * ## Throttle del onChange
 *
 * GrapesJS dispara `component:update`, `style:update`, etc.频繁 — no
 * queremos serializar en cada keystroke. Hacemos un debounce de 400ms
 * (suficiente para batch de edición continua sin saturar al padre).
 */
import { useEffect, useRef } from "react";
import { initEditor } from "./grapesjs-config";

export interface GrapesJSEditorProps {
  /** Proyecto persistido (o null para empezar con los 6 studio blocks
   *  en orden vertical — `seedDefaultProject` en grapesjs-config). */
  initialProject: unknown | null;
  /** Callback debounced (400ms) con el JSON serializado del proyecto. */
  onChange: (project: unknown) => void;
  /** Altura del canvas. Default 800px. */
  height?: string;
}

export default function GrapesJSEditor({ initialProject, onChange, height }: GrapesJSEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<{ destroy: () => void } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const onChangeDebounced = (project: unknown) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onChange(project), 400);
    };

    const editor = initEditor({
      container: containerRef.current,
      initialProject,
      onChange: onChangeDebounced,
      height,
    });

    editorRef.current = editor;

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // `destroy` existe en el editor GrapesJS — tipamos como unknown para
      // no importar el tipo completo (es browser-only).
      try {
        const e = editor as unknown as { destroy?: () => void };
        e.destroy?.();
      } catch (err) {
        console.warn("[GrapesJSEditor] destroy falló:", err);
      }
      editorRef.current = null;
    };
    // Intencionalmente solo en mount: el initialProject puede cambiar si el
    // docente navega a otro bundle, pero eso requiere un remount completo
    // (key={bundleId} en el padre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="grapesjs-editor-container"
      className="border-input rounded-md border bg-white"
      style={{ minHeight: height ?? "800px" }}
    />
  );
}
