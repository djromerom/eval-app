-- Pedido del docente (5 sep 2026): dividir el campo único `name` del
-- modelo `Student` en 4 columnas separadas según la convención colombiana:
-- lastName1, lastName2, firstName1, firstName2.
--
-- Decisión del docente: DROP de `name` y crear las 4 columnas VACÍAS.
-- El docente acepta la pérdida de datos y rellena manualmente.
--
-- Las 4 columnas son NOT NULL DEFAULT '' para que la migración corra sin
-- tocar filas existentes. La validación de "no vacío" para lastName1 y
-- firstName1 se enforces en el use case (CreateStudent / UpdateStudent),
-- no en SQL — un solo sitio para la regla de negocio.

ALTER TABLE "Student" DROP COLUMN "name";

ALTER TABLE "Student"
  ADD COLUMN "lastName1"  TEXT NOT NULL DEFAULT '',
  ADD COLUMN "lastName2"  TEXT NOT NULL DEFAULT '',
  ADD COLUMN "firstName1" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "firstName2" TEXT NOT NULL DEFAULT '';
