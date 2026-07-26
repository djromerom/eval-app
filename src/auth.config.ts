import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/**
 * Configuración edge-safe de Auth.js: la usa el middleware.
 * NO importar Prisma ni Node APIs aquí — el provider credentials y el
 * adapter viven en src/auth.ts (solo Node runtime).
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID ? [Google] : []),
    ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID ? [MicrosoftEntraID] : []),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;

      const isPublic =
        pathname === "/" ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/accept-invite") ||
        pathname.startsWith("/api/auth");
      if (isPublic) return true;

      // /print/* se auto-protege dentro de cada página (sesión O token de
      // impresión firmado), para permitir el acceso sin sesión del worker de PDF.
      if (pathname.startsWith("/print/")) return true;

      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
