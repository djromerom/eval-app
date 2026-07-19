-- Sprint 8A: rename del valor `ADMIN` del enum `RoleType` a `ECU_MASTER`.
-- PostgreSQL >= 10 permite `ALTER TYPE ... RENAME VALUE` atómicamente, sin
-- data migration: las filas existentes con role = 'ADMIN' se actualizan en
-- la misma transacción. El campo UserRole.role y cualquier policy RLS que
-- guarde el valor en JSON se mantienen consistentes.
ALTER TYPE "RoleType" RENAME VALUE 'ADMIN' TO 'ECU_MASTER';
