import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, NotFoundError, ValidationError, fail, ok } from "@/shared/domain/result";
import type { AcademicYear, AcademicYearRepository } from "@/modules/academic/domain/types";
import type { StudentRepository } from "../domain/student";
import type {
  StudentEnrollment,
  StudentEnrollmentRepository,
  UpdateStudentEnrollmentData,
} from "../domain/student-enrollment";

// =========================================================================
// AssignStudentToYear — crea o actualiza la matrícula del estudiante en un
// año académico concreto. Si ya existe una fila (student, academicYear),
// la actualiza; si no, la crea. La nueva fila queda como `isCurrent=true`
// (la transacción en el repo desmarca las demás del mismo estudiante).
// =========================================================================

export interface AssignStudentToYearInput {
  actor: AuthenticatedUser;
  studentId: string;
  academicYearId: string;
  data: {
    groupId: string;
    grade?: string | null;
    bookletTypeId?: string | null;
  };
}

export class AssignStudentToYear implements UseCase<AssignStudentToYearInput, StudentEnrollment> {
  constructor(
    private readonly enrollments: StudentEnrollmentRepository,
    private readonly students: StudentRepository,
    private readonly years: AcademicYearRepository,
  ) {}

  async execute({
    actor,
    studentId,
    academicYearId,
    data,
  }: AssignStudentToYearInput): Promise<Result<StudentEnrollment>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const student = await this.students.findById(actor.institutionId, studentId);
    if (!student) {
      return fail(new NotFoundError("Estudiante", studentId));
    }
    const year = await this.years.findById(actor.institutionId, academicYearId);
    if (!year) {
      return fail(new NotFoundError("Año académico", academicYearId));
    }

    const existing = await this.enrollments.findByStudentAndYear(
      actor.institutionId,
      studentId,
      academicYearId,
    );
    if (existing) {
      // Update in-place: ya estaba matriculado en este año académico.
      // La lógica de "una sola fila vigente por estudiante" se mantiene
      // porque `update` no toca `isCurrent`. Como YA era la fila vigente
      // del estudiante, sigue siéndolo sin necesidad de flip.
      const updated = await this.enrollments.update(actor.institutionId, existing.id, {
        groupId: data.groupId,
        grade: data.grade ?? null,
        bookletTypeId: data.bookletTypeId ?? null,
      } satisfies UpdateStudentEnrollmentData);
      return ok(updated);
    }

    // Nueva matrícula. El repo hace el flip atómico (desmarca las demás
    // del estudiante + marca esta como `isCurrent=true`).
    const created = await this.enrollments.create(actor.institutionId, {
      studentId,
      academicYearId,
      groupId: data.groupId,
      grade: data.grade ?? null,
      bookletTypeId: data.bookletTypeId ?? null,
    });
    return ok(created);
  }
}

// =========================================================================
// ChangeStudentEnrollment — cambia los campos del enrollment VIGENTE del
// estudiante (mismo año académico, misma fila). Usado por edición in-place
// cuando el admin corrige grupo/grado/cuadernillo sin cambiar de año.
// =========================================================================

export interface ChangeStudentEnrollmentInput {
  actor: AuthenticatedUser;
  studentId: string;
  data: {
    groupId?: string;
    grade?: string | null;
    bookletTypeId?: string | null;
  };
}

export class ChangeStudentEnrollment implements UseCase<
  ChangeStudentEnrollmentInput,
  StudentEnrollment
> {
  constructor(
    private readonly enrollments: StudentEnrollmentRepository,
    private readonly students: StudentRepository,
  ) {}

  async execute({
    actor,
    studentId,
    data,
  }: ChangeStudentEnrollmentInput): Promise<Result<StudentEnrollment>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const student = await this.students.findById(actor.institutionId, studentId);
    if (!student) {
      return fail(new NotFoundError("Estudiante", studentId));
    }
    const current = await this.enrollments.findCurrentByStudent(actor.institutionId, studentId);
    if (!current) {
      return fail(
        new ValidationError(
          "El estudiante no tiene matrícula activa. Use AssignStudentToYear para crearla.",
        ),
      );
    }

    const updated = await this.enrollments.update(actor.institutionId, current.id, {
      ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
      ...(data.grade !== undefined ? { grade: data.grade } : {}),
      ...(data.bookletTypeId !== undefined ? { bookletTypeId: data.bookletTypeId } : {}),
    });
    return ok(updated);
  }
}

// =========================================================================
// SetCurrentAcademicYear — promueve un año académico a "actual" dentro de
// la institución, desmarcando los demás. El repo garantiza la unicidad con
// `$transaction([updateMany, update])`.
// =========================================================================

export interface SetCurrentAcademicYearInput {
  actor: AuthenticatedUser;
  academicYearId: string;
}

export class SetCurrentAcademicYear implements UseCase<SetCurrentAcademicYearInput, AcademicYear> {
  constructor(private readonly years: AcademicYearRepository) {}

  async execute({
    actor,
    academicYearId,
  }: SetCurrentAcademicYearInput): Promise<Result<AcademicYear>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const year = await this.years.findById(actor.institutionId, academicYearId);
    if (!year) {
      return fail(new NotFoundError("Año académico", academicYearId));
    }

    // No-op si ya está marcado como actual: ahorra la transacción y deja
    // el estado intacto (importante si el admin hace doble-click).
    if (year.isCurrent) {
      return ok(year);
    }

    await this.years.setCurrent(actor.institutionId, academicYearId);
    return ok({ ...year, isCurrent: true });
  }
}
