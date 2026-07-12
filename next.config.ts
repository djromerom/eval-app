import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Despliegue en VPS con PM2: build autocontenido (ver REQUERIMIENTOS_v2.md §9)
  output: "standalone",
  // Este proyecto es la raíz para el trazado de archivos del standalone; evita
  // que Next infiera un root equivocado por lockfiles de carpetas superiores.
  outputFileTracingRoot: import.meta.dirname,
  // sharp y bullmq son dependencias nativas/de servidor, no deben empaquetarse
  serverExternalPackages: ["sharp", "bullmq", "ioredis", "pino"],
};

export default nextConfig;
