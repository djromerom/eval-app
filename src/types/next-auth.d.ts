import type { Role } from "@/shared/application/authenticated-user";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      institutionId: string;
      roles: Role[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    institutionId?: string;
    roles?: Role[];
  }
}
