import type { Metadata } from "next";
import "./globals.css";

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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
