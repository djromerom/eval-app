# Módulo Compendios (Bundles multi-evaluación)

> **Estado:** ✅ **Sprints 1, 2, 3 y 4 COMPLETADOS** (19 jul 2026). Pendiente: smoke test end-to-end manual (bloqueado por Docker corrupto — ver `docs/smoke-test-compendios.md`).
> **Reemplaza:** ninguno (es módulo nuevo). **Extiende:** `Evaluation`, `AnswerSheet`, `StudentAnswer`, `PrintKind`, `print-token`, `qr-payload`, `process-answer-sheet`.
> **Motivación:** los colegios aplican varias evaluaciones en una sola sesión
> (simulacros ICFES, finales de período). Hoy la app obliga a imprimir y calificar
> cada evaluación por separado. El compendio agrupa N evaluaciones en un solo
> artefacto imprimible y una sola hoja de respuestas.

---

## Glosario

| Término                          | Definición                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bundle / Compendio**           | Agrupación ordenada de N evaluaciones de la misma institución, tratadas como un solo artefacto imprimible. Persistido en `EvaluationBundle`. |
| **Item**                         | Una evaluación dentro de un bundle (`EvaluationBundleItem`). Tiene `order` para controlar el orden de impresión.                             |
| **Bundle unificado**             | Caso N=1 tratado por la misma ruta de código que N>1. No hay flujo paralelo.                                                                 |
| **Hoja de respuestas unificada** | Una sola hoja OMR que cubre todas las evaluaciones del bundle. Numeración continua de preguntas, secciones por evaluación.                   |
| **Estado READY**                 | Bundle "sellado": ya no se puede editar contenido, está listo para imprimir. Equivalente al `PUBLISHED` de una evaluación individual.        |

---

## Decisiones de diseño

| #   | Decisión                                                                 | Razón                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **N=1 usa el flujo bundle** (no ruta paralela)                           | Datos actuales son de prueba, no requieren migración. Una sola ruta de código = menos drift.                                                                                                                                                                                                                                                       |
| 2   | **`EvaluationBundle` es tabla nueva, no ad-hoc**                         | Reutilizable entre períodos ("Simulacro ICFES - Periodo I" anual). Permite clonar, asignar a cursos, regenerar.                                                                                                                                                                                                                                    |
| 3   | **Solo evaluaciones `APPROVED` o `PUBLISHED` pueden entrar a un bundle** | Coherente con el flujo de aprobación. No se imprime lo no aprobado.                                                                                                                                                                                                                                                                                |
| 4   | **Status del bundle: `DRAFT → READY`** (transición unidireccional)       | Mismo modelo mental que `Evaluation.DRAFT → PUBLISHED`.                                                                                                                                                                                                                                                                                            |
| 5   | **Hoja de respuestas SIEMPRE pertenece a un bundle** (incluso N=1)       | Camino canónico. El QR siempre lleva `kind: "bundle"`.                                                                                                                                                                                                                                                                                             |
| 6   | **Numeración de preguntas en hoja unificada es continua**                | 1, 2, 3… global, con un separador visual entre secciones (área + asignatura + bloque).                                                                                                                                                                                                                                                             |
| 7   | **Imposition saddle-stitch sobre TODO el compendio**                     | Reusa el worker PDF existente; el bundle es un `PrintKind` nuevo.                                                                                                                                                                                                                                                                                  |
| 8   | **`StudentAnswer.bundleItemId` es la fuente de verdad**                  | Cada respuesta apunta al item del bundle, que indirectamente apunta a la `evaluationId` y la `questionId`.                                                                                                                                                                                                                                         |
| 9   | **QR con HMAC se mantiene** (no barcode lineal)                          | El colegio controla la impresión (no se falsifica post-impresión); HMAC da audit trail y link directo al detalle. Comparado contra el ejemplo real (CODE128 con `C1G60101`) y contra REQ §3.4 — gana QR.                                                                                                                                           |
| 10  | **`Subject.parentSubjectId` se agrega** (jerarquía de áreas)             | Para que la portada pueda tabular "Ciencias Naturales ⊃ Bio + Fis + Qui = 55 preguntas". El ejemplo real tiene 2 niveles de agrupación; sin `parentSubjectId` no se puede computar la tabla de áreas.                                                                                                                                              |
| 11  | **Preguntas con opciones variables (4 a 8) entran al Sprint 1**          | El ejemplo real mezcla 4 (A-D) y 8 (A-H) opciones en el mismo booklet. `EVAL_MAX_OPTIONS=8` ya está declarado en `.env.example`, `QuestionOption.key` es libre, pero el render de la hoja unificada y el worker OMR deben acomodar anchos de columna variables desde el Sprint 1. Si lo posponemos, el primer colegio que use 8 opciones se rompe. |

---

## Modelo de datos (Prisma)

### Nuevas tablas

```prisma
enum BundleStatus {
  DRAFT  // editable: items, tema, nombre
  READY  // sellado: listo para imprimir; no editable
}

model EvaluationBundle {
  id              String       @id @default(cuid())
  institutionId   String       @db.Uuid
  name            String                              // "Simulacro ICFES - Periodo I"
  bookletNumber   Int?                                // correlativo por institución (opcional)
  status          BundleStatus @default(DRAFT)
  theme           Json?                               // override del tema institucional (mismo shape que Evaluation.theme)
  createdById     String       @db.Uuid
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  institution Institution        @relation(fields: [institutionId], references: [id])
  createdBy   User               @relation(fields: [createdById], references: [id])
  items       EvaluationBundleItem[]
  sheets      AnswerSheet[]

  @@index([institutionId])
  @@unique([institutionId, bookletNumber])   // bookletNumber único si está definido
  @@map("evaluation_bundle")
}

model EvaluationBundleItem {
  id            String @id @default(cuid())
  bundleId      String @db.Uuid
  evaluationId  String @db.Uuid
  order         Int                              // posición en el compendio (1-based)

  bundle     EvaluationBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  evaluation Evaluation      @relation(fields: [evaluationId], references: [id])

  answers StudentAnswer[]

  @@unique([bundleId, evaluationId])             // una eval no se repite en el mismo bundle
  @@unique([bundleId, order])                   // un solo item por posición
  @@index([evaluationId])
  @@map("evaluation_bundle_item")
}
```

### Tabla modificada para soportar tabla de áreas en la portada

```prisma
model Subject {
  // ...campos existentes...
  parentSubjectId String?  @db.Uuid       // ← NUEVO (nullable). Si null → subject de área raíz
  parentSubject   Subject? @relation("SubjectHierarchy", fields: [parentSubjectId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  children        Subject[] @relation("SubjectHierarchy")
  // Si isArea=true, este subject es solo agrupador (no aparece en portada como subject evaluable,
  // sí aparece como fila en la tabla de áreas con la suma de questions de sus hijos).
  isArea          Boolean  @default(false)
  @@index([institutionId, parentSubjectId])
}
```

**Datos de ejemplo** (del caso real grado 6°):

- `Ciencias Naturales` (isArea=true, sin parentSubject)
  - `Biología` (parentSubject = Ciencias Naturales)
  - `Física`
  - `Química`
- `Inglés` (isArea=false, sin parentSubject)
- `Informática` (isArea=false, sin parentSubject)

La portada computa: para cada subject hoja del bundle, agrupar por `parentSubject`, sumar `totalQuestions` y multiplicar por `EVAL_MINUTES_PER_QUESTION` (default 2.5 min, configurable por institución).

### Tablas modificadas (diff contra schema actual)

```prisma
model AnswerSheet {
  // ...campos existentes...
  evaluationId   String?   @db.Uuid             // ← ahora nullable
  bundleId       String?   @db.Uuid             // ← NUEVO (nullable)
  bundle         EvaluationBundle? @relation(fields: [bundleId], references: [id])
  evaluation     Evaluation? @relation(fields: [evaluationId], references: [id])  // ← ahora opcional

  // @@check constraint: exactamente uno de los dos no nulo
  // (Prisma no soporta @@check nativo todavía → validación en código)
}

model StudentAnswer {
  // ...campos existentes...
  bundleItemId   String?   @db.Uuid             // ← NUEVO
  bundleItem     EvaluationBundleItem? @relation(fields: [bundleItemId], references: [id])
  // evaluationId se mantiene como denormalización (FK opcional) para queries rápidas
  // y para no romper data legacy de pruebas anteriores.
}
```

**Reglas de invariante** (validadas en use cases, no en DB):

- `AnswerSheet`: `evaluationId XOR bundleId` exactamente uno no nulo.
- `EvaluationBundleItem`: la `evaluationId` debe pertenecer a la misma `institutionId` del bundle.
- `EvaluationBundleItem.evaluation.status ∈ {APPROVED, PUBLISHED}` al momento de añadir.
- `EvaluationBundle.status = READY` → no se puede modificar `items`, `name`, `theme`, `bookletNumber`. Sí se puede regenerar PDF.

### Migración de datos

**Script:** `prisma/migrations/<timestamp>_bundle_module/migration.sql` con dos partes:

1. **DDL:** crear `BundleStatus`, `EvaluationBundle`, `EvaluationBundleItem`; alterar `AnswerSheet` y `StudentAnswer` (agregar columnas nullables + foreign keys).
2. **Datos de prueba existentes:** como el usuario confirmó que los datos actuales son de prueba, **no escribimos script de backfill**. Las hojas existentes (`answer_sheet.evaluationId NOT NULL, bundleId NULL`) siguen funcionando como legacy (cualquier hoja nueva usa `bundleId`). En un siguiente PR podemos añadir `cleanup_legacy_sheets` si queremos purgar.

---

## Estado y workflow

```
       ┌─────────┐  MarkReady   ┌───────┐
       │  DRAFT  │ ───────────► │ READY │
       └─────────┘              └───────┘
            ▲                       │
            └────── UnmarkReady ────┘  (solo SUPER_ADMIN; opcional Sprint 3)
```

- **`DRAFT` (default):** se puede editar nombre, bookletNumber, tema, añadir/quitar items, reordenar.
- **`READY`:** contenido inmutable. Solo se puede regenerar PDF y descargar.

**Transición a READY:** valida que el bundle tenga al menos 1 item, que todas las evaluaciones referenciadas sigan en `APPROVED|PUBLISHED`, y que `bookletNumber` sea único (si está definido). Si falla, error de dominio → rollback.

---

## Roles y permisos

| Acción                             | SUPER_ADMIN | ADMIN          | COORDINATOR    | TEACHER |
| ---------------------------------- | ----------- | -------------- | -------------- | ------- |
| Ver lista de bundles               | ✅          | ✅ (read-only) | ✅ (read-only) | ❌      |
| Ver detalle de bundle              | ✅          | ✅             | ✅             | ❌      |
| Crear bundle                       | ✅          | ❌             | ❌             | ❌      |
| Editar bundle en DRAFT             | ✅          | ❌             | ❌             | ❌      |
| Marcar READY / desmarcar           | ✅          | ❌             | ❌             | ❌      |
| Eliminar bundle                    | ✅          | ❌             | ❌             | ❌      |
| Diseñador de portada del bundle    | ✅          | ❌             | ❌             | ❌      |
| Descargar PDF / hoja de respuestas | ✅          | ✅             | ✅             | ❌      |
| Ver hojas escaneadas del bundle    | ✅          | ✅             | ✅             | ❌      |
| Calificar hojas de un bundle       | ✅          | ✅             | ✅             | ❌      |

**Reglas RLS:** todas las queries filtran por `institutionId` (RLS existente en `tenant_isolation` se aplica automáticamente a `EvaluationBundle` y `EvaluationBundleItem` tras habilitarse).

---

## Pipeline de impresión

### Token HMAC (`src/shared/infrastructure/crypto/print-token.ts`)

```typescript
// ANTES
export type PrintKind = "booklet" | "answer-sheets" | "answer-key";

// DESPUÉS
export type PrintKind =
  | "booklet"
  | "answer-sheets"
  | "answer-key"
  | "bundle"
  | "answer-sheets-bundle"
  | "answer-key-bundle";

export interface PrintTokenPayload {
  institutionId: string;
  kind: PrintKind;
  // Para kind = "booklet" | "answer-sheets" | "answer-key":
  evaluationId?: string;
  // Para kind = "bundle" | "answer-sheets-bundle" | "answer-key-bundle":
  bundleId?: string;
  // El actor lo deduce del tipo:
  //   booklet / answer-sheets / answer-key → evaluationId
  //   bundle → bundleId
  expiresAt: number; // unix ms
}
```

**Migración del token:** los tokens actuales `{ kind: "booklet", evaluationId }` siguen funcionando. Solo agregamos el caso `kind: "bundle", bundleId`.

### Rutas (`src/app/print/`)

| Ruta                                     | Kind                 | Uso                                                                                                    |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `/print/evaluation/[id]`                 | booklet              | Renderiza el booklet de **una evaluación** (existente, sin cambios).                                   |
| `/print/bundle/[id]`                     | bundle               | Renderiza el booklet del **bundle** (N evaluaciones concatenadas, imposition unificada). **Sprint 1.** |
| `/print/answer-sheets/[evaluationId]`    | answer-sheets        | Una evaluación (existente, sin cambios).                                                               |
| `/print/answer-sheets/bundle/[bundleId]` | answer-sheets-bundle | Hoja unificada del bundle (N secciones, numeración continua). **Sprint 2.**                            |
| `/print/answer-key/[evaluationId]`       | answer-key           | Clave de respuestas de **una evaluación** (existente).                                                 |
| `/print/answer-key/bundle/[bundleId]`    | answer-key-bundle    | Clave de respuestas unificada del bundle (numeración global + local). **Sprint 3.**                    |

### Worker PDF (`workers/pdf.worker.ts`)

Cambios mínimos en el worker existente:

```typescript
// Antes
if (payload.kind === "booklet") {
  for (const evId of [payload.evaluationId]) {
    /* render */
  }
}

// Después
if (payload.kind === "bundle") {
  const items = await bundleRepo.listItems(payload.bundleId);
  for (const item of items) {
    await renderBookletPage(item.evaluationId);
  }
  await applySaddleStitchImposition(); // sobre todo el PDF acumulado
}
```

No se necesita un worker nuevo. La ruta de render existente itera; solo añadimos el caso `bundle`.

### Portada del bundle

Cuando `kind = "bundle"`, el worker genera una **portada adicional** antes del primer booklet:

- Logo institucional + tema del bundle
- Nombre del bundle + bookletNumber
- Lista de evaluaciones con su número de orden ("1. Matemáticas — 20 preguntas", etc.)
- Total de preguntas: sum(item.evaluation.totalQuestions)
- "© I.E. María Doraliza López de Mejía · 2026 · Periodo I"

---

## Pipeline OMR / hoja de respuestas unificada

### Modelo de hoja

- **Una hoja por bundle**, no por evaluación. `AnswerSheet.bundleId = X, evaluationId = NULL`.
- El QR lleva `{ kind: "bundle", bundleId: X, signature: HMAC(X) }`.
- Las respuestas (`StudentAnswer`) apuntan a `bundleItemId`, que indirectamente da `evaluationId` y `questionId`.

### Render de la hoja unificada

```
┌────────────────────────────────────────┐
│ HOJA DE RESPUESTAS — COM-001           │  ← número de bundle
│ Simulacro ICFES — Periodo I            │
│                                        │
│ ── Sección 1 · Matemáticas · 20 preg ──│  ← separador visual
│   1. A B C D E     6. A B C D E       │  ← numeración continua
│   2. A B C D E     7. A B C D E       │
│   …                                   │
│   5. A B C D E    10. A B C D E       │
│                                        │
│ ── Sección 2 · Lenguaje · 20 preg ────│
│  21. A B C D E    26. A B C D E       │
│  …                                   │
│  40. A B C D E                       │
│                                        │
│ ── Sección 3 · Inglés · 15 preg ──────│
│  …                                   │
│  55. A B C D E                       │
│                                        │
│ [QR — bundleId firmado]                │
└────────────────────────────────────────┘
```

- El OMR sabe en qué pregunta está: en `StudentAnswer`, `bundleItemId` da la evaluación, `positionInBundle` (calculado del `order` + preguntas previas) da el índice global.
- Las preguntas flagged (>60% lleno, <20% lleno, múltiple marca) se reportan en el review manual como antes.

### Cambio en `workers/omr.worker.ts`

```typescript
// Antes
const answerSheet = await sheetRepo.findById(sheetId);
const evaluation = await evalRepo.findById(answerSheet.evaluationId);
// procesar…

// Después
const answerSheet = await sheetRepo.findById(sheetId);
if (answerSheet.bundleId) {
  const items = await bundleRepo.listItemsOrdered(answerSheet.bundleId);
  // procesar cada item, calcular offset global de preguntas
} else {
  // legacy: hoja de una sola evaluación
}
```

### Soporte de opciones variables (4 a 8 por pregunta) — Sprint 1

El worker OMR actual asume columnas uniformes (A-D) en toda la hoja. Para soportar el
caso del ejemplo real (preguntas 60-65 con 8 opciones A-H, resto con 4):

- **Entrada:** para cada pregunta en el bundle, `question.options.length` ∈ [2, `EVAL_MAX_OPTIONS`] (default 8).
- **Layout esperado en la hoja:** columnas con ancho proporcional a `options.length`. Una
  pregunta con 8 opciones ocupa el doble de ancho horizontal que una con 4. El alineamiento
  se computa al render: el header imprime el letter range correcto (`A-H` o `A-D`), las
  burbujas tienen el mismo tamaño físico en mm (típicamente 4-5mm), solo cambia el
  espaciado entre ellas.
- **Detección OMR:** el worker lee las posiciones de burbujas del PDF renderizado (no del
  escaneo) — para cada pregunta, conoce cuántas columnas esperar y aplica los thresholds
  (>60% lleno = marcada, <20% = vacía, en medio = flag). Si se detecta una columna no
  esperada (p.ej. 5 burbujas en una pregunta de 4 opciones), se flagea toda la pregunta
  para revisión manual.
- **Cambio mínimo en `omr.worker.ts`:** el loop interno de detección debe recibir `expectedColumns`
  por pregunta en lugar de asumir 5 globalmente. La función de detección de burbuja individual
  no cambia.

**Aplicable también al booklet PDF:** el renderizador de booklet (single-evaluation) ya itera
`options.length`, pero el de la **hoja unificada** (que estamos creando en Sprint 2) debe
recibir `expectedColumns` por pregunta. Lo definimos en Sprint 1 en un helper compartido
(`src/modules/printing/domain/answer-sheet-layout.ts`) para que Sprint 2 lo reuse.

---

## UI y rutas

| Ruta                           | Quién       | Qué                                                                   |
| ------------------------------ | ----------- | --------------------------------------------------------------------- |
| `/admin/bundles`               | SUPER_ADMIN | Lista de bundles de la institución (read para ADMIN/COORD).           |
| `/admin/bundles/new`           | SUPER_ADMIN | Wizard 3 pasos: pick evals → meta → diseñador portada.                |
| `/admin/bundles/[id]`          | SUPER_ADMIN | Detalle: preview, descargar PDF, editar tema, marcar READY, eliminar. |
| `/admin/bundles/[id]/edit`     | SUPER_ADMIN | Solo si `status = DRAFT`.                                             |
| `/admin/bundles/[id]/designer` | SUPER_ADMIN | Editor visual de portada (reusa patrón de `/admin/theme`).            |

**Nav del dashboard:** nuevo ítem "Compendios" en el sidebar, solo visible si el rol incluye `SUPER_ADMIN` o si se quiere dar read-only a ADMIN/COORDINATOR.

---

## API surface

| Método + ruta                                            | Quién                           | Descripción                                                                        |
| -------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/bundles`                                      | SUPER_ADMIN                     | Crear bundle (DRAFT). Body: `{ name, bookletNumber?, evaluationIds[], theme? }`.   |
| `GET /api/bundles`                                       | cualquier                       | Listar (filtrado por institutionId vía RLS).                                       |
| `GET /api/bundles/[id]`                                  | cualquier                       | Detalle con items.                                                                 |
| `PATCH /api/bundles/[id]`                                | SUPER_ADMIN                     | Editar (solo si DRAFT).                                                            |
| `DELETE /api/bundles/[id]`                               | SUPER_ADMIN                     | Borrar (cualquier estado).                                                         |
| `POST /api/bundles/[id]/items`                           | SUPER_ADMIN                     | `AddEvaluationToBundle`. Body: `{ evaluationId, order? }`.                         |
| `DELETE /api/bundles/[id]/items/[itemId]`                | SUPER_ADMIN                     | `RemoveFromBundle`.                                                                |
| `PATCH /api/bundles/[id]/items/reorder`                  | SUPER_ADMIN                     | `ReorderBundleItems`. Body: `{ itemIds[] }`.                                       |
| `POST /api/bundles/[id]/theme`                           | SUPER_ADMIN                     | `UpdateBundleTheme`.                                                               |
| `POST /api/bundles/[id]/ready`                           | SUPER_ADMIN                     | `MarkBundleReady`.                                                                 |
| `POST /api/bundles/[id]/unmark-ready`                    | SUPER_ADMIN                     | Regresar a DRAFT.                                                                  |
| `POST /api/print/bundle/[id]/pdf`                        | cualquier                       | Encolar job PDF (igual que `/api/print/evaluation/[id]/pdf` actual). **Sprint 1.** |
| `GET /api/bundles/[id]/answer-sheets/pdf?students=<csv>` | SUPER_ADMIN/ADMIN/COORD         | Encolar job hoja unificada (kind=answer-sheets-bundle). **Sprint 2.**              |
| `GET /api/bundles/[id]/answer-key/pdf`                   | SUPER_ADMIN/ADMIN/COORD         | Encolar job clave unificada (kind=answer-key-bundle). **Sprint 3.**                |
| `GET /print/bundle/[id]?t=<token>`                       | token HMAC                      | Render server-side para el worker (existente). **Sprint 1.**                       |
| `GET /print/answer-sheets/bundle/[id]?t=<token>`         | token HMAC                      | Render hoja unificada (Sprint 2).                                                  |
| `GET /print/answer-key/bundle/[id]?t=<token>`            | token HMAC                      | Render clave unificada (Sprint 3).                                                 |
| `GET /admin/bundles/[id]/report`                         | SUPER_ADMIN/ADMIN/COORD/TEACHER | Reporte comparativo (tablas por evaluation + por pregunta). **Sprint 3.**          |

---

## Sprints

### Sprint 1 — Modelo + CRUD + Diseñador de portada ✅

**Objetivo:** un SUPER_ADMIN puede crear un bundle, agregar/quitar evaluaciones, diseñar la portada, marcar como READY y descargar el booklet PDF combinado.

**Entregables:** ✅ todos

1. ✅ Migración Prisma (`BundleStatus`, `EvaluationBundle`, `EvaluationBundleItem`, `AnswerSheet.bundleId` XOR `evaluationId`, `StudentAnswer.bundleItemId`, `Subject.parentSubjectId` + `isArea`).
2. ✅ Módulo `src/modules/bundles/` (domain / application / infrastructure).
3. ✅ Use cases: `CreateBundle`, `AddEvaluationToBundle`, `RemoveFromBundle`, `ReorderBundleItems`, `UpdateBundleTheme`, `MarkBundleReady`, `UnmarkBundleReady`, `ListBundles`, `GetBundle`, `DeleteBundle`.
4. ✅ API REST (`/api/bundles/*`) con mapping `DomainError → HTTP`.
5. ✅ UI: `/admin/bundles`, `/admin/bundles/new` (wizard), `/admin/bundles/[id]`, `/admin/bundles/[id]/edit`, `/admin/bundles/[id]/designer`.
6. ✅ Render PDF del booklet del bundle: `/print/bundle/[id]`, `PrintKind="bundle"`, worker PDF itera items.
7. ✅ Portada del bundle con tabla de áreas.
8. ✅ Helper `src/modules/printing/domain/answer-sheet-layout.ts` (soporte 2–8 opciones).
9. ✅ Tests: 43 specs (cubren cover-table, bundle-status, answer-sheet-layout, create-bundle, mark-ready, add-evaluation, reorder). **182/182 verdes al cierre de Sprint 1**.

### Sprint 2 — Hoja de respuestas unificada ✅

**Objetivo:** una sola hoja OMR para todo el bundle; el QR identifica el bundle; el worker OMR procesa las N secciones.

**Entregables:** ✅ todos

1. ✅ Render `/print/answer-sheets/bundle/[id]` con secciones por evaluación y numeración continua.
2. ✅ `AnswerSheet` usando `bundleId` (manteniendo `evaluationId` nullable para legacy).
3. ✅ Worker OMR (`process-answer-sheet.ts`) ahora procesa hojas con `bundleId`, con `getCorrectAnswersForBundle` que une `items → evaluation → sections → questions` y devuelve `(id, number, correctAnswer, optionsLength)[]`.
4. ✅ UI: en `/admin/bundles/[id]`, botón "Generar hojas de respuesta" enlaza a `/admin/bundles/[id]/answer-sheets` (selector de estudiantes) que envía a `/api/bundles/[id]/answer-sheets/pdf?students=<csv>`.
5. ✅ QR con payload `{ kind: "bundle", bundleId, signature }` (XOR con `{ kind: "evaluation", ... }`). Validado por 5 tests en `qr-payload-bundle.test.ts`.
6. ✅ Estilos: `.as-section` + `.as-section-header` para separadores visuales en la hoja unificada.
7. ✅ `PdfGenerationJob` extendido con `bundleId?` y `extraQuery?` para pasar `?students=` al render worker.
8. ✅ Worker PDF (`pdf.worker.ts`) despacha los 3 nuevos kinds: `bundle`, `answer-sheets-bundle`, `answer-key-bundle`.

### Sprint 3 — Clave de respuestas unificada + reportes comparativos ✅

**Objetivo:** la clave del bundle, reportes comparativos entre evaluaciones del bundle, refinamiento de UX.

**Entregables:** ✅ todos

1. ✅ `/print/answer-key/bundle/[id]` — clave unificada con numeración global + local y justificación.
2. ✅ API `GET /api/bundles/[id]/answer-key/pdf` para encolar el PDF de la clave.
3. ✅ UI botón "Descargar clave unificada" en `/admin/bundles/[id]`.
4. ✅ Reporte comparativo: `/admin/bundles/[id]/report` (SUPER_ADMIN/ADMIN/COORD/TEACHER). Helper puro `computeCompareReport()` en `src/modules/bundles/domain/compare-report.ts`. Muestra:
   - Tabla por evaluation: `correctRate` medio y dificultad (Alta/Media/Baja).
   - Tabla por pregunta: `correctRate` y `answeredCount` con n.º global.
5. ✅ Refinamiento UX: badges de estado "Borrador" / "Listo" en el detalle, columna de navegación "← Volver al compendio".
6. ✅ Tests adicionales: 5 en `qr-payload-bundle.test.ts`, 3 en `compare-report.test.ts`. **Total: 190/190 verdes.**

### Sprint 4 — Drill-down del reporte por hoja × item ✅

**Objetivo:** cerrar la limitación documentada en Sprint 3: el reporte no desglosaba por hoja × item. Ahora `StudentAnswer.bundleItemId` se popula al calificar, lo que habilita el drill-down por estudiante.

**Entregables:** ✅ todos

1. ✅ `StudentAnswer.bundleItemId` poblado en hojas de bundle durante el `process-answer-sheet.ts`. En hojas legacy sigue null.
2. ✅ Dominio: `StudentAnswerRecord.bundleItemId: string | null` añadido.
3. ✅ Repo: `PrismaScanningRepository.saveAnswers()` persiste `bundleItemId`.
4. ✅ Provider: `EvaluationQuestionsProvider.getCorrectAnswersForBundle()` devuelve `{id, number, bundleItemId, correctAnswer, optionsLength}[]` (antes sin `bundleItemId`).
5. ✅ Helper `computeCompareReport()` extendido con `perSheetBreakdown: CompareReportSheetBreakdown[]` (un entry por hoja, agrupando respuestas por `bundleItemId`). Inputs opcionales `answersBySheet` y `sheetLabels` (no rompen hojas legacy).
6. ✅ UI: nueva sección "Resultado por estudiante" en `/admin/bundles/[id]/report`. Tabla con fila por estudiante y una columna por evaluation del compendio, mostrando `correctRate` y `correctCount/questionCount`. Solo aparece si `perSheetBreakdown.length > 0`.
7. ✅ Tests: 5 specs en `compare-report.test.ts` (3 originales + 2 nuevos). **Total: 192/192 verdes.**

**No realizado en Sprint 4 (queda para Fase 2+):**

- Drag-and-drop visual de items en el editor (los use cases ya soportan reorder, falta UI).
- Backfill de `StudentAnswer.bundleItemId` para hojas antiguas calificadas con versiones previas del worker (no se han ejecutado en prod, no aplica aún).
- Vista comparativa entre 2 cohortes del mismo compendio (radar por evaluación × período).
- Export CSV del reporte.

### Sprint 5 — Hardening: reorder two-phase + UX sin Runtime overlay ✅

**Objetivo:** cerrar dos bugs detectados en smoke test manual contra Docker Desktop:

1. **Bug de producción en `ReorderBundleItems`**: al revertir el orden (p.ej. `[1,2,3]` → `[3,2,1]`), Prisma fallaba con `Unique constraint failed on the fields: (bundleId, order)` porque el `reorderItems` actualizaba in-place y, durante el intermedio, dos items compartían el mismo `order` (el que ya estaba + el que recién se le asignaba).
2. **Bug de UX**: `toggleBundleReadyAction` y `deleteBundleAction` hacían `throw new Error(...)` en cualquier fallo de negocio, lo que provocaba que Next.js mostrara el Runtime Error overlay en lugar de un mensaje accionable. Caso típico: intentar marcar como listo un compendio cuya evaluación no tiene preguntas (`MarkBundleReady` → `VALIDATION`).

**Entregables:** ✅ todos

1. ✅ `PrismaBundleRepository.reorderItems()` reescrito como **two-phase update** dentro de la misma transacción:
   - Pasada 1: cada item recibe un `order` temporal negativo único (`-1, -2, …`) que no choca con el `order` actual.
   - Pasada 2: se aplica el orden final 1-based sobre el rango ya libre.
   - El resultado es atómico (mismo `tx`): si algo falla entre fases, no queda el compendio en estado intermedio.
2. ✅ `InMemoryBundleRepository.reorderItems()` espejo del comportamiento de Prisma: simula el `@@unique([bundleId, order])` mediante un helper `assertNoOrderCollision()` y aplica el mismo two-phase. Un cambio futuro que revierta a update in-place **falla los tests unitarios**.
3. ✅ Validación previa de `itemIds`: el set debe coincidir 1-a-1 con los items del bundle (mismo tamaño, ningún id ajeno). Falla explícita si no.
4. ✅ UX: `toggleBundleReadyAction` y `deleteBundleAction` ahora devuelven `BundleFormState` (no lanzan). `deleteBundleAction` sigue llamando `redirect("/admin/bundles")` en éxito.
5. ✅ Nuevo client component `src/app/(dashboard)/admin/bundles/[id]/action-buttons.tsx` (`BundleActionPanel`) que envuelve los dos forms en `useActionState`. Cuando hay `state.error`, se muestra un mensaje inline con `role="alert"` (no más Runtime Error overlay). Los links estáticos de descarga / navegación (PDF, hojas, clave, reporte) quedan en el Server Component padre porque no fallan en cliente.
6. ✅ Pendings y mensajes de submit mejorados ("Sellando…", "Volviendo a borrador…", "Eliminando…").
7. ✅ Tests: 2 nuevos en `reorder-bundle-items.test.ts` ("shift-up primero→último" y "no-op mismo orden"). **Total: 194/194 verdes.**

**No realizado en Sprint 5:**

- Drag-and-drop visual (sigue pendiente — usa el endpoint actual de reorder ya validado).

### Roadmap siguiente (post-Sprint 5)

- **Fase 2 OMR**: pipeline OMR de hojas bundle en producción (worker OMR con `bundleId` ya implementado, falta deploy y entrenamiento con datos reales).
- **Fase 2 resultados**: UI de revisión manual de hojas bundle flagged.
- **Fase 3**: institucional completa (LDAP, multi-idioma, reportes anuales).
- **Mejoras UX compendios**: drag-and-drop, preview en vivo del booklet, asignación de compendios a cursos/grupos con calendar.

---

## Riesgos y casos borde

1. **Una evaluación cambia de estado (APPROVED → DRAFT, p.ej. por edición) estando en un bundle READY:** el bundle sigue imprimible (la versión APPROVED se preserva por el versionado de `Evaluation`), pero advertimos al usuario en el detalle del bundle.
2. **Una evaluación se elimina (soft-delete) y estaba en un bundle READY:** el item sigue apuntando a la evaluación (soft-deleted); al regenerar PDF, el worker detecta y reporta error (`EvaluationNotFound`). Acción manual: quitar el item del bundle.
3. **Bundle con bookletNumber duplicado:** el `@@unique([institutionId, bookletNumber])` lo previene. Error claro en la API.
4. **Bundle con N=0 items:** no se puede marcar READY (validación). El booklet PDF falla con error explícito.
5. **Evaluación ya en otro bundle:** permitido (misma eval puede estar en varios bundles: "Simulacro 1", "Simulacro 2"). El `@@unique([bundleId, evaluationId])` es por bundle.
6. **Hojas legacy con `evaluationId`:** siguen funcionando en el worker OMR (rama `else` legacy). El review UI debe distinguirlas visualmente ("Hoja individual legacy — no parte de un compendio").
7. **Reordenamiento con `order`:** UI usa drag-and-drop; el backend recibe la lista ordenada y recalcula `order` en una transacción.
8. **Race condition al añadir evaluación que se aprueba simultáneamente:** la validación `status ∈ {APPROVED, PUBLISHED}` se hace dentro de la transacción con `SELECT ... FOR UPDATE` (Sprint 1 lo hace a nivel de use case; si hay race, fallo claro).
9. **Token de impresión expirado:** igual que hoy, el worker regenera si recibe 401/403.
10. **Impresión de bundle muy grande (N=20 evaluaciones, 400 preguntas):** imposition puede tardar 10–15s; el job de BullMQ maneja timeout largo (config actual: 300s).
11. **Pregunta con opciones variables dentro de la misma hoja:** una pregunta con 8 opciones ocupa más ancho que una con 4. Si el booklet PDF o la hoja unificada no computan bien el layout por pregunta, las preguntas se desbordan o se solapan. Validado por el helper `answer-sheet-layout.ts` (Sprint 1); cubierto por tests que iteran `options.length` ∈ {2, 3, 4, 5, 6, 7, 8} con asserts de bounding box.
12. **`Subject.parentSubjectId` introducido en una tabla con datos:** si una institución ya tiene subjects sin `parentSubjectId` (caso de datos de prueba legacy), la portada del bundle los mostrará como "sin área" (fila aparte en la tabla). No requiere backfill; solo documentar el comportamiento en la UI.
13. **Área sin preguntas (`isArea=true` con 0 hijos):** la portada debe ignorarla. Validación al marcar READY: cada subject hoja debe tener al menos 1 question en alguna evaluation del bundle.

---

## Apéndice A — Contratos técnicos

### Print token (campos)

```typescript
// src/shared/infrastructure/crypto/print-token.ts
export interface PrintTokenPayload {
  institutionId: string;
  kind: PrintKind;
  evaluationId?: string; // para booklet/answer-sheets/answer-key de 1 evaluación
  bundleId?: string; // para bundle
  expiresAt: number;
}
```

### QR de hoja de respuestas

```typescript
// Formato actual: { kind: "evaluation", evaluationId, studentId? }
// Formato nuevo:   { kind: "bundle", bundleId, studentId? }
// HMAC-SHA256 firmado con QR_SIGNING_SECRET por institución.
```

### PrintKind extendido

```typescript
export type PrintKind = "booklet" | "answer-sheets" | "answer-key" | "bundle";
```

### Theming del bundle

Reusa el modelo `theme` de `Evaluation`. La portada del bundle se compone:

```typescript
mergeBundleTheme(institutionalTheme, bundle.theme)
  → institution defaults (logo, colors, typography)
  → bundle overrides
  → Evaluación defaults del primer item (si existen, solo presets de portada)
```

---

## Apéndice B — Decisiones log (para auditoría)

| Fecha      | Decisión                                                        | Contexto                                                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | N=1 usa flujo bundle (no ruta paralela)                         | Datos actuales son de prueba, no requieren migración.                                                                                                                                                                                                                                                                       |
| 2026-07-18 | `EvaluationBundle` como tabla nueva, no ad-hoc                  | Reutilización entre períodos.                                                                                                                                                                                                                                                                                               |
| 2026-07-18 | Solo `APPROVED` + `PUBLISHED` entran a bundle                   | Coherencia con flujo de aprobación.                                                                                                                                                                                                                                                                                         |
| 2026-07-18 | `Status = DRAFT → READY` (un solo sentido por ahora)            | Mismo modelo mental que Evaluation.DRAFT → PUBLISHED.                                                                                                                                                                                                                                                                       |
| 2026-07-18 | Numeración continua en hoja unificada                           | UX más simple para el estudiante.                                                                                                                                                                                                                                                                                           |
| 2026-07-18 | Camino A confirmado: 1 evaluation = 1 subject, Bundle agrupa N  | Más flexible, reutilizable. Descartado Camino B (sections multi-subject) por sobreingeniería para el caso actual.                                                                                                                                                                                                           |
| 2026-07-18 | QR + HMAC se mantiene (no barcode lineal)                       | El colegio controla la impresión; HMAC da audit trail. Comparado contra el ejemplo real (CODE128) — gana QR por verificabilidad.                                                                                                                                                                                            |
| 2026-07-18 | `Subject.parentSubjectId` + `isArea` agregados                  | Necesario para la tabla de áreas en la portada del bundle. Jerarquía de 2 niveles: área → subject evaluable.                                                                                                                                                                                                                |
| 2026-07-18 | Soporte de opciones variables (2 a 8) en Sprint 1               | Ejemplo real mezcla A-D y A-H. Helper `answer-sheet-layout.ts` reusado por booklet PDF (Sprint 1) y hoja unificada (Sprint 2).                                                                                                                                                                                              |
| 2026-07-19 | Hoja de respuestas unificada por bundle (Sprint 2 ✅)           | QR ahora XOR `eval` XOR `bundle` (uno y solo uno). Worker OMR calcula `effectiveColumns = min(max(2, optionsLength), 8)` por pregunta. Hoja unificada: numeración continua global con `.as-section` separator por evaluation.                                                                                               |
| 2026-07-19 | Clave unificada por bundle (Sprint 3 ✅)                        | PrintKind extendido a `answer-sheets-bundle` y `answer-key-bundle`. PdfGenerationJob añade `bundleId?` y `extraQuery?` para forwardear query strings al render.                                                                                                                                                             |
| 2026-07-19 | Reporte comparativo: `computeCompareReport()` (Sprint 3 ✅)     | Helper puro en `src/modules/bundles/domain/compare-report.ts`. Toma `Map<questionId, Array<boolean\|null>>` y devuelve correctRate por pregunta + media por evaluation + difficulty = 1 - correctRate. null = REVIEW/flagged → ignorado del cómputo. Reporte NO desglosa por hoja × item (limitación actual; ver Sprint 4). |
| 2026-07-19 | `StudentAnswer.bundleItemId` poblado al calificar (Sprint 4 ✅) | Habilita drill-down del reporte por (student × item). `process-answer-sheet.ts` pasa `bundleItemId` al `StudentAnswerRecord` cuando la hoja es de bundle; en legacy queda null. `PrismaScanningRepository.saveAnswers()` persiste el campo.                                                                                 |
| 2026-07-19 | Drill-down hoja × item en reporte (Sprint 4 ✅)                 | `computeCompareReport()` ahora acepta `answersBySheet?: Map<sheetId, {questionId,bundleItemId,isCorrect}[]>` opcional; devuelve `perSheetBreakdown[]`. UI muestra "Resultado por estudiante" con una columna por evaluation. Hojas legacy (sin `bundleItemId`) no aparecen en esa sección.                                  |

---

**Próximo paso:** plan detallado de Sprint 1 con archivos a crear/editar, orden de implementación, y verificación end-to-end.
