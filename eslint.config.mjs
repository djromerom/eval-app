import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "playwright-report/**",
      // Archivo generado por Next.js (referencias triple-slash a tipos internos).
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // La regla de la arquitectura: el dominio no importa infraestructura.
      // (Se puede endurecer con eslint-plugin-boundaries cuando crezca el proyecto.)
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/client"],
              message:
                "No importes Prisma en capas domain/application. Usa las interfaces de repositorio del dominio.",
            },
          ],
        },
      ],
    },
  },
  {
    // La infraestructura y la capa de presentación sí pueden usar Prisma
    files: [
      "src/modules/**/infrastructure/**",
      "src/shared/infrastructure/**",
      "src/app/**",
      "src/auth.ts",
      "prisma/**",
      "workers/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
