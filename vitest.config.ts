import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    server: {
      // Forzamos a Vitest a procesar (transformar) next-auth en lugar de
      // dejar que Node lo resuelva con require/import nativo. Sin esto,
      // next-auth@5.0.0-beta.29 hace `require('next/server')` (sin `.js`)
      // desde dentro del pnpm symlink y el resolver nativo falla porque
      // Node no respeta el `exports` map de next@15 en CJS. Los aliases
      // de `resolve` no se aplican a módulos dentro de node_modules/.pnpm.
      deps: {
        inline: [/next-auth/, /^@auth\//],
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // JSX con runtime automático (React 17+), igual que compila Next: los
  // componentes se renderizan sin `React` en scope. Lo necesitan los tests que
  // renderizan componentes con `react-dom/server`.
  esbuild: {
    jsx: "automatic",
  },
});
