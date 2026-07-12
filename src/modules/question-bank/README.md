# Módulo: question-bank

Banco de preguntas reutilizables (institucional y personal). Categorización por asignatura,
nivel SOLO, componente MEN, dificultad y tags. Regla clave: importar una pregunta a una
evaluación crea una **copia independiente** — editar el banco nunca afecta evaluaciones existentes.

- `domain/bank-question.ts` — entidad, datos de creación, filtros de búsqueda y puerto.
- `application/manage-bank.ts` — `CreateBankQuestion`, `SearchBankQuestions` (filtros combinables + visibilidad institucional/personal), `ImportBankQuestion` (copia a una evaluación en BORRADOR con `bankOriginId`) y `ExportQuestionToBank`.
- `infrastructure/` — repo Prisma (visibilidad, filtros, `string_contains` sobre el enunciado) + container.

UI: `/teacher/question-bank` (crear + buscar/filtrar). Importar del banco y exportar al banco desde `/teacher/evaluations/[id]`.
Pendiente: editor TipTap+KaTeX (hoy texto plano), edición/borrado de preguntas del banco.
