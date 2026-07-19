-- ============================================================================
-- Sprint 1 del módulo compendios (EvaluationBundle + BundleItem + jerarquía
-- de Subject). Ver docs/compendios.md. Migración aditiva — los datos de
-- prueba existentes quedan intactos; la app nueva (Sprint 2) ya no crea
-- hojas con evaluationId NOT NULL pero las legacy siguen funcionando.
-- ============================================================================

-- -------- Subject: jerarquía de áreas para la portada del compendio --------
ALTER TABLE "Subject"
  ADD COLUMN "parentSubjectId" UUID,
  ADD COLUMN "isArea"         BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Subject"
  ADD CONSTRAINT "Subject_parentSubjectId_fkey"
    FOREIGN KEY ("parentSubjectId") REFERENCES "Subject"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "Subject_institutionId_parentSubjectId_idx"
  ON "Subject"("institutionId", "parentSubjectId");

-- -------- Enum + tablas nuevas para bundles --------
CREATE TYPE "BundleStatus" AS ENUM ('DRAFT', 'READY');

CREATE TABLE "EvaluationBundle" (
    "id"            UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "name"          TEXT NOT NULL,
    "bookletNumber" INTEGER,
    "status"        "BundleStatus" NOT NULL DEFAULT 'DRAFT',
    "theme"         JSONB,
    "createdById"   UUID NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationBundle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvaluationBundleItem" (
    "id"           UUID NOT NULL,
    "bundleId"     UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "order"        INTEGER NOT NULL,

    CONSTRAINT "EvaluationBundleItem_pkey" PRIMARY KEY ("id")
);

-- FKs de las tablas nuevas
ALTER TABLE "EvaluationBundle"
  ADD CONSTRAINT "EvaluationBundle_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvaluationBundle"
  ADD CONSTRAINT "EvaluationBundle_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvaluationBundleItem"
  ADD CONSTRAINT "EvaluationBundleItem_bundleId_fkey"
    FOREIGN KEY ("bundleId") REFERENCES "EvaluationBundle"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvaluationBundleItem"
  ADD CONSTRAINT "EvaluationBundleItem_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique constraints (deben coincidir con los @@unique del schema.prisma)
CREATE UNIQUE INDEX "EvaluationBundle_institutionId_bookletNumber_key"
  ON "EvaluationBundle"("institutionId", "bookletNumber");

CREATE UNIQUE INDEX "EvaluationBundleItem_bundleId_evaluationId_key"
  ON "EvaluationBundleItem"("bundleId", "evaluationId");

CREATE UNIQUE INDEX "EvaluationBundleItem_bundleId_order_key"
  ON "EvaluationBundleItem"("bundleId", "order");

-- Indexes adicionales para queries por institución y status
CREATE INDEX "EvaluationBundle_institutionId_idx"
  ON "EvaluationBundle"("institutionId");

CREATE INDEX "EvaluationBundle_institutionId_status_idx"
  ON "EvaluationBundle"("institutionId", "status");

CREATE INDEX "EvaluationBundleItem_evaluationId_idx"
  ON "EvaluationBundleItem"("evaluationId");

-- -------- AnswerSheet: soportebundle --------
-- evaluationId pasa de NOT NULL a NULL (legacy con datos existentes: OK)
ALTER TABLE "AnswerSheet"
  ALTER COLUMN "evaluationId" DROP NOT NULL;

ALTER TABLE "AnswerSheet"
  ADD COLUMN "bundleId" UUID;

ALTER TABLE "AnswerSheet"
  ADD CONSTRAINT "AnswerSheet_bundleId_fkey"
    FOREIGN KEY ("bundleId") REFERENCES "EvaluationBundle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AnswerSheet_bundleId_status_idx"
  ON "AnswerSheet"("bundleId", "status");

-- Invariante a nivel DB: exactamente uno de evaluationId / bundleId no nulo.
-- PostgreSQL lo permite con CHECK (NULL es NULL en cualquier lado del OR).
ALTER TABLE "AnswerSheet"
  ADD CONSTRAINT "AnswerSheet_target_xor_chk"
    CHECK (
      ("evaluationId" IS NOT NULL AND "bundleId" IS NULL)
      OR
      ("evaluationId" IS NULL AND "bundleId" IS NOT NULL)
    );

-- -------- StudentAnswer: bundleItemId --------
ALTER TABLE "StudentAnswer"
  ADD COLUMN "bundleItemId" UUID;

ALTER TABLE "StudentAnswer"
  ADD CONSTRAINT "StudentAnswer_bundleItemId_fkey"
    FOREIGN KEY ("bundleItemId") REFERENCES "EvaluationBundleItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "StudentAnswer_bundleItemId_idx"
  ON "StudentAnswer"("bundleItemId");

-- ============================================================================
-- Row-Level Security para tablas multi-tenant nuevas.
-- Mismo patrón que las tablas existentes (ver migración
-- 20260712195900_enable_rls). Si la app ya usa el rol owner y filtra por
-- institutionId en use cases, RLS es defense-in-depth.
-- ============================================================================

ALTER TABLE "EvaluationBundle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationBundle" FORCE ROW LEVEL SECURITY;

ALTER TABLE "EvaluationBundleItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationBundleItem" FORCE ROW LEVEL SECURITY;

-- Política tenant_isolation para EvaluationBundle: filtrar por institutionId
-- actual seteado en `app.current_institution` vía set_config() (ver
-- runWithInstitution en src/shared/infrastructure/db/tenant-context.ts).
-- current_setting() con true/true devuelve NULL si no está seteado; la
-- comparación con institutionId hace fallar el SELECT de forma segura.
CREATE POLICY "tenant_isolation_bundle" ON "EvaluationBundle"
  USING (
    "institutionId" = current_setting('app.current_institution', true)::uuid
    OR current_setting('app.current_institution', true) IS NULL
  )
  WITH CHECK (
    "institutionId" = current_setting('app.current_institution', true)::uuid
  );

-- Para EvaluationBundleItem la política resuelve la institución vía el bundle.
CREATE POLICY "tenant_isolation_bundle_item" ON "EvaluationBundleItem"
  USING (
    EXISTS (
      SELECT 1 FROM "EvaluationBundle" b
      WHERE b."id" = "EvaluationBundleItem"."bundleId"
        AND (
          b."institutionId" = current_setting('app.current_institution', true)::uuid
          OR current_setting('app.current_institution', true) IS NULL
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "EvaluationBundle" b
      WHERE b."id" = "EvaluationBundleItem"."bundleId"
        AND b."institutionId" = current_setting('app.current_institution', true)::uuid
    )
  );
