# Módulo Bundles (compendios multi-evaluación)

Ver [docs/compendios.md](../../docs/compendios.md) para el SPEC completo.

## Capas

```
bundles/
├── domain/
│   ├── bundle.ts              # interfaces Bundle, BundleItem, BundleRepository
│   ├── bundle-status.ts       # máquina DRAFT → READY (puro)
│   ├── bundle-rules.ts        # invariantes puras
│   └── cover-table.ts         # computa la tabla de áreas (puro)
├── application/
│   ├── create-bundle.ts
│   ├── list-bundles.ts
│   ├── get-bundle.ts
│   ├── update-bundle.ts
│   ├── delete-bundle.ts
│   ├── add-evaluation-to-bundle.ts
│   ├── remove-from-bundle.ts
│   ├── reorder-bundle-items.ts
│   ├── update-bundle-theme.ts
│   ├── mark-bundle-ready.ts
│   └── unmark-bundle-ready.ts
└── infrastructure/
    ├── prisma-bundle-repository.ts
    └── container.ts
```

## Convenciones

- El dominio no importa `@prisma/client` (regla ESLint del proyecto).
- Las use cases reciben `AuthenticatedUser` explícito y filtran por `institutionId`.
- Las use cases devuelven `Result<T>` (nunca throw para errores de negocio).
- Las invariantes que no dependen de I/O viven en `domain/bundle-rules.ts`.
