import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, NotFoundError, ValidationError, fail, ok } from "@/shared/domain/result";
import type { GroupRepository, PeriodRepository } from "@/modules/academic/domain/types";
import type { BookletTypeRepository } from "@/modules/booklet-types/domain/booklet-type";
import { normalizeBookletTypeName } from "@/modules/booklet-types/domain/booklet-type";
import {
  type CreateStudentData,
  type ImportResult,
  type Student,
  type StudentImportRow,
  type StudentRepository,
  type StudentRosterPatch,
  type UpdateStudentData,
  isValidIdType,
  isValidStudentCode,
} from "../domain/student";

function validateBasics(data: {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string;
  code: string;
  enrollmentYear: number;
}): string | null {
  if (!data.lastName1.trim()) return "El apellido 1 es obligatorio.";
  if (!data.firstName1.trim()) return "El nombre 1 es obligatorio.";
  if (!isValidIdType(data.idType)) return `Tipo de documento inválido: "${data.idType}".`;
  if (!isValidStudentCode(data.code)) {
    return `Código inválido "${data.code}" (alfanumérico, sin espacios, máx. 32).`;
  }
  if (!Number.isInteger(data.enrollmentYear) || data.enrollmentYear < 1990) {
    return "Año de ingreso inválido.";
  }
  return null;
}

export interface CreateStudentInput {
  actor: AuthenticatedUser;
  data: CreateStudentData;
}

/** Alta individual de estudiante (ADMIN). REQUERIMIENTOS_v2.md §3.2. */
export class CreateStudent implements UseCase<CreateStudentInput, Student> {
  constructor(
    private readonly students: StudentRepository,
    private readonly groups: GroupRepository,
  ) {}

  async execute({ actor, data }: CreateStudentInput): Promise<Result<Student>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const error = validateBasics(data);
    if (error) return fail(new ValidationError(error));

    const group = await this.groups.findById(actor.institutionId, data.groupId);
    if (!group) return fail(new ValidationError("El grupo indicado no existe en tu institución."));

    if (await this.students.findByCode(actor.institutionId, data.code)) {
      return fail(new ValidationError(`Ya existe un estudiante con el código "${data.code}".`));
    }

    return ok(await this.students.create(actor.institutionId, data));
  }
}

export interface ListStudentsInput {
  actor: AuthenticatedUser;
  groupId?: string;
}

export class ListStudents implements UseCase<ListStudentsInput, Student[]> {
  constructor(private readonly students: StudentRepository) {}

  async execute({ actor, groupId }: ListStudentsInput): Promise<Result<Student[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "TEACHER");
    if (!authorized.ok) return authorized;
    const list = groupId
      ? await this.students.findByGroup(actor.institutionId, groupId)
      : await this.students.findAll(actor.institutionId);
    return ok(list);
  }
}

export interface ChangeStudentCodeInput {
  actor: AuthenticatedUser;
  studentId: string;
  newCode: string;
}

/** Cambia el código de un estudiante conservando el historial (§3.2). */
export class ChangeStudentCode implements UseCase<ChangeStudentCodeInput, Student> {
  constructor(private readonly students: StudentRepository) {}

  async execute({ actor, studentId, newCode }: ChangeStudentCodeInput): Promise<Result<Student>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!isValidStudentCode(newCode)) {
      return fail(new ValidationError("Código nuevo inválido."));
    }
    const student = await this.students.findById(actor.institutionId, studentId);
    if (!student) return fail(new ValidationError("El estudiante no existe en tu institución."));
    if (student.code === newCode) return ok(student);

    const clash = await this.students.findByCode(actor.institutionId, newCode);
    if (clash) return fail(new ValidationError(`El código "${newCode}" ya está en uso.`));

    await this.students.changeCode(actor.institutionId, studentId, newCode);
    return ok({ ...student, code: newCode });
  }
}

export interface ImportStudentsInput {
  actor: AuthenticatedUser;
  rows: StudentImportRow[];
  /** Columnas canónicas presentes en el encabezado del archivo. Si no se
   *  informa, se asumen todas (compat con el import original, donde cada
   *  fila traía todos los campos). */
  present?: (keyof StudentImportRow)[];
}

/** Columnas que el encabezado DEBE traer para que el archivo sirva:
 *  el código (clave de cruce con el QR) y los nombres. El tipo de
 *  documento y el año de ingreso solo hacen falta para CREAR estudiantes
 *  nuevos: si el código ya existe, se actualiza con lo que sí trae el
 *  archivo. */
export const COLUMNAS_IMPRESCINDIBLES: (keyof StudentImportRow)[] = [
  "lastName1",
  "firstName1",
  "code",
  "groupName",
];

/** Valida SOLO los campos que el archivo trae (modo actualizar). Los campos
 *  ausentes no se tocan, así que no se validan. Las celdas vacías se
 *  ignoran en vez de bloquear la fila: el resto de la fila (p. ej. el tipo
 *  de cuadernillo) sí debe poder actualizarse. */
function validateRosterUpdate(
  row: StudentImportRow,
  campos: ReadonlySet<keyof StudentImportRow>,
): string | null {
  if (campos.has("lastName1") && !row.lastName1.trim()) return "El apellido 1 es obligatorio.";
  if (campos.has("firstName1") && !row.firstName1.trim()) return "El nombre 1 es obligatorio.";
  if (campos.has("idType") && row.idType.trim() && !isValidIdType(row.idType.trim())) {
    return `Tipo de documento inválido: "${row.idType}".`;
  }
  if (
    campos.has("enrollmentYear") &&
    row.enrollmentYear &&
    (!Number.isInteger(row.enrollmentYear) || row.enrollmentYear < 1990)
  ) {
    return "Año de ingreso inválido.";
  }
  return null;
}

/**
 * Importación masiva con validación fila a fila (§3.2). No aborta ante errores:
 * inserta las filas válidas y reporta las inválidas para corrección.
 *
 * Modo crear-o-actualizar: si el código ya existe (el QR del estudiante),
 * la fila ACTUALIZA al estudiante en vez de duplicarlo. La actualización
 * escribe SOLO los campos que el archivo trae y NUNCA toca el código, el
 * grupo, el estado activo ni la baja lógica — así la historia de las
 * pruebas anteriores queda intacta.
 */
export class ImportStudents implements UseCase<ImportStudentsInput, ImportResult> {
  constructor(
    private readonly students: StudentRepository,
    private readonly groups: GroupRepository,
    private readonly periods: PeriodRepository,
    private readonly bookletTypes: BookletTypeRepository,
  ) {}

  async execute({ actor, rows, present }: ImportStudentsInput): Promise<Result<ImportResult>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (rows.length === 0) return fail(new ValidationError("El archivo no tiene filas."));

    const groups = await this.groups.findAll(actor.institutionId);
    const groupByName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]));
    const groupNameById = new Map(groups.map((g) => [g.id, g.name.trim()]));

    // Columnas que trae el archivo. Si no se informan, se asumen todas
    // (comportamiento del import original).
    const campos = new Set<keyof StudentImportRow>(
      present ?? (Object.keys(rows[0]!) as (keyof StudentImportRow)[]),
    );

    const result: ImportResult = { created: 0, updated: 0, warnings: [], errors: [] };
    const valid: CreateStudentData[] = [];
    const patches: StudentRosterPatch[] = [];
    const seenCodes = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const line = i + 2; // +1 por índice base 1, +1 por la fila de encabezado

      // 1. El código es la clave de cruce (viaja dentro del QR). Siempre
      //    obligatorio: sin él no sabemos a quién actualizar.
      const code = row.code.trim();
      if (!isValidStudentCode(code)) {
        result.errors.push({
          row: line,
          message: `Código inválido "${row.code}" (alfanumérico, sin espacios, máx. 32).`,
        });
        continue;
      }
      if (seenCodes.has(code)) {
        result.errors.push({ row: line, message: `Código "${row.code}" duplicado en el archivo.` });
        continue;
      }
      seenCodes.add(code);

      // 2. ¿El estudiante ya existe? → actualizar. Si no → crear.
      const existing = await this.students.findByCode(actor.institutionId, code);
      if (!existing) {
        // El código puede ser un código ANTIGUO de un estudiante (historial
        // de QR). Crear otro con ese código duplicaría a la persona, así que
        // la fila se rechaza y el docente cambia el código desde la ficha.
        const historico = await this.students.findByCodeIncludingHistory(actor.institutionId, code);
        if (historico) {
          result.errors.push({
            row: line,
            message: `El código "${row.code}" es un código antiguo del estudiante; actualiza su código antes de importarlo.`,
          });
          continue;
        }
      }

      // 3. Validación: el alta exige todos los datos; la actualización solo
      //    valida los campos que el archivo realmente trae.
      const basicError = existing ? validateRosterUpdate(row, campos) : validateBasics(row);
      if (basicError) {
        result.errors.push({ row: line, message: basicError });
        continue;
      }

      // 4. Grupo: obligatorio para el alta. En la actualización NO se mueve
      //    (los informes históricos por grupo leen el grupo actual): solo
      //    se avisa si no coincide.
      const groupName = row.groupName.trim();
      const groupId = groupName ? groupByName.get(groupName.toLowerCase()) : undefined;
      if (!existing && !groupId) {
        result.errors.push({ row: line, message: `Grupo "${row.groupName}" no encontrado.` });
        continue;
      }

      // Resolución de bookletTypeName → id. El docente DEBE traer la
      // columna PRUEBA (periodName) si trae TIPO DE CUADERNILLO, porque
      // un mismo nombre (ej. "ESTANDAR") puede existir en varias Pruebas
      // y no queremos atar al estudiante a un periodo equivocado.
      let bookletTypeId: string | null = null;
      const bookletTypeName = row.bookletTypeName.trim();
      if (bookletTypeName) {
        const periodName = row.periodName.trim();
        if (!periodName) {
          result.errors.push({
            row: line,
            message: `Falta la Prueba (columna PRUEBA) para identificar el cuadernillo "${bookletTypeName}".`,
          });
          continue;
        }

        const period = await this.periods.findByName(actor.institutionId, periodName);
        if (!period) {
          result.errors.push({
            row: line,
            message: `Prueba "${periodName}" no encontrada en esta institución.`,
          });
          continue;
        }

        const matches = await this.bookletTypes.findByNameAndPeriod(
          actor.institutionId,
          bookletTypeName,
          period.id,
        );

        if (matches.length === 0) {
          // La planilla institucional suele escribir el tipo de cuadernillo
          // con su nombre informal ("Con ajuste razonable" en vez de "Con
          // Ajuste"). Si hay UN SOLO tipo de la Prueba cuyo nombre sea
          // prefijo del del archivo, se usa ese; con cero o varios, la fila
          // se rechaza como hasta ahora.
          const clave = normalizeBookletTypeName(bookletTypeName);
          const candidatos = (
            await this.bookletTypes.listByPeriod(actor.institutionId, period.id)
          ).filter((t) => {
            const nombre = normalizeBookletTypeName(t.name);
            return nombre.length > 0 && clave.startsWith(`${nombre} `);
          });
          if (candidatos.length === 1) matches.push(candidatos[0]!);
        }

        if (matches.length === 0) {
          result.errors.push({
            row: line,
            message: `Tipo de cuadernillo "${bookletTypeName}" no encontrado en la Prueba "${periodName}".`,
          });
          continue;
        }
        if (matches.length > 1) {
          // Solo posible si hay duplicados dentro del mismo periodo (caso
          // borde, el use case CreateBookletType lo evita).
          result.errors.push({
            row: line,
            message: `Múltiples tipos de cuadernillo con nombre "${bookletTypeName}" en la Prueba "${periodName}".`,
          });
          continue;
        }
        bookletTypeId = matches[0]!.id;
      }

      if (existing) {
        // --- ACTUALIZACIÓN ---------------------------------------------
        // Solo se escribe lo que el archivo trae. `code`, `groupId`,
        // `isActive` y `deletedAt` quedan intactos.
        const patch: StudentRosterPatch = { id: existing.id };
        if (campos.has("lastName1")) patch.lastName1 = row.lastName1.trim();
        if (campos.has("lastName2")) patch.lastName2 = row.lastName2.trim();
        if (campos.has("firstName1")) patch.firstName1 = row.firstName1.trim();
        if (campos.has("firstName2")) patch.firstName2 = row.firstName2.trim();
        if (campos.has("idType") && row.idType.trim()) patch.idType = row.idType.trim();
        if (campos.has("idNumber") && row.idNumber.trim()) patch.idNumber = row.idNumber.trim();
        if (campos.has("enrollmentYear") && row.enrollmentYear) {
          patch.enrollmentYear = row.enrollmentYear;
        }
        if (campos.has("grade") && row.grade.trim()) patch.grade = row.grade.trim();
        if (campos.has("bookletTypeName") && bookletTypeName) {
          patch.bookletTypeId = bookletTypeId;
        }
        patches.push(patch);

        if (groupName && !groupId) {
          result.warnings.push({
            row: line,
            message: `Grupo "${groupName}" no encontrado; el estudiante no se movió de grupo.`,
          });
        } else if (groupId && existing.groupId !== groupId) {
          const actual = groupNameById.get(existing.groupId) ?? "?";
          result.warnings.push({
            row: line,
            message: `El grupo del archivo ("${groupName}") no coincide con el del estudiante ("${actual}"); el estudiante no se movió de grupo.`,
          });
        }
        continue;
      }

      // --- ALTA --------------------------------------------------------
      valid.push({
        groupId: groupId!,
        lastName1: row.lastName1.trim(),
        lastName2: row.lastName2.trim(),
        firstName1: row.firstName1.trim(),
        firstName2: row.firstName2.trim(),
        idType: row.idType.trim(),
        idNumber: row.idNumber.trim(),
        code,
        enrollmentYear: row.enrollmentYear,
        grade: row.grade.trim() || null,
        bookletTypeId,
      });
    }

    if (patches.length > 0) {
      result.updated = await this.students.applyRosterPatches(actor.institutionId, patches);
    }
    if (valid.length > 0) {
      result.created = await this.students.createMany(actor.institutionId, valid);
    }
    return ok(result);
  }
}

// ============== Edición / baja (Fase 12 — drawer de estudiante) ==============

export interface GetStudentInput {
  actor: AuthenticatedUser;
  studentId: string;
}

/**
 * Carga un estudiante por id verificando que pertenezca a la institución del
 * actor. Usado por la sub-ruta `/admin/students/[id]/edit` para alimentar el
 * drawer de edición.
 */
export class GetStudent implements UseCase<GetStudentInput, Student> {
  constructor(private readonly students: StudentRepository) {}

  async execute({ actor, studentId }: GetStudentInput): Promise<Result<Student>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const student = await this.students.findById(actor.institutionId, studentId);
    if (!student) return fail(new NotFoundError("Estudiante", studentId));
    return ok(student);
  }
}

export interface UpdateStudentInput {
  actor: AuthenticatedUser;
  studentId: string;
  data: UpdateStudentData;
}

/**
 * Edita los campos editables de un estudiante (NO incluye `code` — ese flujo
 * tiene su propio caso de uso con historial). Valida formato + tenancy del
 * grupo antes de delegar al repositorio.
 */
export class UpdateStudent implements UseCase<UpdateStudentInput, Student> {
  constructor(
    private readonly students: StudentRepository,
    private readonly groups: GroupRepository,
  ) {}

  async execute({ actor, studentId, data }: UpdateStudentInput): Promise<Result<Student>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!data.lastName1.trim()) return fail(new ValidationError("El apellido 1 es obligatorio."));
    if (!data.firstName1.trim()) return fail(new ValidationError("El nombre 1 es obligatorio."));
    if (!data.idNumber.trim())
      return fail(new ValidationError("El número de documento es obligatorio."));
    if (!isValidIdType(data.idType)) {
      return fail(new ValidationError(`Tipo de documento inválido: "${data.idType}".`));
    }
    if (!Number.isInteger(data.enrollmentYear) || data.enrollmentYear < 1990) {
      return fail(new ValidationError("Año de ingreso inválido."));
    }

    const group = await this.groups.findById(actor.institutionId, data.groupId);
    if (!group) return fail(new ValidationError("El grupo indicado no existe en tu institución."));

    const current = await this.students.findById(actor.institutionId, studentId);
    if (!current) return fail(new NotFoundError("Estudiante", studentId));

    return ok(await this.students.update(actor.institutionId, studentId, data));
  }
}

export interface DeleteStudentInput {
  actor: AuthenticatedUser;
  studentId: string;
}

/**
 * Baja lógica: marca `deletedAt` y desactiva. Preserva el historial de
 * códigos — un estudiante dado de baja sigue siendo identificable por su
 * QR viejo.
 */
export class DeleteStudent implements UseCase<DeleteStudentInput, void> {
  constructor(private readonly students: StudentRepository) {}

  async execute({ actor, studentId }: DeleteStudentInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const current = await this.students.findById(actor.institutionId, studentId);
    if (!current) return fail(new NotFoundError("Estudiante", studentId));

    await this.students.softDelete(actor.institutionId, studentId);
    return ok(undefined);
  }
}
