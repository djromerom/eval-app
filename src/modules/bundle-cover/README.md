# Módulo: bundle-cover

Plantilla de portada del cuadernillo: HTML con variables Mustache + persistencia
de override por bundle + sanitización XSS. Usado por el designer (futuro) y por
`pdf.worker.ts` para generar la primera página del PDF.

## Modelo

- Una **plantilla** es un HTML versionado bajo `eval-app/templates/cover/{key}.html`,
  identificado por una clave `<familia>-v<n>` (ej. `secundaria-v1`).
- Un **bundle** puede tener un **override**: si `EvaluationBundle.coverTemplateBody`
  está seteado en BD, gana sobre el built-in de la misma `coverTemplateKey`.
- La combinación efectiva (built-in u override) se **renderiza** contra un
  contexto Mustache (datos del bundle + institución + sesión + subjects +
  defaults de copy) y se **sanitiza** antes de inyectarse al PDF / iframe.

## Capas

```
src/modules/bundle-cover/
├── domain/
│   └── cover-template.ts              # CoverTemplateKey (brand), state, repository,
│                                      # loader, errores, MIN/MAX bytes
├── application/
│   ├── cover-defaults.ts              # Copy estática institucional (instrucciones,
│   │                                  # prohibido, cómo marcar, etc.)
│   ├── cover-context.ts               # BuildCoverContext (pure) + assembleContext
│   ├── render-cover.ts                # Mustache + DOMPurify (DENY-by-default)
│   ├── preview-cover.ts               # Compone contexto + render (lectura)
│   ├── load-cover-designer.ts         # Devuelve state + body override + builtin + keys
│   ├── save-cover-template.ts         # Valida bytes + tags prohibidos
│   ├── reset-cover-template.ts        # Limpia el override
│   └── change-cover-template-key.ts   # Cambia variante (secundaria ↔ primaria)
├── infrastructure/
│   ├── prisma-cover-template-repository.ts  # UpdateMany sobre EvaluationBundle
│   ├── fs-cover-template-loader.ts          # Lee templates/cover/*.html con cache
│   └── container.ts                          # makeXxx() para wiring
└── README.md (este archivo)
```

Plantillas versionadas viven en `eval-app/templates/cover/`:

```
templates/
├── cover/
│   ├── secundaria-v1.html             # Paleta gris ICFES, layout 3 filas
│   └── primaria-v1.html               # (futuro) Paleta colorida Wayuu
└── cover/_previews/                   # Mocks con datos literales (no Mustache),
                                       # sólo para iterar diseño sin BD
```

## Casos de uso

| Use case                 | Roles                 | Lectura / Escritura | Notas                                                              |
| ------------------------ | --------------------- | ------------------- | ------------------------------------------------------------------ |
| `PreviewCover`           | ECU_MASTER, ECU_LIDER | Lectura             | Compone contexto + render. Para iframe del designer y para PDF.    |
| `LoadCoverDesigner`      | ECU_MASTER, ECU_LIDER | Lectura             | Devuelve `{state, editorBody, builtinBody, availableKeys}`.        |
| `SaveCoverTemplate`      | ECU_MASTER, ECU_LIDER | Escritura           | Valida 200 ≤ bytes ≤ 200_000 y tags prohibidos antes de persistir. |
| `ResetCoverTemplate`     | ECU_MASTER, ECU_LIDER | Escritura           | `coverTemplateBody = null`. No toca la key.                        |
| `ChangeCoverTemplateKey` | ECU_MASTER, ECU_LIDER | Escritura           | Cambia variante. Valida patrón de key y existencia en FS.          |

Todos reciben un `AuthenticatedUser` explícito y filtran por `institutionId`.

## Seguridad

- **DOMPurify DENY-by-default**: solo se permite la whitelist declarada en
  `render-cover.ts` (HTML5 estructural + CSS embebido + SVG inline). Cualquier
  `<script>`, `<iframe>`, handler `on*=`, URL `javascript:`/`vbscript:`/`file:`
  se elimina silenciosamente.
- **NO usar `KEEP_CONTENT:false`** — esa opción borra TODO el contenido de
  texto (incluso el de los tags permitidos), no solo el de los prohibidos.
  El default de DOMPurify ya borra el contenido de los tags prohibidos.
- Si la sanitización deja el documento vacío, se lanza `UnsafeCoverTemplateError`
  y la UI muestra "contenido bloqueado por seguridad".
- Los overrides guardados pasan además una validación previa (`save-cover-template.ts`)
  para dar feedback inmediato antes de tocar la BD: longitud y patrón de tags
  prohibidos (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`,
  `javascript:`).

## Migración Prisma

```
prisma/migrations/<ts>_bundle_cover_template/migration.sql

ALTER TABLE "EvaluationBundle"
  ADD COLUMN "coverTemplateKey"      VARCHAR(64),
  ADD COLUMN "coverTemplateBody"     TEXT,
  ADD COLUMN "coverTemplateUpdatedAt" TIMESTAMP(3);
```

`coverTemplateKey` nullable: `null` ⇒ cae a `DEFAULT_COVER_TEMPLATE_KEY`
(=`"secundaria-v1"`).

## Variables Mustache disponibles

```
institution.name, institution.logo, institution.legalFooter, institution.primaryColor
bundle.name, bundle.grade, bundle.bookletCode, bundle.periodLabel,
bundle.totalQuestions, bundle.totalTime
session.name, session.labelShort
story.title, story.description, story.illustration  (null = bloque oculto)
{{#subjects}}<li>{{name}}</li>{{/subjects}}         (deduplicados por parent area)
cover.instructions.title, cover.instructions.items[], cover.instructions.itemsAfter[]
cover.callout.text
cover.howToMark.question, cover.howToMark.example, cover.howToMark.exampleLabel,
cover.howToMark.circles[]                          ({{letter}}, {{filled}})
cover.prohibited.title, cover.prohibited.body
```

Para SVG inline (iconos de asignatura), usar la triple llave `{{{...}}}` para
evitar el escape HTML de Mustache.

## Pendiente

- UI `/admin/bundles/[id]/cover-designer` con Monaco editor + selector de
  variante + botón "Subir archivo" + iframe preview.
- Endpoint server-side que envuelva `PreviewCover` y devuelva HTML sanitizado.
- Plantilla `primaria-v1.html` con paleta colorida Wayuu.
- Integración con `pdf.worker.ts` para usar el HTML de la portada como página 1.
