"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { TeacherAssignment } from "@/modules/teachers/domain/teacher";

import {
  addTeacherAssignmentAction,
  removeTeacherAssignmentAction,
  updateTeacherAssignmentAction,
} from "../actions";

/** Tipo de cuadernillo que se puede asignar (con su Prueba y su año). */
export interface AssignmentBookletType {
  id: string;
  name: string;
  periodName: string;
  /** Año académico de la Prueba del tipo — el select solo ofrece los del
   *  año del grado. */
  academicYearId: string;
  year: number;
}

/** Grado disponible para asignar. */
export interface AssignmentCourse {
  id: string;
  name: string;
  academicYearId: string;
  year: number;
}

/** Asignatura enlazada a un grado. */
export interface AssignmentCourseSubject {
  id: string;
  courseId: string;
  subjectName: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

/**
 * Drawer derecho de la fila del docente: lista sus asignaciones y permite
 * editarlas (tipo de cuadernillo), agregar nuevas y eliminar las existentes.
 *
 * Se abre con `?asignaciones=<teacherId>` (mismo patrón que el drawer de
 * importación): el botón de la fila es un `<Link>`, así el estado vive en la
 * URL y el drawer sobrevive a un refresh.
 *
 * El tipo se filtra por el año académico del grado: un tipo de otra Prueba
 * (de otro año) no aplicaría a ninguna formulación de ese grado.
 */
export function TeacherAssignmentsDrawer({
  teachers,
  assignments,
  bookletTypes,
  courses,
  courseSubjects,
}: {
  teachers: { id: string; name: string }[];
  assignments: TeacherAssignment[];
  bookletTypes: AssignmentBookletType[];
  courses: AssignmentCourse[];
  courseSubjects: AssignmentCourseSubject[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const teacherId = params.get("asignaciones");
  const teacher = teachers.find((t) => t.id === teacherId) ?? null;

  const close = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("asignaciones");
    router.push(url.pathname, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && teacherId) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  if (!teacher) return null;

  const propias = assignments.filter((a) => a.teacherId === teacher.id);

  return (
    <>
      <Link
        href="/admin/teachers"
        aria-label="Cerrar drawer"
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
      />
      <aside
        aria-label="Asignaciones del docente"
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l shadow-xl"
      >
        <header className="bg-muted/30 flex items-center justify-between gap-2 border-b p-5">
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Asignaciones
            </p>
            <h1 className="font-display text-xl font-bold">{teacher.name}</h1>
          </div>
          <Link
            href="/admin/teachers"
            aria-label="Cerrar"
            className="hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md border"
          >
            <span aria-hidden>✕</span>
          </Link>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {propias.length === 0 ? (
            <p className="text-muted-foreground text-sm">Este docente no tiene asignaciones.</p>
          ) : (
            <ul className="space-y-3">
              {propias.map((a) => (
                <AssignmentRow key={a.id} assignment={a} bookletTypes={bookletTypes} />
              ))}
            </ul>
          )}

          <AddAssignmentForm
            teacherId={teacher.id}
            courses={courses}
            courseSubjects={courseSubjects}
            bookletTypes={bookletTypes}
          />
        </div>
      </aside>
    </>
  );
}

/** Una asignación editable: grado · asignatura + select de tipo + Guardar. */
function AssignmentRow({
  assignment,
  bookletTypes,
}: {
  assignment: TeacherAssignment;
  bookletTypes: AssignmentBookletType[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(assignment.bookletTypeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = useMemo(() => {
    const delAnio = bookletTypes.filter((bt) => bt.academicYearId === assignment.academicYearId);
    // Si el tipo actual no está entre los del año (dato heredado), se agrega
    // para no perderlo ni-mostrarlo vacío en el select.
    if (assignment.bookletTypeId && !delAnio.some((bt) => bt.id === assignment.bookletTypeId)) {
      delAnio.push({
        id: assignment.bookletTypeId,
        name: assignment.bookletTypeName ?? "",
        periodName: assignment.periodName ?? "",
        academicYearId: assignment.academicYearId,
        year: 0,
      });
    }
    return delAnio;
  }, [assignment, bookletTypes]);

  const guardar = () => {
    setError(null);
    startTransition(async () => {
      const r = await updateTeacherAssignmentAction(assignment.id, value || null);
      if (!r.ok) {
        setError(r.error ?? "Error");
        toast.error(r.error ?? "Error");
        return;
      }
      toast.success("Asignación actualizada.");
      router.refresh();
    });
  };

  return (
    <li className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {assignment.courseName} · {assignment.subjectName}
        </p>
        {assignment.periodName ? (
          <p className="text-muted-foreground text-xs">{assignment.periodName}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1 space-y-1">
          <label
            htmlFor={`booklet-type-${assignment.id}`}
            className="text-muted-foreground block text-xs font-medium"
          >
            Tipo de cuadernillo
          </label>
          <select
            id={`booklet-type-${assignment.id}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={selectClass}
            disabled={pending}
          >
            <option value="">Cualquier cuadernillo</option>
            {options.map((bt) => (
              <option key={bt.id} value={bt.id}>
                {bt.name} · {bt.periodName}
                {bt.year ? ` (${bt.year})` : ""}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" size="sm" onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <RemoveAssignmentButton assignment={assignment} />
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </li>
  );
}

/** Botón "Eliminar" + diálogo de confirmación de la asignación. */
function RemoveAssignmentButton({ assignment }: { assignment: TeacherAssignment }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eliminar = () => {
    setError(null);
    startTransition(async () => {
      const r = await removeTeacherAssignmentAction(assignment.id);
      if (!r.ok) {
        setError(r.error ?? "Error");
        toast.error(r.error ?? "Error");
        return;
      }
      setOpen(false);
      toast.success("Asignación eliminada.");
      router.refresh();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Eliminar asignación ${assignment.courseName} ${assignment.subjectName}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-destructive hover:text-destructive",
          )}
          disabled={pending}
        >
          <Trash2 className="size-3.5" />
          Eliminar
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar asignación</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a eliminar la asignación de {assignment.courseName} · {assignment.subjectName}. El
            docente deja de dictar esa asignatura-grado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={eliminar}
            disabled={pending}
          >
            {pending ? "Eliminando…" : "Eliminar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Alta de una asignación nueva para el docente del drawer. */
function AddAssignmentForm({
  teacherId,
  courses,
  courseSubjects,
  bookletTypes,
}: {
  teacherId: string;
  courses: AssignmentCourse[];
  courseSubjects: AssignmentCourseSubject[];
  bookletTypes: AssignmentBookletType[];
}) {
  const router = useRouter();
  const [courseId, setCourseId] = useState("");
  const [courseSubjectId, setCourseSubjectId] = useState("");
  const [bookletTypeId, setBookletTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Asignaturas habilitadas en el grado elegido.
  const subjectOptions = useMemo(
    () => courseSubjects.filter((cs) => cs.courseId === courseId),
    [courseSubjects, courseId],
  );

  // Tipos de cuadernillo del año académico del grado elegido.
  const selectedYearId = courses.find((c) => c.id === courseId)?.academicYearId;
  const typeOptions = useMemo(
    () =>
      selectedYearId
        ? bookletTypes.filter((bt) => bt.academicYearId === selectedYearId)
        : bookletTypes,
    [bookletTypes, selectedYearId],
  );

  const handleCourseChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCourseId(e.target.value);
    setCourseSubjectId("");
    setBookletTypeId("");
  };

  const agregar = () => {
    setError(null);
    startTransition(async () => {
      const r = await addTeacherAssignmentAction(
        teacherId,
        courseId,
        courseSubjectId,
        bookletTypeId || null,
      );
      if (!r.ok) {
        setError(r.error ?? "Error");
        toast.error(r.error ?? "Error");
        return;
      }
      setCourseId("");
      setCourseSubjectId("");
      setBookletTypeId("");
      toast.success("Asignación agregada.");
      router.refresh();
    });
  };

  const listo = courseId !== "" && courseSubjectId !== "";

  return (
    <section className="space-y-3 rounded-lg border border-dashed p-4">
      <h2 className="text-sm font-semibold">Agregar asignación</h2>

      <div className="space-y-1">
        <label htmlFor="add-courseId" className="text-muted-foreground block text-xs font-medium">
          Grado
        </label>
        <select
          id="add-courseId"
          value={courseId}
          onChange={handleCourseChange}
          className={selectClass}
          disabled={pending}
        >
          <option value="">—</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.year}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="add-courseSubjectId"
          className="text-muted-foreground block text-xs font-medium"
        >
          Asignatura
        </label>
        <select
          id="add-courseSubjectId"
          value={courseSubjectId}
          onChange={(e) => setCourseSubjectId(e.target.value)}
          className={selectClass}
          disabled={pending || !courseId || subjectOptions.length === 0}
        >
          <option value="">—</option>
          {subjectOptions.map((cs) => (
            <option key={cs.id} value={cs.id}>
              {cs.subjectName}
            </option>
          ))}
        </select>
        {courseId && subjectOptions.length === 0 ? (
          <p className="text-muted-foreground text-xs">Ese grado no tiene asignaturas enlazadas.</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label
          htmlFor="add-bookletTypeId"
          className="text-muted-foreground block text-xs font-medium"
        >
          Tipo de cuadernillo
        </label>
        <select
          id="add-bookletTypeId"
          value={bookletTypeId}
          onChange={(e) => setBookletTypeId(e.target.value)}
          className={selectClass}
          disabled={pending || typeOptions.length === 0}
        >
          <option value="">Cualquier cuadernillo</option>
          {typeOptions.map((bt) => (
            <option key={bt.id} value={bt.id}>
              {bt.name} · {bt.periodName}
              {bt.year ? ` (${bt.year})` : ""}
            </option>
          ))}
        </select>
        {courseId && typeOptions.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Sin tipos configurados: la asignación aplica a cualquier cuadernillo.
          </p>
        ) : null}
      </div>

      <Button type="button" size="sm" onClick={agregar} disabled={pending || !listo}>
        <Plus className="h-3.5 w-3.5" />
        {pending ? "Agregando…" : "Agregar"}
      </Button>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </section>
  );
}
