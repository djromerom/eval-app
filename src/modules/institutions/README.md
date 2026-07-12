# Módulo: institutions

Gestión del tenant raíz (instituciones educativas). Solo SUPER_ADMIN opera aquí.

Este módulo es la **implementación de referencia** del patrón por capas:

- `domain/` — entidad, reglas puras (`isValidSlug`) y el puerto `InstitutionRepository`.
- `application/` — casos de uso (`CreateInstitution`, `ListInstitutions`): autorización + reglas de negocio, sin tocar Prisma.
- `infrastructure/` — adaptador Prisma del repositorio y el `container.ts` (composition root) que consume la capa de presentación (`src/app`).

Los tests unitarios (en `tests/unit/`) prueban los casos de uso con un repositorio en memoria: sin base de datos.
