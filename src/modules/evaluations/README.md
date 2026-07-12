# Módulo: evaluations

Núcleo del sistema: creación/edición de evaluaciones tipo ICFES, bloques de contexto,
preguntas estructuradas (A/B/C/D + metadatos SOLO/MEN), flujo de aprobación y versionado.

- `domain/evaluation-status.ts` — máquina de estados del flujo de aprobación (regla pura, con tests).
- `domain/evaluation.ts` — modelo del agregado y puerto de persistencia.
- Pendiente (Fase 2): casos de uso de edición, envío a revisión, aprobación/rechazo,
  plantillas y evaluaciones diferenciadas.
