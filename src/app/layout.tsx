import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ServerActionRecovery } from "@/components/server-action-recovery";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ecognIA — Evaluaciones inteligentes tipo ICFES",
    template: "%s | ecognIA",
  },
  description:
    "Plataforma multi-institucional para diseñar, imprimir y calificar automáticamente evaluaciones tipo ICFES con reconocimiento OMR + IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${sora.variable}`} suppressHydrationWarning>
      {/*
       * `suppressHydrationWarning` también en <body> — algunas extensiones
       * del navegador (CommandersAct / CZ Shortcuts, ColorZilla, etc.)
       * inyectan atributos en `<body>` antes de que React hidrate
       * (`cz-shortcut-listen="true"`, `data-new-gr-c-s-check-loaded`, etc.)
       * y eso dispara un React hydration error. Con este flag, React
       * ignora SOLO los cambios de atributos en <body> y mantiene el árbol
       * de componentes intacto. No afecta contenido.
       */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <ServerActionRecovery />
        {children}
      </body>
    </html>
  );
}
