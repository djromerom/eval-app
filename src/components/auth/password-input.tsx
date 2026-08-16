"use client";

import { useState, type ComponentPropsWithoutRef } from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Subset of `<input>` props que un campo de contraseña necesita exponer al
 * caller. Tipamos explícitamente lo que aceptamos para que el componente
 * tenga un contrato claro (sin heredar `onChange`, `value`, `ref`, etc. que
 * el caller no usa hoy y que mañana serían fuente de bugs si los agrega).
 */
type InputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "onChange" | "value" | "defaultValue"
>;

export interface PasswordInputProps extends InputProps {
  /** Estado inicial del toggle. Ago 2026 — convención occidental: arranca
   *  OCULTA (`type="password"`). El ojito se muestra como `Eye` indicando
   *  que el siguiente click MUESTRA el campo. Click → `type="text"` +
   *  `EyeOff` + `aria-label="Ocultar contraseña"`. Default: `false`. */
  defaultVisible?: boolean;
}

/**
 * `<PasswordInput>` — input de contraseña con ojito para mostrar/ocultar.
 *
 * Ago 2026 — pedido del docente: implementar el toggle de visibilidad en
 * el campo de contraseña. Decisiones:
 * - **Estado inicial**: arranca OCULTA (`type="password"`). El ojito se
 *   muestra como `Eye` indicando que el siguiente click MUESTRA el
 *   campo. Click → `type="text"` + `EyeOff` + `aria-label="Ocultar
 *   contraseña"`. Para invertirlo en otro formulario, pasar
 *   `defaultVisible={true}` al consumirlo.
 * - **Posición del ojito**: derecha (convención occidental).
 * - **Server/Client boundary**: este componente es `"use client"` porque
 *   necesita `useState` para el toggle. Los formularios server (p.ej.
 *   `LoginForm`) lo consumen sin problema — la action `signIn` se sigue
 *   invocando como server action desde el `<form action={...}>`.
 * - **Copy preservada**: el caller pasa `placeholder`, `aria-*`, etc.
 *   verbatim. Este componente NO toca esos textos.
 * - **Padding derecho**: agrega `pr-10` al `className` del input para que
 *   el texto tipeado no se solape con el botón del ojito. Si el caller
 *   pasa su propio `pr-*`, el `cn()` deja que el del caller gane.
 *
 * @example
 *   <PasswordInput
 *     id="password"
 *     name="password"
 *     required
 *     autoComplete="current-password"
 *     placeholder="••••••••••"
 *     className="border-input bg-background …"
 *   />
 */
export function PasswordInput({
  defaultVisible = false,
  className,
  ...inputProps
}: PasswordInputProps) {
  const [visible, setVisible] = useState(defaultVisible);

  return (
    <div className="relative">
      <input
        {...inputProps}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        // h-8 w-8 = 32px, suficiente área clickeable (~24px ícono + padding).
        // top-1/2 -translate-y-1/2 lo centra verticalmente sobre el input.
        // focus-visible:ring-2 + focus-visible:outline-none replica el patrón
        // de foco que usan los inputs del form (focus-visible:ring-ring).
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 h-8 w-8 -translate-y-1/2 cursor-pointer rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        {visible ? (
          <EyeOff className="mx-auto h-4 w-4" aria-hidden />
        ) : (
          <Eye className="mx-auto h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
