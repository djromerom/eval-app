import { NextResponse } from "next/server";
import { DomainError } from "@/shared/domain/result";

/**
 * Mapea códigos de DomainError a status HTTP. Usado por todas las rutas /api/*.
 * Mantiene un solo punto de verdad para que el frontend pueda branchear por
 * código (FORBIDDEN, NOT_FOUND, etc.) sin acoplarse a status numbers.
 */
export function statusForDomainError(error: DomainError): number {
  switch (error.code) {
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "VALIDATION":
      return 422;
    default:
      return 400;
  }
}

export function errorResponse(error: DomainError) {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: statusForDomainError(error) },
  );
}

/** 401 cuando no hay sesión. */
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "Sesión requerida." } },
    { status: 401 },
  );
}

/** 422 genérico para input mal formado en el handler (zod safeParse failed). */
export function validationResponse(message: string) {
  return NextResponse.json({ error: { code: "VALIDATION", message } }, { status: 422 });
}
