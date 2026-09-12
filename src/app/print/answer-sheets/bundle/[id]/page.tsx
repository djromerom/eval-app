import type { Metadata } from "next";
import "@/styles/print.css";
import "@/styles/answer-sheet.css";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import {
  buildSignedQrContent,
  generateQrDataUrl,
} from "@/modules/printing/infrastructure/qr-generator";
import { listPositionByName } from "@/modules/students/domain/student";
import { normalizeStudentIds } from "../../../_lib/search-params";
import { AutoPrint } from "@/app/print/_components/auto-print";

export const metadata: Metadata = { title: "Hojas de respuestas del cuadernillo" };

const KEYS = ANSWER_KEYS_ORDER;

// Formato corto DD/MM/YYYY (es-CO) para el campo "Fecha:" de la hoja de
// respuestas unificada del cuadernillo (sep 2026).
const dateFmtShort = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Reparte en 1–3 columnas (sep 2026). Regla del docente:
 *  - chunks de 40 preguntas por columna (no equitativo)
 *  - máximo 3 columnas
 *  - la última columna absorbe el resto
 *
 *  Antes: siempre 3 columnas equitativas (`Math.ceil(N/3)` cada una).
 *
 *  La hoja unificada del bundle trata TODAS las preguntas como una sola
 *  lista plana, ignorando secciones y formulaciones: la numeración va
 *  1..N de corrido de izquierda a derecha y de arriba abajo. */
function splitIntoColumns<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]];
  const CHUNK = 40;
  const MAX_COLS = 3;
  const cols: T[][] = [];
  for (let i = 0; i < MAX_COLS && i * CHUNK < items.length; i++) {
    // Última iteración posible (cap 3) o última con datos: absorbe todo
    // el resto en lugar de cortar exactamente en CHUNK.
    const isLastSlot = i === MAX_COLS - 1 || (i + 1) * CHUNK >= items.length;
    const end = isLastSlot ? items.length : (i + 1) * CHUNK;
    cols.push(items.slice(i * CHUNK, end));
  }
  return cols;
}

interface BundleQuestionRow {
  /** Posición global dentro de la hoja (1..N). */
  globalNumber: number;
  /** Etiqueta local de la pregunta (dentro de su formulación). */
  localNumber: number;
  /** Número de opciones para el ancho de fila (2..8). */
  optionsLength: number;
  questionId: string;
}

/**
 * Render server-side de la hoja de respuestas UNIFICADA del cuadernillo.
 * Lo abre el worker de Puppeteer con un token firmado (kind = "answer-sheets-bundle").
 *
 * Numeración 1..N contínua a través de TODAS las preguntas de TODAS las
 * formulaciones y secciones del cuadernillo (sin separadores por sección,
 * sin reinicio por formulación). El QR lleva `bundle` (no `eval`) para que
 * el OMR worker pueda reconstruir el orden global al calificar
 * (ver Sprint 2 del módulo cuadernillos).
 *
 * La distribución en 3 columnas replica exactamente el estilo del PDF
 * institucional de I.E. María Doraliza López de Mejía: la lista plana se
 * parte en 3 grupos verticalmente (1..N/3, N/3+1..2N/3, 2N/3+1..N).
 */
export default async function BundleAnswerSheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ students?: string | string[]; t?: string }>;
}) {
  const { id } = await params;
  const { students: studentIds, t } = await searchParams;

  const actor = await resolvePrintActor(t, { bundleId: id, kind: "answer-sheets-bundle" });

  const [bundleRes, instRes] = await Promise.all([
    makeGetBundle().execute({ actor, bundleId: id }),
    makeGetMyInstitution().execute({ actor }),
  ]);
  if (!bundleRes.ok) notFound();

  const bundle = bundleRes.value;
  const institutionName = instRes.ok ? instRes.value.name : "";
  const institutionCode = instRes.ok ? instRes.value.code : "";

  const ids = normalizeStudentIds(studentIds);
  const students =
    ids.length > 0
      ? await prisma.student.findMany({
          where: { id: { in: ids }, institutionId: actor.institutionId },
          // Grupo + curso del grupo: la hoja de respuestas unificada del
          // cuadernillo muestra "Grado: {course} - {group}" (sep 2026).
          include: {
            group: { include: { course: { select: { name: true } } } },
          },
        })
      : [];

  if (students.length === 0) notFound();

  // "Número de lista" prefijo en el campo Nombre. Misma estrategia batch
  // por grupos que en bulk-answer-sheets (ver comentarios allá).
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

  // Cargar questions de cada evaluation del bundle en orden y aplanarlas.
  // Numeramos de corrido 1..N ignorando secciones y formulaciones. Esto hace
  // N+1 queries; aceptable para una hoja de respuestas que se imprime una vez
  // por período. Si se vuelve cuello de botella, batch con
  // prisma.evaluation.findMany + include.
  const flatQuestions: BundleQuestionRow[] = [];
  let globalCounter = 1;
  for (const item of bundle.items) {
    const evaluation = await prisma.evaluation.findUnique({
      where: { id: item.evaluationId },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: {
            questions: {
              orderBy: { number: "asc" },
              include: { options: { orderBy: { key: "asc" } } },
            },
          },
        },
      },
    });
    if (!evaluation) continue;
    for (const section of evaluation.sections) {
      for (const q of section.questions) {
        flatQuestions.push({
          globalNumber: globalCounter++,
          localNumber: q.number,
          optionsLength: q.options.length,
          questionId: q.id,
        });
      }
    }
  }

  const totalQuestions = flatQuestions.length;
  const columns = splitIntoColumns(flatQuestions);

  // Generar QR por estudiante con payload {bundle, ...} (no eval).
  const sheets = await Promise.all(
    students.map(async (student) => {
      const qrPayload = {
        inst: institutionCode,
        bundle: bundle.id,
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
      <AutoPrint />
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          {students.length} hoja(s) de respuestas para el cuadernillo &laquo;{bundle.name}&raquo; (
          {totalQuestions} preguntas, {bundle.items.length} formulación
          {bundle.items.length === 1 ? "" : "es"})
        </span>
      </div>

      {sheets.map(({ student, qrDataUrl }) => (
        <section key={student.id} className="sheet answer-sheet-content">
          <div className="as-header">
            <div className="as-institution">{institutionName}</div>
            <div className="as-title">
              {bundle.name}
              {bundle.bookletNumber ? ` — Cuadernillo ${bundle.bookletNumber}` : ""}
            </div>
          </div>

          <div className="as-body">
            {/* QR + student fields */}
            <div className="as-left">
              {/* `data-omr-qr` lo lee el capturador de geometría (Puppeteer)
                  para registrar la hoja escaneada contra esta plantilla.
                  No afecta al render. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR" className="as-qr" data-omr-qr="1" />
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
                  {/* Sprint evaluación de prueba (sep 2026): si el cuadernillo
                      tiene `evaluationDate`, se imprime en formato DD/MM/YYYY.
                      Si es null, NO se renderiza el bloque "Fecha:" en
                      absoluto — ni siquiera la línea vacía. Pedido explícito
                      del docente. */}
                  {bundle.evaluationDate ? (
                    <>
                      <span>Fecha:</span>
                      <span className="as-line-filled">
                        {dateFmtShort.format(bundle.evaluationDate)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Grid de burbujas (3 columnas, estilo PDF institucional).
                Numeración 1..N plana — sin separadores por sección/formulación. */}
            <div
              className="as-grid"
              style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
            >
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="as-col">
                  {col.map((q) => (
                    <div key={q.questionId} className="as-col-row">
                      <div className="as-col-num">{q.globalNumber}</div>
                      {KEYS.slice(0, q.optionsLength).map((k) => (
                        <div key={k} className="as-col-bubble">
                          {/* `data-omr-q` / `data-omr-key` permiten al
                              capturador de geometría medir cada burbuja del
                              render REAL y asociarla a (pregunta, opción)
                              sin ambigüedad. Son atributos data-*: no
                              cambian nada de lo que se imprime. */}
                          <div className="omr-bubble" data-omr-q={q.globalNumber} data-omr-key={k}>
                            {k}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
