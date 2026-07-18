import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ServerActionRecovery } from "@/components/server-action-recovery";

export const metadata: Metadata = {
  title: {
    default: "Eval — Evaluaciones tipo ICFES",
    template: "%s | Eval",
  },
  description:
    "Plataforma multi-institucional para diseñar, imprimir y calificar automáticamente evaluaciones tipo ICFES",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ServerActionRecovery />
        {children}
      </body>
    </html>
  );
}
