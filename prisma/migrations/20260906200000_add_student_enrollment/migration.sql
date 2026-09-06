-- Matrícula del estudiante en un año académico concreto. Multi-tenant via
-- student.institutionId (FK transitiva, NO se duplica acá — mismo patrón
-- que StudentCodeHistory y LeaderCourseAssignment). NO se suma al array
-- tenant_tables (la policy la aplica Prisma con `student: { institutionId }`).
CREATE TABLE "StudentEnrollment" (
    "id"              UUID NOT NULL,
    "studentId"       UUID NOT NULL,
    "academicYearId"  UUID NOT NULL,
    "groupId"         UUID NOT NULL,
    "grade"           TEXT,
    "bookletTypeId"   UUID,
    "isCurrent"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentEnrollment_pkey" PRIMARY KEY ("id")
);

-- Un estudiante solo tiene UN enrollment por año académico.
CREATE UNIQUE INDEX "StudentEnrollment_studentId_academicYearId_key"
    ON "StudentEnrollment"("studentId", "academicYearId");

-- Una sola fila vigente por estudiante (mismo patrón que Period.isCurrent).
CREATE UNIQUE INDEX "StudentEnrollment_studentId_isCurrent_key"
    ON "StudentEnrollment"("studentId") WHERE "isCurrent" = true;

CREATE INDEX "StudentEnrollment_studentId_idx"       ON "StudentEnrollment"("studentId");
CREATE INDEX "StudentEnrollment_academicYearId_idx"  ON "StudentEnrollment"("academicYearId");
CREATE INDEX "StudentEnrollment_groupId_idx"         ON "StudentEnrollment"("groupId");
CREATE INDEX "StudentEnrollment_bookletTypeId_idx"   ON "StudentEnrollment"("bookletTypeId");

ALTER TABLE "StudentEnrollment"
    ADD CONSTRAINT "StudentEnrollment_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment"
    ADD CONSTRAINT "StudentEnrollment_academicYearId_fkey"
    FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment"
    ADD CONSTRAINT "StudentEnrollment_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment"
    ADD CONSTRAINT "StudentEnrollment_bookletTypeId_fkey"
    FOREIGN KEY ("bookletTypeId") REFERENCES "BookletType"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: crea un enrollment por estudiante activo apuntando al año
-- académico isCurrent de su institución. Si no hay año actual, deja NULL.
-- En local sin año actual, los estudiantes quedan sin enrollment hasta que
-- el admin cree uno (caso borde esperado, se reporta via UI).
--
-- Defensa: valida que TODA institución con estudiantes activos tenga
-- exactamente UN año académico isCurrent. Falla loud con lista de
-- instituciones problemáticas si no se cumple (evita backfill silencioso
-- con academicYearId NULL o duplicados por bug previo).
DO $$
DECLARE
    missing_count INTEGER;
    dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO missing_count
    FROM "Institution" i
    WHERE EXISTS (
        SELECT 1 FROM "Student" s
        WHERE s."institutionId" = i.id AND s."deletedAt" IS NULL
    ) AND NOT EXISTS (
        SELECT 1 FROM "AcademicYear" ay
        WHERE ay."institutionId" = i.id AND ay."isCurrent" = true
    );
    IF missing_count > 0 THEN
        RAISE EXCEPTION
            'No se puede hacer backfill: % institución(es) con estudiantes activos '
            'pero sin año académico marcado como actual. Cree uno antes de '
            'reintentar la migración.', missing_count;
    END IF;

    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT "institutionId", COUNT(*) AS cnt
        FROM "AcademicYear"
        WHERE "isCurrent" = true
        GROUP BY "institutionId"
        HAVING COUNT(*) > 1
    ) d;
    IF dup_count > 0 THEN
        RAISE EXCEPTION
            'No se puede hacer backfill: % institución(es) con MÁS DE UN año '
            'académico marcado como actual. Ejecute el fix preventivo antes de '
            'reintentar la migración.', dup_count;
    END IF;
END $$;

INSERT INTO "StudentEnrollment"
    ("id", "studentId", "academicYearId", "groupId", "grade", "bookletTypeId", "isCurrent", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()                  AS "id",
    s."id"                             AS "studentId",
    ay."id"                            AS "academicYearId",
    s."groupId"                        AS "groupId",
    s."grade"                          AS "grade",
    s."bookletTypeId"                  AS "bookletTypeId",
    true                               AS "isCurrent",
    NOW()                              AS "createdAt",
    NOW()                              AS "updatedAt"
FROM "Student" s
LEFT JOIN "AcademicYear" ay ON ay."institutionId" = s."institutionId"
      AND ay."isCurrent" = true
WHERE s."deletedAt" IS NULL;
