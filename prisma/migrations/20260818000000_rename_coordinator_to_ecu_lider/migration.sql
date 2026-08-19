-- Renombra el valor del enum RoleType de COORDINATOR a ECU_LIDER.
-- Postgres 10+ soporta ALTER TYPE ... RENAME VALUE; commit DDL atómico.
-- El display label en español se actualiza en código (src/app/(dashboard)/admin/users/roles.ts).
ALTER TYPE "RoleType" RENAME VALUE 'COORDINATOR' TO 'ECU_LIDER';