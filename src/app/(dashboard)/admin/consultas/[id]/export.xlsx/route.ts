/**
 * Route handler GET para descargar el listado filtrado como XLSX.
 *
 * URL:  GET /admin/consultas/formulaciones/export.xlsx?search=…&subject=…&year=…&status=…
 *      (los query params son opcionales; si no vienen, se exportan TODAS las filas)
 *      GET /admin/consultas/informe-grupo/export.xlsx?prueba=…&grupo=…  (ambos obligatorios)
 * Auth: requiere sesión con capability `run-queries`. Formulaciones: ECU_MASTER /
 *       SUPER_ADMIN. Informe por grupo: también ECU_LIDER (acotado a sus grados
 *       por el use case).
 *       El gate del padre (`/[id]/page.tsx`) ya filtra por rol; aquí se duplica
 *       porque los route handlers son entry-points independientes.
 *
 * Decisión de diseño — por qué re-correr el use case en lugar de aceptar
 * un payload del cliente: el cliente nunca pasa datos de filas al server
 * (vector de ataque + ancho de banda). El server es la única fuente de
 * verdad para los datos, los filtros son solo "qué subset ver".
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuthenticatedUser } from "@/lib/session";
import { can } from "@/shared/application/capabilities";
import {
  applyFormulacionesFilters,
  parseFormulacionesFilters,
} from "@/modules/consultas/domain/queries/formulaciones/filters";
import {
  applyFormuladoresFilters,
  parseFormuladoresFilters,
} from "@/modules/consultas/domain/queries/formuladores/filters";
import {
  applyReglasConteoFilters,
  parseReglasConteoFilters,
} from "@/modules/consultas/domain/queries/reglas-conteo/filters";
import { reglaConteoRowsToWorksheet } from "@/modules/consultas/domain/queries/reglas-conteo/xlsx";
import { formuladorRowsToWorksheet } from "@/modules/consultas/domain/queries/formuladores/xlsx";
import { formulacionRowsToWorksheet } from "@/modules/consultas/domain/shared/xlsx-formatter";
import { informeGrupoToXlsx } from "@/modules/consultas/domain/queries/informe-grupo/xlsx";
import {
  makeGetInformeGrupo,
  makeListFormulaciones,
  makeListFormuladores,
  makeListReglasConteo,
} from "@/modules/consultas/infrastructure/container";

export const dynamic = "force-dynamic"; // siempre fresco; no cachear

function buildFilename(actor: { institutionId: string }): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `formulaciones-${actor.institutionId}-${today}.xlsx`;
}

/** Nombre del archivo de la consulta "Docentes formuladores". */
function buildFormuladoresFilename(actor: { institutionId: string }): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `formuladores-${actor.institutionId}-${today}.xlsx`;
}

/** Nombre del archivo de la consulta "Reglas de conteo por prueba". */
function buildReglasFilename(actor: { institutionId: string }): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `reglas-conteo-${actor.institutionId}-${today}.xlsx`;
}

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Nombre de archivo seguro: sin tildes, espacios ni separadores. */
function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
}

/** Informe detallado por grupo. El use case aplica el alcance del líder. */
async function exportInformeGrupo(req: NextRequest): Promise<Response> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER", "ECU_LIDER");
  if (!can("run-queries", actor.roles)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const periodId = req.nextUrl.searchParams.get("prueba") ?? "";
  const groupId = req.nextUrl.searchParams.get("grupo") ?? "";
  if (!periodId || !groupId) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const res = await makeGetInformeGrupo().execute({ actor, periodId, groupId });
  if (!res.ok) return NextResponse.json({ error: res.error.code }, { status: 403 });
  const { informe, error } = res.value;
  if (!informe) {
    const code = error?.code ?? "NOT_FOUND";
    const status = code === "FORBIDDEN" ? 403 : code === "VALIDATION" ? 400 : 404;
    return NextResponse.json({ error: code }, { status });
  }

  const buffer = await informeGrupoToXlsx(informe);
  return xlsxResponse(
    buffer,
    `informe-grupo-${slug(informe.grupo.name)}-${slug(informe.prueba.name)}.xlsx`,
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (id === "informe-grupo") return exportInformeGrupo(req);

  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER");
  if (!can("run-queries", actor.roles)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (id === "reglas-conteo") {
    const filters = parseReglasConteoFilters({
      periodId: req.nextUrl.searchParams.get("prueba") ?? undefined,
      courseName: req.nextUrl.searchParams.get("grado") ?? undefined,
      subjectName: req.nextUrl.searchParams.get("asignatura") ?? undefined,
    });

    const res = await makeListReglasConteo().execute({ actor });
    if (!res.ok) {
      return NextResponse.json({ error: res.error.code }, { status: 500 });
    }
    const rows = applyReglasConteoFilters(res.value, filters);

    const buffer = reglaConteoRowsToWorksheet(rows);
    return xlsxResponse(buffer, buildReglasFilename(actor));
  }

  if (id === "formuladores") {
    const filters = parseFormuladoresFilters({
      search: req.nextUrl.searchParams.get("search") ?? undefined,
      cuadernillo: req.nextUrl.searchParams.get("cuadernillo") ?? undefined,
      grado: req.nextUrl.searchParams.get("grado") ?? undefined,
      asignatura: req.nextUrl.searchParams.get("asignatura") ?? undefined,
      estado: req.nextUrl.searchParams.get("estado") ?? undefined,
    });

    const res = await makeListFormuladores().execute({ actor });
    if (!res.ok) {
      return NextResponse.json({ error: res.error.code }, { status: 500 });
    }
    const rows = applyFormuladoresFilters(res.value, filters);

    const buffer = formuladorRowsToWorksheet(rows);
    return xlsxResponse(buffer, buildFormuladoresFilename(actor));
  }

  if (id !== "formulaciones") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const filters = parseFormulacionesFilters({
    search: req.nextUrl.searchParams.get("search") ?? undefined,
    subjectName: req.nextUrl.searchParams.get("subject") ?? undefined,
    courseName: req.nextUrl.searchParams.get("course") ?? undefined,
    academicYearYear: req.nextUrl.searchParams.get("year") ?? undefined,
    status: req.nextUrl.searchParams.get("status") ?? undefined,
  });

  const res = await makeListFormulaciones().execute({ actor });
  if (!res.ok) {
    return NextResponse.json({ error: res.error.code }, { status: 500 });
  }
  const rows = applyFormulacionesFilters(res.value, filters);

  const buffer = formulacionRowsToWorksheet(rows);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${buildFilename(actor)}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
}
