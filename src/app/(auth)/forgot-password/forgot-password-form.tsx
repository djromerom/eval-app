"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  // Tras enviar, mostramos SIEMPRE el mismo mensaje genérico
  // (anti-enumeración): el servidor devuelve 200 ok tanto si el
  // usuario existe como si no. El cliente no recibe info diferencial.
  if (sent) {
    return (
      <div className="mt-6">
        <div className="rounded-lg bg-green-50 px-3.5 py-2.5 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña. Revisá
          tu bandeja (y la carpeta de spam).
        </div>
        <Link
          href="/login"
          className="text-muted-foreground mt-4 block text-center text-xs underline"
        >
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.get("email") }),
      });
      // La respuesta es siempre 200 ok; no inspeccionamos el body.
      setSent(true);
    } catch {
      // Error de red: igual mostramos el mensaje genérico para no
      // filtrar info sobre el estado del servidor.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form action={handleSubmit} className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Correo institucional
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="nombre@institucion.edu.co"
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? "Enviando…" : "Enviar enlace"}
      </Button>
      <Link href="/login" className="text-muted-foreground block text-center text-xs underline">
        Volver a iniciar sesión
      </Link>
    </form>
  );
}
