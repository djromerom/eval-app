import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/session";
import { DomainError } from "@/shared/domain/result";
import {
  makeCreateInstitution,
  makeListInstitutions,
} from "@/modules/institutions/infrastructure/container";

/** Mapea el código de error de dominio a un status HTTP. */
function statusFor(error: DomainError): number {
  switch (error.code) {
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "VALIDATION":
      return 422;
    default:
      return 400;
  }
}

function errorResponse(error: DomainError) {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    {
      status: statusFor(error),
    },
  );
}

export async function GET() {
  const actor = await getAuthenticatedUser();
  if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });

  const result = await makeListInstitutions().execute({ actor });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value });
}

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  code: z.string().min(1),
  logo: z.string().url().optional(),
});

export async function POST(request: Request) {
  const actor = await getAuthenticatedUser();
  if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: parsed.error.issues[0]?.message } },
      { status: 422 },
    );
  }

  const result = await makeCreateInstitution().execute({ actor, data: parsed.data });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value }, { status: 201 });
}
