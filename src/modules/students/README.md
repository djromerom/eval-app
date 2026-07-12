# Módulo: students

Estudiantes: CRUD, importación masiva Excel/CSV con validación, y el **código estudiantil**
único por institución que viaja en el QR. Regla clave: si el código cambia, los QR viejos
deben seguir funcionando (historial de códigos).

- `domain/student.ts` — entidad, datos de creación, puerto `StudentRepository`
  (incluye `findByCodeIncludingHistory` y `createMany`) y validación (`isValidStudentCode`, `ID_TYPES`).
- `application/students.ts` — `CreateStudent`, `ListStudents`, `ChangeStudentCode`
  (registra historial) e `ImportStudents` (valida fila a fila, no aborta ante errores).
- `infrastructure/` — repo Prisma (soft delete + transacción para cambio de código),
  `csv.ts` (parser nativo, separador `,`/`;`, encabezados con sinónimos/tildes) y container.

UI en `src/app/(dashboard)/admin/students`. **Importación: por ahora solo CSV**; el
`ImportStudents` opera sobre filas ya parseadas, así que añadir XLSX es solo un parser más
que alimente `StudentImportRow[]` (pendiente).
