import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import type { Role } from "@/shared/application/authenticated-user";
import { prisma } from "@/shared/infrastructure/db/prisma";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Configuración completa de Auth.js (solo Node runtime).
 * Estrategia JWT: el token lleva id, institutionId y roles para que los
 * layouts y casos de uso construyan el AuthenticatedUser sin ir a la BD.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Correo electrónico", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          include: { roles: true },
        });
        if (!user?.password || !user.isActive || user.deletedAt) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // OAuth: solo usuarios previamente invitados/creados por un admin (§3.1)
      if (account?.provider !== "credentials") {
        const existing = await prisma.user.findUnique({
          where: { email: user.email ?? "" },
        });
        return Boolean(existing?.isActive && !existing.deletedAt);
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          include: { roles: true },
        });
        if (dbUser) {
          token.sub = dbUser.id;
          token.institutionId = dbUser.institutionId;
          token.roles = dbUser.roles.map((r) => r.role as Role);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.institutionId = (token.institutionId as string) ?? "";
      session.user.roles = (token.roles as Role[]) ?? [];
      return session;
    },
  },
});
