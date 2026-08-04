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
      // Build output de los workers (compilado por `tsc` para producción).
      // Trackeado en .gitignore pero eslint a veces lo pisa igual.
      "dist-workers/**",
      // Archivo generado por Next.js (referencias triple-slash a tipos internos).
      "next-env.d.ts",
      // Motor ICFES embebido — código de terceros adaptado in-house con sus
      // propias convenciones (incluye `as any` para casts a tipos del SDK
      // Anthropic que no queremos defender contra el lint del repo). Si en
      // el futuro se quiere endurecer, mejor primero tipar el SDK con
      // declaraciones locales que meter disables por línea.
      "src/lib/saber-extractor/**",
    ],
  },
  {
    rules: {
      // Permite parámetros/variables intencionalmente sin usar con prefijo "_".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
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
      // E2E y globalSetup necesitan Prisma para sembrar/verificar fixtures.
      "tests/e2e/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
