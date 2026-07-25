import { env } from "@/config/env";
import { signPayload, verifySignature } from "./hmac";

/** Tipo de documento imprimible; alineado con PdfGenerationJob.
 *  Sprint 1 del módulo cuadernillos: agrega "bundle" para el booklet combinado.
 *  Sprint 2: "answer-sheets-bundle" para la hoja unificada.
 *  Sprint 3: "answer-key-bundle" para la clave de respuestas unificada. */
export type PrintKind =
  | "booklet"
  | "answer-sheets"
  | "answer-key"
  | "bundle"
  | "answer-sheets-bundle"
  | "answer-key-bundle";

export interface PrintAccess {
  /** evaluationId para booklet/answer-sheets/answer-key. */
  evaluationId?: string;
  /** bundleId para bundle/answer-sheets-bundle (Sprint 1+ / Sprint 2). */
  bundleId?: string;
  institutionId: string;
  kind: PrintKind;
}

interface PrintTokenPayload extends PrintAccess {
  exp: number; // epoch ms
}

/** 5 min: suficiente para que el worker cargue la página y genere el PDF. */
const TTL_MS = 5 * 60 * 1000;

/**
 * Token firmado (HMAC-SHA256) que autoriza al worker de PDF a abrir una ruta
 * /print/* sin sesión. De un solo propósito y corta vida. Formato: `body.sig`
 * con `body` = base64url(JSON). Reusa QR_SIGNING_SECRET.
 */
export function signPrintToken(access: PrintAccess): string {
  const payload: PrintTokenPayload = { ...access, exp: Date.now() + TTL_MS };
  const sig = signPayload(payload as unknown as Record<string, unknown>, env.QR_SIGNING_SECRET);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sig}`;
}

/** Verifica firma y expiración. Devuelve el acceso o null si es inválido. */
export function verifyPrintToken(token: string): PrintAccess | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  let payload: PrintTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!verifySignature(payload as unknown as Record<string, unknown>, sig, env.QR_SIGNING_SECRET))
    return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;

  return {
    evaluationId: payload.evaluationId,
    bundleId: payload.bundleId,
    institutionId: payload.institutionId,
    kind: payload.kind,
  };
}
