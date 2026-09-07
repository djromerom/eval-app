import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, NotFoundError, ValidationError, fail, ok } from "@/shared/domain/result";
import type { GroupRepository, PeriodRepository } from "@/modules/academic/domain/types";
import type { BookletTypeRepository } from "@/modules/booklet-types/domain/booklet-type";
import {
  type CreateStudentData,
  type ImportResult,
  type Student,
  type StudentImportRow,
  type StudentRepository,
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
}

/**
 * Importación masiva con validación fila a fila (§3.2). No aborta ante errores:
 * inserta las filas válidas y reporta las inválidas para corrección.
 */
export class ImportStudents implements UseCase<ImportStudentsInput, ImportResult> {
  constructor(
    private readonly students: StudentRepository,
    private readonly groups: GroupRepository,
    private readonly periods: PeriodRepository,
    private readonly bookletTypes: BookletTypeRepository,
  ) {}

  async execute({ actor, rows }: ImportStudentsInput): Promise<Result<ImportResult>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (rows.length === 0) return fail(new ValidationError("El archivo no tiene filas."));

    const groups = await this.groups.findAll(actor.institutionId);
    const groupByName = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));

    const result: ImportResult = { created: 0, errors: [] };
    const valid: CreateStudentData[] = [];
    const seenCodes = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const line = i + 2; // +1 por índice base 1, +1 por la fila de encabezado
      const basicError = validateBasics(row);
      if (basicError) {
        result.errors.push({ row: line, message: basicError });
        continue;
      }
      const groupId = groupByName.get(row.groupName.trim().toLowerCase());
      if (!groupId) {
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

      if (seenCodes.has(row.code)) {
        result.errors.push({ row: line, message: `Código "${row.code}" duplicado en el archivo.` });
        continue;
      }
      if (await this.students.findByCode(actor.institutionId, row.code)) {
        result.errors.push({ row: line, message: `Código "${row.code}" ya existe.` });
        continue;
      }
      seenCodes.add(row.code);
      valid.push({
        groupId,
        lastName1: row.lastName1.trim(),
        lastName2: row.lastName2.trim(),
        firstName1: row.firstName1.trim(),
        firstName2: row.firstName2.trim(),
        idType: row.idType.trim(),
        idNumber: row.idNumber.trim(),
        code: row.code,
        enrollmentYear: row.enrollmentYear,
        grade: row.grade.trim() || null,
        bookletTypeId,
      });
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
