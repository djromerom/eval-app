import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/infrastructure/db/prisma";

const bodySchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "Datos inválidos." } }, { status: 422 });
  }

  const { token, email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    return NextResponse.json({ error: { message: "Usuario no encontrado." } }, { status: 404 });
  }

  if (!user.inviteToken || !user.inviteTokenExpiresAt) {
    return NextResponse.json(
      { error: { message: "No hay invitación pendiente para este usuario." } },
      { status: 400 },
    );
  }

  if (new Date() > user.inviteTokenExpiresAt) {
    return NextResponse.json(
      { error: { message: "El enlace de invitación ha expirado." } },
      { status: 400 },
    );
  }

  const valid = await bcrypt.compare(token, user.inviteToken);
  if (!valid) {
    return NextResponse.json(
      { error: { message: "El enlace de invitación no es válido." } },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: passwordHash,
      isActive: true,
      inviteToken: null,
      inviteTokenExpiresAt: null,
    },
  });

  return NextResponse.json({ ok: true });
}
