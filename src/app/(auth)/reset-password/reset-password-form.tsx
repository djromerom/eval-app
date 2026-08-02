"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);

    const password = formData.get("password") as string;
    const passwordConfirm = formData.get("passwordConfirm") as string;

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, passwordConfirm }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Error al restablecer la contraseña.");
        return;
      }
      router.push("/login?success=password-reset");
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form action={handleSubmit} className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Nueva contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="passwordConfirm" className="text-sm font-medium">
          Confirmar contraseña
        </label>
        <input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Guardando…" : "Guardar contraseña"}
      </Button>
    </form>
  );
}
