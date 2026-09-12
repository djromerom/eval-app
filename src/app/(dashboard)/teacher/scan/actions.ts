"use server";

import { revalidatePath } from "next/cache";
import { nombreDeArchivo } from "@/modules/scanning/domain/scan-filename";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { getOmrScanQueue } from "@/shared/infrastructure/queue/queues";
import { requireAuthenticatedUser } from "@/lib/session";
import { nombreCompleto } from "@/modules/students/domain/nombre-completo";
import { env } from "@/config/env";
import { OmrServiceQrDecoder } from "@/modules/scanning/infrastructure/omr-service-qr-decoder";
import { verifySignature, deriveInstitutionSecret } from "@/shared/infrastructure/crypto/hmac";
import {
  clasificarHojas,
  MOTIVOS,
  type LecturaDeHoja,
  type MotivoSinClasificar,
} from "@/modules/scanning/domain/clasificar-hojas";

/** Tipo discriminado del "objetivo" del escaneo: o una formulación
 *  individual (legacy) o un cuadernillo. La invariante XOR vive aquí. */
export type ScanTargetKind = "evaluation" | "bundle";

/** Un lote creado por el modo automático, uno por cuadernillo detectado. */
export interface LoteCreado {
  batchId: string;
  cuadernillo: string;
  hojas: number;
}

/** Archivo que no se pudo atribuir a ningún cuadernillo. El archivo se guardó;
 *  lo que no existe es su `AnswerSheet` (ver `createAutoScanBatches`). */
export interface HojaRechazada {
  nombre: string;
  motivo: string;
}

export type CrearLoteResultado =
  | { ok: true; batchId: string; lotes?: LoteCreado[]; rechazadas?: HojaRechazada[] }
  | { ok: false; error: string };

export async function createScanBatchAction(formData: FormData): Promise<CrearLoteResultado> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  const kind = formData.get("kind") as ScanTargetKind | "auto" | null;
  const targetId = formData.get("id") as string | null;
  const files = formData.getAll("files") as File[];

  // El modo automático no lleva objetivo: cada hoja lo trae en su QR.
  if (kind === "auto") {
    if (files.length === 0) {
      return { ok: false as const, error: "Selecciona al menos un archivo." };
    }
    return createAutoScanBatches(actor, files);
  }

  if (!kind || !targetId || files.length === 0) {
    return {
      ok: false as const,
      error: "Selecciona un objetivo (formulación o cuadernillo) y al menos un archivo.",
    };
  }

  if (kind === "evaluation") {
    return createEvaluationScanBatch(actor, targetId, files);
  }
  if (kind === "bundle") {
    return createBundleScanBatch(actor, targetId, files);
  }
  return { ok: false as const, error: `Tipo de objetivo no soportado: ${kind}` };
}

async function createEvaluationScanBatch(
  actor: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  evaluationId: string,
  files: File[],
) {
  if (files.length > 200) {
    return { ok: false as const, error: "Máximo 200 hojas por lote." };
  }

  const evaluation = await prisma.evaluation.findFirst({
    where: {
      id: evaluationId,
      institutionId: actor.institutionId,
      teacherId: actor.userId,
      deletedAt: null,
    },
  });
  if (!evaluation) {
    return { ok: false as const, error: "Formulación no encontrada." };
  }

  const batch = await prisma.scanBatch.create({
    data: {
      institutionId: actor.institutionId,
      evaluationId,
      bundleId: null,
      uploadedBy: actor.userId,
      status: "PENDING",
      totalSheets: files.length,
      processedSheets: 0,
    },
  });

  await enqueueSheets(actor, batch.id, files, "evaluation", evaluationId);
  revalidatePath("/teacher/scan");
  return { ok: true as const, batchId: batch.id };
}

async function createBundleScanBatch(
  actor: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  bundleId: string,
  files: File[],
) {
  if (files.length > 200) {
    return { ok: false as const, error: "Máximo 200 hojas por lote." };
  }

  const bundle = await prisma.evaluationBundle.findFirst({
    where: {
      id: bundleId,
      institutionId: actor.institutionId,
    },
    select: { id: true, status: true, name: true },
  });
  if (!bundle) {
    return { ok: false as const, error: "Cuadernillo no encontrado." };
  }
  // Solo cuadernillos READY tienen clave unificada generada y admiten
  // calificación. Mismo chequeo que el reportador comparativo.
  if (bundle.status !== "READY") {
    return {
      ok: false as const,
      error: `El cuadernillo debe estar en estado LISTO para escanear (actual: ${bundle.status}).`,
    };
  }

  const batch = await prisma.scanBatch.create({
    data: {
      institutionId: actor.institutionId,
      evaluationId: null,
      bundleId,
      uploadedBy: actor.userId,
      status: "PENDING",
      totalSheets: files.length,
      processedSheets: 0,
    },
  });

  await enqueueSheets(actor, batch.id, files, "bundle", bundleId);
  revalidatePath("/teacher/scan");
  return { ok: true as const, batchId: batch.id };
}

/** Crea AnswerSheet + encola job omr-scan. `targetKind` discrimina si la
 *  hoja es de formulación o bundle, y `targetId` se guarda en AnswerSheet
 *  para que el reporte comparativo del cuadernillo pueda drill-dowmear
 *  (student/hoja × item). */

async function enqueueSheets(
  actor: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  batchId: string,
  files: File[],
  targetKind: ScanTargetKind,
  targetId: string,
) {
  const queue = getOmrScanQueue();
  const batchDir = `scans/${batchId}`;

  // Nombres ya usados en este lote. El timestamp solo da unicidad si dos
  // archivos no caen en el mismo milisegundo, y un lote se sube en rafaga: sin
  // esto dos hojas podrian pisarse en silencio, que es exactamente el modo de
  // falla que ya nos costo un lote entero de artefactos.
  const usados = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const bytes = Buffer.from(await file.arrayBuffer());
    const relativePath = `${batchDir}/${nombreDeArchivo(file.name, i, usados)}`;
    await localStorage.save(relativePath, bytes);

    const sheet = await prisma.answerSheet.create({
      data: {
        evaluationId: targetKind === "evaluation" ? targetId : null,
        bundleId: targetKind === "bundle" ? targetId : null,
        studentId: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: relativePath,
        // El archivo se guarda renombrado a sheet_NNN.ext, asi que sin esto el
        // nombre que salio del escaner se perderia y no habria forma de
        // rastrear una hoja hasta su origen. `file.name` puede venir vacio si
        // el cliente sube un Blob sin nombre: en ese caso se deja null.
        originalFilename: file.name || null,
        scanBatchId: batchId,
        status: "PENDING",
      },
    });

    await queue.add("omr-scan", {
      answerSheetId: sheet.id,
      scanBatchId: batchId,
      institutionId: actor.institutionId,
      imagePath: relativePath,
    });
  }
}

export interface BatchWithSheets {
  id: string;
  /** "evaluation" si el batch es de una formulación, "bundle" si es de un
   *  cuadernillo, "unknown" si la FK quedó null por datos legacy. */
  kind: ScanTargetKind | "unknown";
  status: string;
  totalSheets: number;
  processedSheets: number;
  createdAt: Date;
  /** Nombre del objetivo (formulación o cuadernillo). null si no se pudo
   *  resolver (huérfanos o datos legacy). */
  title: string | null;
  sheets: {
    id: string;
    status: string;
    studentName: string | null;
    studentCode: string | null;
    score: number | null;
    totalCorrect: number | null;
    totalQuestions: number | null;
    reviewedBy: string | null;
    notes: string | null;
  }[];
}

export async function getBatchesAction(): Promise<BatchWithSheets[]> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  // Filtro multi-target: el batch pertenece a la institución y:
  //   - es de una formulación del docente actual, o
  //   - es de un cuadernillo de la institución (cualquier docente del
  //     colegio puede escanear, los cuadernillos son institucionales).
  const rows = await prisma.scanBatch.findMany({
    where: {
      institutionId: actor.institutionId,
      OR: [
        { evaluation: { teacherId: actor.userId, deletedAt: null } },
        { bundle: { institutionId: actor.institutionId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      evaluation: { select: { title: true } },
      bundle: { select: { name: true } },
      sheets: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          studentName: true,
          studentCode: true,
          // El QR resuelve `studentId`; el nombre vive en Student. Sin este
          // join el listado mostraba "—" en Estudiante y Código aunque la
          // hoja estuviera perfectamente identificada.
          student: {
            select: {
              code: true,
              lastName1: true,
              lastName2: true,
              firstName1: true,
              firstName2: true,
            },
          },
          score: true,
          totalCorrect: true,
          totalQuestions: true,
          reviewedBy: true,
          notes: true,
        },
      },
    },
  });

  return rows.map((b) => {
    const kind: ScanTargetKind | "unknown" = b.evaluationId
      ? "evaluation"
      : b.bundleId
        ? "bundle"
        : "unknown";
    const title = b.evaluation?.title ?? b.bundle?.name ?? null;

    return {
      id: b.id,
      kind,
      title,
      status: b.status,
      totalSheets: b.totalSheets,
      processedSheets: b.processedSheets,
      createdAt: b.createdAt,
      sheets: b.sheets.map((s) => ({
        id: s.id,
        status: s.status,
        // Prioridad: lo que resolvio el QR, luego el respaldo escrito a mano.
        studentName: (s.student ? nombreCompleto(s.student) : "") || s.studentName,
        studentCode: s.student?.code ?? s.studentCode,
        score: s.score,
        totalCorrect: s.totalCorrect,
        totalQuestions: s.totalQuestions,
        reviewedBy: s.reviewedBy,
        notes: s.notes,
      })),
    };
  });
}

/** Cuántas hojas se leen a la vez al clasificar.
 *
 *  En serie, 200 hojas × ~185 ms del endpoint /qr son más de 30 segundos con
 *  el usuario mirando un spinner. En paralelo sin límite, 200 peticiones
 *  simultáneas ahogan al servicio, que corre con 2 workers. Seis es el punto
 *  donde el tiempo baja a unos pocos segundos sin saturarlo. */
const LECTURAS_EN_PARALELO = 6;

/** Lee el QR de un archivo y decide a qué cuadernillo pertenece.
 *
 *  Verifica la firma además de decodificar: una hoja impresa en otro entorno
 *  decodifica bien pero no valida, y dejarla entrar significaría crear un lote
 *  con hojas que el worker va a rechazar una por una más tarde. Mejor saberlo
 *  acá, donde se puede reportar el archivo por su nombre. */
async function leerHoja(
  file: File,
  indice: number,
  decoder: OmrServiceQrDecoder,
  bundlesValidos: Map<string, { listo: boolean }>,
): Promise<LecturaDeHoja> {
  const base = { indice, nombre: file.name };
  const fallo = (motivo: MotivoSinClasificar): LecturaDeHoja => ({
    ...base,
    bundleId: null,
    motivo,
  });

  const bytes = Buffer.from(await file.arrayBuffer());
  const leido = await decoder.decode(bytes);
  if (!leido) return fallo("qr-ilegible");

  let payload: Record<string, unknown>;
  let sig: string;
  try {
    const { sig: s, ...resto } = JSON.parse(leido.text) as Record<string, unknown> & {
      sig: string;
    };
    payload = resto;
    sig = s;
  } catch {
    return fallo("qr-invalido");
  }

  const inst = typeof payload.inst === "string" ? payload.inst : "";
  if (!verifySignature(payload, sig, deriveInstitutionSecret(env.QR_SIGNING_SECRET, inst))) {
    return fallo("firma-invalida");
  }

  const bundleId = typeof payload.bundle === "string" ? payload.bundle : null;
  if (!bundleId) return fallo("sin-cuadernillo");

  const estado = bundlesValidos.get(bundleId);
  if (!estado) return fallo("cuadernillo-desconocido");
  if (!estado.listo) return fallo("cuadernillo-no-listo");

  return { ...base, bundleId, motivo: null };
}

/** Modo automático: un lote por cuadernillo, según el QR de cada hoja.
 *
 *  Las que no clasifican NO generan `AnswerSheet` — el check
 *  `AnswerSheet_target_xor_chk` exige que toda hoja tenga formulación o
 *  cuadernillo, y una hoja sin ninguno de los dos quedaría fuera de todos los
 *  filtros por institución del módulo, es decir invisible e inalcanzable. Se
 *  guarda el archivo igual y se reporta con su motivo, para poder reintentar
 *  sin volver a escanear el papel. */
async function createAutoScanBatches(
  actor: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  files: File[],
) {
  if (files.length > 200) {
    return { ok: false as const, error: "Máximo 200 hojas por lote." };
  }

  // Un solo viaje a la base: el QR trae el id, y acá se comprueba que ese
  // cuadernillo sea de esta institución y esté LISTO.
  const bundles = await prisma.evaluationBundle.findMany({
    where: { institutionId: actor.institutionId },
    select: { id: true, name: true, status: true },
  });
  const porId = new Map(bundles.map((b) => [b.id, { listo: b.status === "READY" }]));
  const nombres = new Map(bundles.map((b) => [b.id, b.name]));

  const decoder = new OmrServiceQrDecoder(env.OMR_SERVICE_URL);
  const lecturas: LecturaDeHoja[] = [];
  for (let i = 0; i < files.length; i += LECTURAS_EN_PARALELO) {
    const tanda = files.slice(i, i + LECTURAS_EN_PARALELO);
    lecturas.push(...(await Promise.all(tanda.map((f, j) => leerHoja(f, i + j, decoder, porId)))));
  }

  const { grupos, sinClasificar } = clasificarHojas(lecturas);

  if (grupos.length === 0) {
    return {
      ok: false as const,
      error:
        "Ninguna hoja pudo clasificarse por su QR. Revisá que sean hojas de un cuadernillo de esta institución y que el cuadernillo esté LISTO.",
    };
  }

  const lotes: { batchId: string; cuadernillo: string; hojas: number }[] = [];
  for (const g of grupos) {
    const delGrupo = g.indices.map((i) => files[i]!);
    const batch = await prisma.scanBatch.create({
      data: {
        institutionId: actor.institutionId,
        evaluationId: null,
        bundleId: g.bundleId,
        uploadedBy: actor.userId,
        status: "PENDING",
        totalSheets: delGrupo.length,
        processedSheets: 0,
      },
    });
    await enqueueSheets(actor, batch.id, delGrupo, "bundle", g.bundleId);
    lotes.push({
      batchId: batch.id,
      cuadernillo: nombres.get(g.bundleId) ?? g.bundleId.slice(0, 8),
      hojas: delGrupo.length,
    });
  }

  // Los archivos que no clasificaron se guardan igual, bajo el primer lote,
  // para que se puedan recuperar sin volver a pasar el papel por el escáner.
  const rechazadas: { nombre: string; motivo: string }[] = [];
  if (sinClasificar.length > 0) {
    const dir = `scans/${lotes[0]!.batchId}/sin-clasificar`;
    for (const s of sinClasificar) {
      const bytes = Buffer.from(await files[s.indice]!.arrayBuffer());
      await localStorage.save(
        `${dir}/${nombreDeArchivo(files[s.indice]!.name, s.indice, new Set())}`,
        bytes,
      );
      rechazadas.push({ nombre: s.nombre, motivo: MOTIVOS[s.motivo] });
    }
  }

  revalidatePath("/teacher/scan");
  return { ok: true as const, batchId: lotes[0]!.batchId, lotes, rechazadas };
}
