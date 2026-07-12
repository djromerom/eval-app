# Módulo: evaluations

Núcleo del sistema: creación/edición de evaluaciones tipo ICFES, bloques de contexto,
preguntas estructuradas (A/B/C/D + metadatos SOLO/MEN), flujo de aprobación y versionado.

- `domain/evaluation-status.ts` — máquina de estados del flujo de aprobación (regla pura, con tests).
- `domain/evaluation.ts` — agregado (evaluación, bloques, preguntas estructuradas A–D), datos de creación, puerto de persistencia y `validateQuestionShape`.
- `application/manage-evaluations.ts` — `CreateEvaluation`, `ListEvaluations` (docente ve las suyas; coordinador/admin todas), `GetEvaluation`, `AddSection`, `AddQuestion` (solo el autor, en BORRADOR).
- `application/change-status.ts` — `ChangeEvaluationStatus`: valida la transición contra la máquina de estados, exige comentario en el rechazo y emite notificaciones in-app (coordinadores al enviar; docente al aprobar/rechazar).
- `infrastructure/` — repo Prisma (incl. `createNewVersion` con copia inmutable de bloques/preguntas) + container.

UI: `/teacher/evaluations` (listar/crear), `/teacher/evaluations/[id]` (bloques + editor estructurado por pregunta + enviar a revisión), `/coordinator/review` (aprobar/rechazar/publicar).

Pendiente (Fase 2): editor TipTap+KaTeX real (hoy el enunciado/opciones se guardan como texto plano en el campo JSON), banco de preguntas, plantillas, evaluaciones diferenciadas, versionado en la UI, importación Overleaf.
