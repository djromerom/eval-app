import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Despliegue en VPS con PM2: build autocontenido (ver REQUERIMIENTOS_v2.md §9)
  output: "standalone",
  // Este proyecto es la raíz para el trazado de archivos del standalone; evita
  // que Next infiera un root equivocado por lockfiles de carpetas superiores.
  outputFileTracingRoot: import.meta.dirname,
  // sharp y bullmq son dependencias nativas/de servidor, no deben empaquetarse
  // pdfjs-dist rompe al ser empaquetado por Next (Object.defineProperty en
  // non-object); pdf-parse lo arrastra.
  // jsdom + dompurify: isomorphic-dompurify los importa eager; si Webpack los
  // bundlea, las rutas internas de jsdom (browser/default-stylesheet.css) se
  // rompen porque resuelve desde el project root, no desde node_modules.
  serverExternalPackages: [
    "sharp",
    "bullmq",
    "ioredis",
    "pino",
    "pdfjs-dist",
    "pdf-parse",
    "jsdom",
    "dompurify",
    "isomorphic-dompurify",
  ],
  experimental: {
    // Server Actions 20MB permiten upload de imágenes escaneadas (típico
    // 1-2MB pero dejamos holgura). En Next 15 estable, esto pasa a top-level
    // (`serverActions`); mientras esté en `experimental` evitamos la warning.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
