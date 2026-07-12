-- Row Level Security multi-tenant (REQUERIMIENTOS_v2.md §3.9, §5 Seguridad).
--
-- Estrategia: cada tabla de negocio queda aislada por `institutionId` usando la
-- variable de sesión `app.current_institution`. El rol DUEÑO (el que usa la app
-- hoy y el que corre las migraciones) OMITE RLS por defecto (no se usa FORCE),
-- así la app sigue funcionando con el filtrado por institución de la capa de
-- aplicación (defensa en profundidad). El rol restringido `eval_app` SÍ aplica
-- las políticas: es el rol al que apuntará la app en producción, fijando la
-- variable por request. Las asignaturas globales (institutionId NULL) son
-- visibles para todas las instituciones.

-- Rol de aplicación con privilegios mínimos (no dueño ⇒ RLS aplica).
-- NOTA: CREATE ROLE exige que el usuario de migración tenga CREATEROLE (o sea
-- superusuario). En managed DBs sin ese privilegio, crea el rol `eval_app`
-- por fuera y esta sección quedará como no-op (IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eval_app') THEN
    CREATE ROLE eval_app LOGIN PASSWORD 'eval_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO eval_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eval_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eval_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eval_app;

-- Tablas con institutionId NOT NULL: aislamiento estricto por institución.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'User', 'AcademicYear', 'Course', 'Group', 'Period', 'Student',
    'Evaluation', 'QuestionBank', 'EvaluationTemplate', 'ScanBatch'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("institutionId" = current_setting(''app.current_institution'', true)::uuid) '
      'WITH CHECK ("institutionId" = current_setting(''app.current_institution'', true)::uuid);',
      t
    );
  END LOOP;
END
$$;

-- Subject: institutionId puede ser NULL (catálogo global compartido).
ALTER TABLE "Subject" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subject"
  USING (
    "institutionId" IS NULL
    OR "institutionId" = current_setting('app.current_institution', true)::uuid
  )
  WITH CHECK (
    "institutionId" IS NULL
    OR "institutionId" = current_setting('app.current_institution', true)::uuid
  );
