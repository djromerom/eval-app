import type { Metadata } from "next";
import "@/styles/print.css";
import "@/styles/answer-sheet.css";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import {
  buildSignedQrContent,
  generateQrDataUrl,
} from "@/modules/printing/infrastructure/qr-generator";
import { listPositionByName } from "@/modules/students/domain/student";
import { normalizeStudentIds } from "../../_lib/search-params";

export const metadata: Metadata = { title: "Hojas de respuestas" };

/** 8 columnas fijas (A–H). Las preguntas con menos opciones dejan las
 *  restantes en blanco. Ver evaluations/domain/evaluation.ts. */
const KEYS = ANSWER_KEYS_ORDER;

/** Reparte en 1–3 columnas (sep 2026). Regla del docente:
 *  - chunks de 40 preguntas por columna (no equitativo)
 *  - máximo 3 columnas
 *  - la última columna absorbe el resto (puede tener < 40 si no se llega,
 *    o > 40 si se supera el cap de 3 × 40 = 120)
 *
 *  Antes: siempre 3 columnas equitativas (`Math.ceil(N/3)` cada una).
 *  Estilo PDF institucional: las preguntas fluyen en orden 1..N de arriba
 *  abajo y de izquierda a derecha. Ver /print/answer-sheet/[evaluationId]
 *  para la otra implementación del mismo patrón. */
function splitIntoColumns<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]];
  const CHUNK = 40;
  const MAX_COLS = 3;
  const cols: T[][] = [];
  for (let i = 0; i < MAX_COLS && i * CHUNK < items.length; i++) {
    const isLastSlot = i === MAX_COLS - 1 || (i + 1) * CHUNK >= items.length;
    const end = isLastSlot ? items.length : (i + 1) * CHUNK;
    cols.push(items.slice(i * CHUNK, end));
  }
  return cols;
}

interface Props {
  params: Promise<{ evaluationId: string }>;
  searchParams: Promise<{ students?: string | string[]; t?: string }>;
}

export default async function BulkAnswerSheetsPage({ params, searchParams }: Props) {
  const { evaluationId } = await params;
  const { students: studentIds, t } = await searchParams;

  const actor = await resolvePrintActor(t, { evaluationId, kind: "answer-sheets" });

  const [evalRes, instRes] = await Promise.all([
    makeGetEvaluation().execute({ actor, id: evaluationId }),
    makeGetMyInstitution().execute({ actor }),
  ]);
  if (!evalRes.ok) notFound();

  const evaluation = evalRes.value;
  const institutionName = instRes.ok ? instRes.value.name : "";
  const institutionCode = instRes.ok ? instRes.value.code : "";

  const ids = normalizeStudentIds(studentIds);
  const students =
    ids.length > 0
      ? await prisma.student.findMany({
          where: { id: { in: ids }, institutionId: actor.institutionId },
          // Grupo + curso del grupo: la hoja bulk muestra
          // "Grado: {course} - {group}" (sep 2026).
          include: {
            group: { include: { course: { select: { name: true } } } },
          },
        })
      : [];

  if (students.length === 0) notFound();

  // "Número de lista" prefijo en el campo Nombre. Se computa en una sola
  // query batch por grupos: los N estudiantes seleccionados pueden venir
  // de grupos distintos (decenas de grupos en una sola impresión masiva).
  // Agrupamos por groupId, bajamos todos los compañeros en una sola query,
  // y resolvemos la posición de cada estudiante en su grupo.
  const numeroDeListaPorEstudiante = new Map<string, number>();
  const gruposDistintos = [
    ...new Set(students.map((s) => s.groupId).filter((g): g is string => !!g)),
  ];
  if (gruposDistintos.length > 0) {
    const companeros = await prisma.student.findMany({
      where: {
        institutionId: actor.institutionId,
        groupId: { in: gruposDistintos },
      },
      select: {
        id: true,
        groupId: true,
        lastName1: true,
        lastName2: true,
        firstName1: true,
        firstName2: true,
      },
    });
    const companerosPorGrupo = new Map<string, typeof companeros>();
    for (const c of companeros) {
      const lista = companerosPorGrupo.get(c.groupId) ?? [];
      lista.push(c);
      companerosPorGrupo.set(c.groupId, lista);
    }
    for (const s of students) {
      const mates = companerosPorGrupo.get(s.groupId);
      if (!mates) continue;
      const pos = listPositionByName(mates, s.id);
      if (pos !== null) numeroDeListaPorEstudiante.set(s.id, pos);
    }
  }

  const allQuestions = evaluation.sections.flatMap((s) => s.questions);
  const columns = splitIntoColumns(allQuestions);

  // Generar QR para cada estudiante
  const sheets = await Promise.all(
    students.map(async (student) => {
      const qrPayload = {
        inst: institutionCode,
        eval: evaluation.id,
        student: student.code,
        sheet: crypto.randomUUID(),
        ts: Date.now(),
      };
      const signed = buildSignedQrContent(qrPayload);
      const qrDataUrl = await generateQrDataUrl(signed);
      return { student, qrDataUrl };
    }),
  );

  return (
    <div className="booklet">
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          {students.length} hoja(s) de respuestas para {evaluation.title}
        </span>
      </div>

      {sheets.map(({ student, qrDataUrl }, idx) => (
        <section key={student.id} className="sheet answer-sheet-content">
          <div className="as-header">
            <div className="as-institution">{institutionName}</div>
            <div className="as-title">{evaluation.title}</div>
          </div>

          <div className="as-body">
            {/* QR + student fields */}
            <div className="as-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR" className="as-qr" />
              <div className="as-student-fields">
                <div className="as-field">
                  <span>Nombre:</span>
                  <span className="as-line-filled">
                    {(() => {
                      const base = `${student.lastName1} ${student.lastName2} ${student.firstName1} ${student.firstName2}`
                        .replace(/\s+/g, " ")
                        .trim();
                      const num = numeroDeListaPorEstudiante.get(student.id);
                      return num !== undefined ? `${num}. ${base}` : base;
                    })()}
                  </span>
                </div>
                {/* Grado + Grupo concatenados (sep 2026). Si el estudiante no
                    tiene grupo asignado o el grupo no tiene curso, se omite
                    la línea entera en vez de mostrar un campo a medias. */}
                {student.group?.course?.name && student.group.name ? (
                  <div className="as-field">
                    <span>Grado:</span>
                    <span className="as-line-filled">
                      {`${student.group.course.name} - ${student.group.name}`}
                    </span>
                  </div>
                ) : null}
                <div className="as-field">
                  <span>Código:</span>
                  <span className="as-line-filled">{student.code}</span>
                </div>
                <div className="as-field">
                  <span>Fecha:</span>
                  <span className="as-line" />
                </div>
              </div>
            </div>

            {/* 1–3 columnas de burbujas según `splitIntoColumns` (sep 2026).
                Estilo PDF institucional. */}
            <div
              className="as-grid"
              style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
            >
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="as-col">
                  {col.map((q) => (
                    <div key={q.id} className="as-col-row">
                      <div className="as-col-num">{q.number}</div>
                      {KEYS.slice(0, q.options.length).map((k) => (
                        <div key={k} className="as-col-bubble">
                          <div className="omr-bubble">{k}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="as-footer">
            Hoja {idx + 1} de {sheets.length}
          </div>
        </section>
      ))}
    </div>
  );
}
