"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type InstitutionalTheme,
  THEME_PRESETS,
  FONT_FAMILY_LABELS,
  FONT_FAMILIES,
  DENSITY_LABELS,
  DENSITIES,
} from "@/modules/theme/domain/theme";
import { applyPresetAction, saveThemeAction, type ThemeFormState } from "./actions";

interface Props {
  initial: Partial<InstitutionalTheme>;
  logoUrl: string | null;
  /** Ruta cruda persistida en BD (para el DELETE). */
  logoPath: string | null;
}

/**
 * Formulario del tema institucional.
 *
 * - useActionState para el form principal (save) y los presets.
 * - Logo: fetch a /api/theme/logo (POST/DELETE) porque los server actions
 *   con FormData no manejan File con preview-friendly UX sin round-trips.
 */
export function ThemeForm({ initial, logoUrl, logoPath }: Props) {
  const [state, formAction] = useActionState<ThemeFormState, FormData>(saveThemeAction, {});
  const [primary, setPrimary] = useState(initial.primary ?? "#0B5C2E");
  const [fontFamily, setFontFamily] = useState(initial.fontFamily ?? "serif");
  const [density, setDensity] = useState(initial.density ?? "normal");
  const [footerText, setFooterText] = useState(initial.footerText ?? "");
  const [showLogo, setShowLogo] = useState(initial.showLogo ?? true);
  const [presetState, setPresetState] = useState<{
    preset: string;
    ok?: boolean;
    error?: string;
  } | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoOk, setLogoOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.error) setLogoError(null);
  }, [state]);

  async function applyPreset(preset: string) {
    const res = await applyPresetAction(preset);
    if ("error" in res && res.error) {
      setPresetState({ preset, error: res.error });
    } else {
      setPresetState({ preset, ok: true });
    }
  }

  async function onLogoChange(file: File) {
    setLogoError(null);
    setLogoOk(false);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/theme/logo", { method: "POST", body: fd });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setLogoError(data?.error ?? `Error al subir (HTTP ${res.status}).`);
      return;
    }
    setLogoOk(true);
    // reload para reflejar el nuevo logo en la preview
    window.location.reload();
  }

  async function onLogoDelete() {
    const res = await fetch("/api/theme/logo", { method: "DELETE" });
    if (!res.ok) {
      setLogoError("No se pudo eliminar el logo.");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        {/* Presets */}
        <section className="bg-card space-y-3 rounded-xl border p-5">
          <div>
            <h2 className="font-semibold">Presets</h2>
            <p className="text-muted-foreground text-sm">
              Aplica una combinación de tema en 1 click.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(THEME_PRESETS).map(([key, p]) => (
              <Button key={key} type="button" variant="outline" onClick={() => applyPreset(key)}>
                {p.label}
              </Button>
            ))}
          </div>
          {presetState?.ok ? (
            <p className="text-success text-sm">
              Aplicado: {THEME_PRESETS[presetState.preset]?.label}.
            </p>
          ) : null}
          {presetState?.error ? (
            <p className="text-destructive text-sm">{presetState.error}</p>
          ) : null}
        </section>

        {/* Form principal */}
        <form action={formAction} className="bg-card space-y-5 rounded-xl border p-5">
          <h2 className="font-semibold">Tema institucional</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Color primario</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="primary"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded border"
                  aria-label="Selector de color primario"
                />
                <Input
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  pattern="#[0-9a-fA-F]{6}"
                  maxLength={7}
                  className="w-32"
                />
              </div>
              <p className="text-muted-foreground text-xs">Acentos institucionales, encabezados.</p>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Tipografía</span>
              <select
                name="fontFamily"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {FONT_FAMILY_LABELS[f]}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">Serif = PDF de referencia.</p>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Densidad</span>
              <select
                name="density"
                value={density}
                onChange={(e) => setDensity(e.target.value as typeof density)}
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              >
                {DENSITIES.map((d) => (
                  <option key={d} value={d}>
                    {DENSITY_LABELS[d]}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">Compacta ahorra papel.</p>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Pie de página</span>
              <Input
                name="footerText"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="I.E. … · Resolución 12345 · 2026"
                maxLength={200}
              />
              <p className="text-muted-foreground text-xs">Hasta 200 caracteres.</p>
            </label>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="showLogo"
              checked={showLogo}
              onChange={(e) => setShowLogo(e.target.checked)}
              className="accent-primary h-4 w-4"
            />
            <span className="text-sm">Mostrar logo del colegio en la portada</span>
          </label>

          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          {state.success ? <p className="text-success text-sm">Tema guardado.</p> : null}

          <SubmitButton />
        </form>

        {/* Logo */}
        <section className="bg-card space-y-4 rounded-xl border p-5">
          <div>
            <h2 className="font-semibold">Logo del colegio</h2>
            <p className="text-muted-foreground text-sm">PNG o JPG, máximo 2 MB.</p>
          </div>

          <div className="flex items-start gap-4">
            <div className="bg-muted flex h-24 w-40 items-center justify-center overflow-hidden rounded border">
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoUrl} alt="Logo actual" className="max-h-full max-w-full" />
              ) : (
                <span className="text-muted-foreground text-xs">Sin logo</span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onLogoChange(f);
                }}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                {logoPath ? "Reemplazar" : "Subir logo"}
              </Button>
              {logoPath ? (
                <Button type="button" variant="ghost" onClick={onLogoDelete}>
                  Quitar logo
                </Button>
              ) : null}
              {logoError ? <p className="text-destructive text-sm">{logoError}</p> : null}
              {logoOk ? <p className="text-success text-sm">Logo actualizado.</p> : null}
            </div>
          </div>
        </section>
      </div>

      {/* Sidebar de preview embebida (siguiente fase: iframe real) */}
      <aside className="bg-muted/40 hidden self-start rounded-xl border p-5 lg:block">
        <h3 className="text-sm font-semibold">Vista previa</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Los cambios se aplican en la próxima impresión del cuadernillo (
          <a className="underline" href="/teacher/evaluations" target="_blank">
            ir a evaluaciones
          </a>
          ).
        </p>
        <div
          className="mt-4 rounded border bg-white p-4 text-xs"
          style={
            {
              color: "#000",
              fontFamily:
                fontFamily === "serif"
                  ? "'Liberation Serif', Times, serif"
                  : "'Liberation Sans', Arial, sans-serif",
              lineHeight: density === "compact" ? 1.05 : density === "airy" ? 1.4 : 1.2,
            } as React.CSSProperties
          }
        >
          <p className="text-center text-sm font-bold uppercase" style={{ color: primary }}>
            I.E. Colegio Demo
          </p>
          <p className="mt-2 text-center text-xs font-bold">Prueba de Matemáticas — 11°</p>
          <p className="mt-3 text-xs">1. ¿Cuál es el resultado de 2 + 2?</p>
          <p className="ml-2 text-xs">A. 3</p>
          <p className="ml-2 text-xs">B. 4</p>
          <p className="ml-2 text-xs">C. 5</p>
          <p className="ml-2 text-xs">D. 6</p>
          {footerText ? (
            <p className="mt-4 border-t pt-1 text-center text-[10px] text-gray-500">{footerText}</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Guardando…" : "Guardar tema"}
    </Button>
  );
}
