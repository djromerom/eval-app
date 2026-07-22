import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Texto secundario opcional bajo el valor (tendencia, contexto). */
  hint?: ReactNode;
  /** Tono del hint. */
  hintTone?: "muted" | "success" | "warning" | "danger";
  /** Variante de marca (fondo tinte azul). */
  accent?: boolean;
  className?: string;
}

const HINT_TONE: Record<NonNullable<StatCardProps["hintTone"]>, string> = {
  muted: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

/** Tarjeta de KPI del dashboard (identidad ecognIA). Presentacional. */
export function StatCard({
  label,
  value,
  hint,
  hintTone = "muted",
  accent = false,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 shadow-sm",
        accent ? "bg-brand-blue-tint border-transparent" : "bg-card border-border",
        className,
      )}
    >
      <p
        className={cn(
          "text-xs font-medium tracking-wide uppercase",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "font-display mt-1.5 text-2xl font-bold",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint ? <p className={cn("mt-1 text-xs font-medium", HINT_TONE[hintTone])}>{hint}</p> : null}
    </div>
  );
}
