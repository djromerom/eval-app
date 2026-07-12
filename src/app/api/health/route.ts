import { NextResponse } from "next/server";
import { prisma } from "@/shared/infrastructure/db/prisma";

/** Healthcheck para el balanceador / monitoreo del VPS. Verifica la BD. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up", ts: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", db: "down" }, { status: 503 });
  }
}
