"use client";

import dynamic from "next/dynamic";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { type CoverDesignerData } from "@/modules/bundle-cover/application/load-cover-designer";
import type {
  CoverContent,
  ResolvedCoverContent,
} from "@/modules/bundle-cover/domain/cover-content";
import type { ExtractedFields } from "@/modules/bundle-cover/domain/template-fields";
import type { CoverTemplateKey } from "@/modules/bundle-cover/domain/cover-template";
import type { EvaluationTheme, ResolvedTheme } from "@/modules/theme/domain/theme";
import {
  changeCoverTemplateKeyAction,
  resetCoverTemplateAction,
  saveCoverTemplateAction,
  type CoverDesignerFormState,
} from "./actions";
import { BundleCoverContentSection } from "./bundle-cover-content-section";
import { BundleThemeSection } from "./bundle-theme-section";

// Monaco usa workers/window — no se puede SSR. Carga perezosa.
const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground flex h-[500px] items-center justify-center rounded border bg-white text-sm">
      Cargando editor…
    </div>
  ),
});

interface Props {
  bundleId: string;
  bundleName: string;
  initial: CoverDesignerData;
  previewHtml: string;
  initialTheme: Partial<EvaluationTheme>;
  resolvedTheme: ResolvedTheme;
  /** Override de coverContent del compendio (puede ser {}). PR 4. */
  initialCoverContent: Partial<CoverContent>;
  /** coverContent colapsado bundle ⊕ institucional ⊕ DEFAULT. PR 4. */
  resolvedCoverContent: ResolvedCoverContent;
  /** Campos del schema que la plantilla activa referencia. PR 5: la sección
   *  "Contenido de portada" genera inputs solo para esos campos. */
  coverContentFields: ExtractedFields;
  editable: boolean;
}

/**
 * Form completo del diseñador de portada.
 *
 * Layout 2 columnas (xl+):
 * - Izquierda (420px): form de variante + form de editor (separados, HTML
 *   invalida forms anidadas).
 * - Derecha (1fr): iframe con la portada renderizada por el pipeline real
 *   (Mustache + DOMPurify). El preview se recalcula server-side: cualquier
 *   cambio en `body` o `key` requiere Guardar + recarga para verse.
 *
 * Edición del HTML: el body vive en estado local del cliente; el servidor
 * recibe el contenido vía un `<input type="hidden">` sincronizado con
 * `body` cada vez que cambia. El editor TipTap no aplica aquí porque
 * TipTap no maneja HTML crudo con Mustache.
 *
 * Dirty tracking: comparamos contra `initial.editorBody` (lo que vino del
 * server). Si el docente cambia de variante y tiene cambios sin guardar,
 * el action de variante pregunta antes de submit — el cambio recarga la
 * página y perdería el body en memoria.
 */
export function CoverDesignerForm({
  bundleId,
  bundleName,
  initial,
  previewHtml,
  initialTheme,
  resolvedTheme,
  initialCoverContent,
  resolvedCoverContent,
  coverContentFields,
  editable,
}: Props) {
  const [body, setBody] = useState(initial.editorBody);
  const dirty = body !== initial.editorBody;

  // Si el server cambió initial.editorBody (ej. tras un Guardar), sincronizamos
  // el estado local para que el dirty indicator se limpie y el editor refleje
  // la verdad persistida.
  const lastSyncedRef = useRef(initial.editorBody);
  useEffect(() => {
    setBody(initial.editorBody);
    lastSyncedRef.current = initial.editorBody;
  }, [initial.editorBody]);

  const [saveState, saveAction] = useActionState<CoverDesignerFormState, FormData>(
    (prev, fd) => saveCoverTemplateAction(bundleId, prev, fd),
    {},
  );
  const [keyState, keyAction] = useActionState<CoverDesignerFormState, FormData>(
    (prev, fd) => changeCoverTemplateKeyAction(bundleId, prev, fd),
    {},
  );
  const [resetState, resetAction] = useActionState<CoverDesignerFormState, FormData>(
    () => resetCoverTemplateAction(bundleId),
    {},
  );

  const [variantDraft, setVariantDraft] = useState<string>(initial.state.key);
  // Si el server cambió la key (ej. tras un Aplicar variante), sincronizamos.
  useEffect(() => {
    setVariantDraft(initial.state.key);
  }, [initial.state.key]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text === "string") setBody(text);
    };
    reader.readAsText(file);
  };

  // Confirmación antes de cambiar variante si hay cambios sin guardar.
  const guardedKeyAction = (formData: FormData) => {
    if (dirty) {
      const ok = window.confirm(
        "Tienes cambios sin guardar en el editor. Si cambias la variante se perderán. ¿Continuar?",
      );
      if (!ok) return;
    }
    keyAction(formData);
  };

  const sizeKb = useMemo(() => Math.round(new Blob([body]).size / 1024), [body]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/admin/bundles/${bundleId}`} className="text-muted-foreground hover:underline">
          ← Volver al cuadernillo
        </Link>
        <Link
          href={`/print/bundle/${bundleId}`}
          target="_blank"
          className="text-muted-foreground hover:underline"
        >
          Abrir cuadernillo en pestaña nueva ↗
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <SourceBadge source={initial.state.source} />
          <span className="bg-muted rounded-md px-2 py-0.5 font-mono text-xs">
            {initial.state.key}
          </span>
          {initial.state.updatedAt ? (
            <span className="text-muted-foreground text-xs">
              Override guardado:{" "}
              {initial.state.updatedAt.toLocaleDateString("es-CO", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        {/* ===== Columna izquierda: forms ===== */}
        <div className="space-y-4">
          {/* Form 1: variante */}
          <form action={guardedKeyAction} className="bg-card space-y-3 rounded-xl border p-5">
            <div>
              <h2 className="font-semibold">Variante de plantilla</h2>
              <p className="text-muted-foreground text-xs">
                Cambia el punto de partida del HTML. Tu override actual (si lo hay) NO se borra al
                cambiar de variante.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Plantilla</span>
              <select
                name="key"
                value={variantDraft}
                onChange={(e) => setVariantDraft(e.target.value)}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {initial.availableKeys.map((k: CoverTemplateKey) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            {keyState.error ? <p className="text-destructive text-sm">{keyState.error}</p> : null}

            <ApplyVariantButton />
          </form>

          {/* Form 2: editor */}
          <form action={saveAction} className="bg-card space-y-3 rounded-xl border p-5">
            <div>
              <h2 className="font-semibold">HTML de la portada</h2>
              <p className="text-muted-foreground text-xs">
                Edita el HTML renderizado por Mustache. Soporta <code>{`{{bundle.name}}`}</code>,{" "}
                <code>{`{{institution.name}}`}</code> y <code>{`{{areas}}`}</code>. El servidor
                sanitiza el contenido antes de guardarlo (sin scripts ni iframes).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,text/html"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  // Permitir volver a seleccionar el mismo archivo
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Subir .html
              </Button>
              <span className="text-muted-foreground ml-auto text-xs">
                {sizeKb} KB
                {dirty ? (
                  <span className="ml-2 font-medium text-amber-700">· Cambios sin guardar</span>
                ) : null}
              </span>
            </div>

            <MonacoEditor
              height="500px"
              defaultLanguage="html"
              value={body}
              onChange={(v) => setBody(v ?? "")}
              theme="vs"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />

            <input type="hidden" name="body" value={body} />

            {saveState.error ? <p className="text-destructive text-sm">{saveState.error}</p> : null}
            {saveState.success ? (
              <p className="text-success text-sm">Portada guardada. Vista previa actualizada.</p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <SaveButton disabled={!dirty} />
            </div>
          </form>

          {/* Form 2.5: tema del cuadernillo — separado, no se puede anidar */}
          <BundleThemeSection
            bundleId={bundleId}
            initial={initialTheme}
            resolved={resolvedTheme}
            editable={editable}
          />

          {/* Form 2.6: contenido de portada — separado, no se puede anidar */}
          <BundleCoverContentSection
            bundleId={bundleId}
            initial={initialCoverContent}
            resolved={resolvedCoverContent}
            editable={editable}
            fields={coverContentFields}
          />

          {/* Form 3: reset — separado, no se puede anidar */}
          <form action={resetAction} className="bg-card space-y-3 rounded-xl border p-5">
            <div>
              <h2 className="font-semibold">Restablecer</h2>
              <p className="text-muted-foreground text-xs">
                Borra tu override de HTML y vuelve al built-in de la variante{" "}
                <span className="font-mono">{initial.state.key}</span>.
              </p>
            </div>
            {resetState.error ? (
              <p className="text-destructive text-sm">{resetState.error}</p>
            ) : null}
            {resetState.success ? (
              <p className="text-success text-sm">Override eliminado.</p>
            ) : null}
            <Button type="submit" variant="outline" disabled={initial.state.source !== "OVERRIDE"}>
              Restablecer built-in
            </Button>
          </form>

          <div className="text-muted-foreground text-xs">
            Cuadernillo: <strong>{bundleName}</strong>
          </div>
        </div>

        {/* ===== Columna derecha: preview iframe ===== */}
        <div className="bg-muted/30 rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Vista previa de la portada</h3>
            <span className="text-muted-foreground text-xs">
              Renderizada con Mustache + DOMPurify · fuente: {initial.state.source}
            </span>
          </div>
          <iframe
            title="Vista previa de la portada del cuadernillo"
            srcDoc={previewHtml}
            className="h-[1400px] w-full rounded border bg-white"
            sandbox=""
          />
        </div>
      </div>
    </>
  );
}

function SourceBadge({ source }: { source: "BUILT_IN" | "OVERRIDE" }) {
  const isOverride = source === "OVERRIDE";
  const label = isOverride ? "OVERRIDE" : "Built-in";
  const className = isOverride
    ? "bg-amber-100 text-amber-900 border-amber-200"
    : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function ApplyVariantButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? "Aplicando…" : "Aplicar variante"}
    </Button>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Guardando…" : "Guardar cambios"}
    </Button>
  );
}
