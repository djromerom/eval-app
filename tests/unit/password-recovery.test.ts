import crypto from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import type { Email, EmailService } from "@/shared/domain/email";
import { RequestPasswordReset } from "@/modules/recovery/application/request-password-reset";
import { ResetPassword } from "@/modules/recovery/application/reset-password";
import type {
  PasswordResetRepository,
  UserResetSummary,
} from "@/modules/recovery/domain/password-reset";

// ---------- Fakes (mismo patrón que tests/unit/users.test.ts) ----------

class FakeEmail implements EmailService {
  sent: Email[] = [];
  async send(email: Email): Promise<void> {
    this.sent.push(email);
  }
}

class FlakyEmail implements EmailService {
  sent: Email[] = [];
  async send(email: Email): Promise<void> {
    this.sent.push(email);
    throw new Error("smtp down");
  }
}

class InMemoryPasswordResetRepository implements PasswordResetRepository {
  /** Map<userId, summary>. Source of truth del estado. */
  users = new Map<string, UserResetSummary>();
  /** Tokens hasheados actuales (para inspección en asserts). */
  hashes = new Map<string, string>();

  setUser(user: UserResetSummary): void {
    this.users.set(user.id, { ...user });
  }

  async findByEmail(email: string): Promise<UserResetSummary | null> {
    for (const u of this.users.values()) {
      if (u.email === email.toLowerCase()) return { ...u };
    }
    return null;
  }

  async findByResetTokenHash(tokenHash: string): Promise<UserResetSummary | null> {
    const userId = this.hashes.get(tokenHash);
    if (!userId) return null;
    const u = this.users.get(userId);
    return u ? { ...u } : null;
  }

  async setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    const u = this.users.get(userId);
    if (!u) throw new Error(`user not found: ${userId}`);
    // Si el hash es "" estamos limpiando (caso token expirado).
    if (tokenHash === "") {
      this.users.set(userId, { ...u, passwordResetExpiresAt: expiresAt });
      return;
    }
    // Sobrescribe cualquier token previo.
    for (const [k, v] of this.hashes.entries()) {
      if (v === userId) this.hashes.delete(k);
    }
    this.hashes.set(tokenHash, userId);
    this.users.set(userId, { ...u, passwordResetExpiresAt: expiresAt });
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const u = this.users.get(userId);
    if (!u) throw new Error(`user not found: ${userId}`);
    // Limpia cualquier token activo.
    for (const [k, v] of this.hashes.entries()) {
      if (v === userId) this.hashes.delete(k);
    }
    this.users.set(userId, {
      ...u,
      passwordResetExpiresAt: null,
      // Guardamos el hash en un slot aparte para inspección.
      ...({ passwordHash } as unknown as Partial<UserResetSummary>),
    });
    // Store actual passwordHash fuera de UserResetSummary (no es parte del DTO).
    (this as unknown as { lastPasswordHash?: string }).lastPasswordHash = passwordHash;
  }
}

// ---------- Helpers ----------

const baseUser = (over: Partial<UserResetSummary> = {}): UserResetSummary => ({
  id: "u1",
  email: "docente@x.edu.co",
  name: "Ana Pérez",
  passwordResetExpiresAt: null,
  ...over,
});

const makeSut = (opts: {
  repo?: InMemoryPasswordResetRepository;
  email?: EmailService | undefined;
  baseUrl?: string;
}) => {
  const repo = opts.repo ?? new InMemoryPasswordResetRepository();
  const email = "email" in opts ? opts.email : new FakeEmail();
  const baseUrl = opts.baseUrl ?? "http://localhost:3000";
  const sut = new RequestPasswordReset({ repo, email, baseUrl });
  return { sut, repo, email: email as FakeEmail | undefined };
};

// ---------- RequestPasswordReset ----------

describe("RequestPasswordReset", () => {
  let repo: InMemoryPasswordResetRepository;

  beforeEach(() => {
    repo = new InMemoryPasswordResetRepository();
  });

  it("devuelve ok con sent:false cuando el email no existe (anti-enumeración)", async () => {
    const { sut, email } = makeSut({ repo });
    const result = await sut.execute({ email: "noexiste@x.edu.co" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sent).toBe(false);
    expect(email!.sent).toHaveLength(0);
  });

  it("devuelve ok con sent:true cuando el email existe y envía el correo", async () => {
    repo.setUser(baseUser());
    const { sut, email } = makeSut({ repo });
    const result = await sut.execute({ email: "docente@x.edu.co" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sent).toBe(true);
    expect(email?.sent).toHaveLength(1);
    expect(email?.sent[0]?.to).toBe("docente@x.edu.co");
    expect(email?.sent[0]?.subject).toContain("Restablece tu contraseña");
  });

  it("persiste sha256(token) en passwordResetExpiresAt (NO el token en plano)", async () => {
    repo.setUser(baseUser());
    const { email } = makeSut({ repo, baseUrl: "http://x" });
    const sut = new RequestPasswordReset({ repo, email, baseUrl: "http://x" });
    await sut.execute({ email: "docente@x.edu.co" });
    const sent = email?.sent[0];
    expect(sent).toBeDefined();
    const match = sent!.html.match(/token=([a-f0-9]+)/);
    expect(match).not.toBeNull();
    const rawToken = match![1]!;
    const sha256 = crypto.createHash("sha256").update(rawToken).digest("hex");
    // El hash debe estar en `repo.hashes` (no el rawToken).
    expect(repo.hashes.has(sha256)).toBe(true);
    expect(repo.hashes.has(rawToken)).toBe(false);
  });

  it("incluye solo ?token= en la URL del correo (NO &email=...)", async () => {
    repo.setUser(baseUser());
    const { sut, email } = makeSut({ repo });
    await sut.execute({ email: "docente@x.edu.co" });
    const html = email?.sent[0]?.html ?? "";
    expect(html).toContain("/reset-password?token=");
    expect(html).not.toContain("email=");
  });

  it("sobrescribe un token previo (un solo reset activo por usuario)", async () => {
    repo.setUser(baseUser());
    const { sut } = makeSut({ repo });
    // Primera solicitud
    await sut.execute({ email: "docente@x.edu.co" });
    const hashesAfter1 = Array.from(repo.hashes.keys());
    expect(hashesAfter1).toHaveLength(1);

    // Segunda solicitud con el mismo email
    await sut.execute({ email: "docente@x.edu.co" });
    const hashesAfter2 = Array.from(repo.hashes.keys());
    expect(hashesAfter2).toHaveLength(1);
    expect(hashesAfter2[0]).not.toBe(hashesAfter1[0]);
  });

  it("no falla aunque el envío de email tire excepción (best-effort)", async () => {
    repo.setUser(baseUser());
    const email = new FlakyEmail();
    const { sut } = makeSut({ repo, email });
    const result = await sut.execute({ email: "docente@x.edu.co" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sent).toBe(true);
    expect(email.sent).toHaveLength(1); // el intento se hizo
  });

  it("si no hay email service configurado, devuelve sent:false (sin error)", async () => {
    repo.setUser(baseUser());
    const { sut } = makeSut({ repo, email: undefined });
    const result = await sut.execute({ email: "docente@x.edu.co" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sent).toBe(false);
  });

  it("rechaza emails con formato inválido devolviendo sent:false (sin leak)", async () => {
    repo.setUser(baseUser());
    const { sut, email } = makeSut({ repo });
    const result = await sut.execute({ email: "no-es-un-email" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sent).toBe(false);
    expect(email!.sent).toHaveLength(0);
  });
});

// ---------- ResetPassword ----------

describe("ResetPassword", () => {
  let repo: InMemoryPasswordResetRepository;

  beforeEach(() => {
    repo = new InMemoryPasswordResetRepository();
  });

  /** Helper: pre-pobla un usuario con un token pre-emitido (para no
   *  acoplar ResetPassword a RequestPasswordReset en los tests). */
  async function presetToken(
    user: UserResetSummary,
    expiresAt: Date,
    rawToken = "raw-token-abc",
  ): Promise<{ rawToken: string }> {
    repo.setUser(user);
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await repo.setPasswordResetToken(user.id, tokenHash, expiresAt);
    return { rawToken };
  }

  it("aplica la nueva contraseña cuando el token es válido y no expiró", async () => {
    const user = baseUser();
    const { rawToken } = await presetToken(user, new Date(Date.now() + 60_000));
    const sut = new ResetPassword(repo);
    const result = await sut.execute({
      rawToken,
      password: "nuevapass",
      passwordConfirm: "nuevapass",
    });
    expect(result.ok).toBe(true);
    // Token limpio.
    expect(repo.hashes.size).toBe(0);
    expect(repo.users.get(user.id)?.passwordResetExpiresAt).toBeNull();
  });

  it("rechaza cuando el token no existe en DB → ValidationError", async () => {
    const sut = new ResetPassword(repo);
    const result = await sut.execute({
      rawToken: "no-existe",
      password: "nuevapass",
      passwordConfirm: "nuevapass",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza cuando el token expiró → ValidationError y limpia el token", async () => {
    const user = baseUser();
    const { rawToken } = await presetToken(user, new Date(Date.now() - 1_000));
    const sut = new ResetPassword(repo);
    const result = await sut.execute({
      rawToken,
      password: "nuevapass",
      passwordConfirm: "nuevapass",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    // Token expirado fue limpiado.
    expect(repo.users.get(user.id)?.passwordResetExpiresAt?.getTime()).toBe(0);
  });

  it("rechaza cuando password < 6 chars → ValidationError sin tocar DB", async () => {
    const user = baseUser();
    const { rawToken } = await presetToken(user, new Date(Date.now() + 60_000));
    const sut = new ResetPassword(repo);
    const result = await sut.execute({
      rawToken,
      password: "123",
      passwordConfirm: "123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    // Token NO se limpió.
    expect(repo.hashes.size).toBe(1);
    expect(repo.users.get(user.id)?.passwordResetExpiresAt).not.toBeNull();
  });

  it("rechaza cuando password !== passwordConfirm → ValidationError sin tocar DB", async () => {
    const user = baseUser();
    const { rawToken } = await presetToken(user, new Date(Date.now() + 60_000));
    const sut = new ResetPassword(repo);
    const result = await sut.execute({
      rawToken,
      password: "nuevapass",
      passwordConfirm: "otrapass",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    expect(repo.hashes.size).toBe(1);
  });
});
