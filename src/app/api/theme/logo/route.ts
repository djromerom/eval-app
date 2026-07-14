import { rm } from "node:fs/promises";
import { join, normalize } from "node:path";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { env } from "@/config/env";
import { prisma } from "@/shared/infrastructure/db/prisma";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set(["image/png", "image/jpeg"]);

/**
 * Subida (POST) o eliminación (DELETE) del logo institucional.
 * El archivo se persiste en `storage/institutions/{id}/logo.{ext}` via
 * `localStorage`, y `Institution.logo` se actualiza con esa ruta relativa
 * (segura para servir luego desde el print page sin exponer el FS).
 */
export async function POST(request: Request) {
  const actor = await requireAuthenticatedUser("ADMIN", "SUPER_ADMIN");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "Solo PNG o JPG." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Logo demasiado grande (máx 2 MB)." }, { status: 413 });
  }

  const ext = file.type === "image/png" ? "png" : "jpg";
  const relative = `institutions/${actor.institutionId}/logo.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const saved = await localStorage.save(relative, buf);

  await prisma.institution.update({
    where: { id: actor.institutionId },
    data: { logo: saved },
  });

  return NextResponse.json({ ok: true, path: saved });
}

export async function DELETE() {
  const actor = await requireAuthenticatedUser("ADMIN", "SUPER_ADMIN");

  const inst = await prisma.institution.findUnique({
    where: { id: actor.institutionId },
    select: { logo: true },
  });

  if (inst?.logo) {
    // Resuelve la ruta absoluta de forma segura (sin path traversal) y elimina.
    const abs = normalize(join(env.STORAGE_DIR, inst.logo));
    if (abs.startsWith(normalize(env.STORAGE_DIR))) {
      await rm(abs, { force: true });
    }
    await prisma.institution.update({
      where: { id: actor.institutionId },
      data: { logo: null },
    });
  }

  return NextResponse.json({ ok: true });
}
