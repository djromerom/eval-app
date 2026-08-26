import { PrismaCourseRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  AssignLeader,
  ListLeaderAssignments,
  UnassignLeader,
} from "../application/leader-assignments";
import { PrismaLeaderAssignmentRepository } from "./prisma-leader-assignment-repository";

const assignments = new PrismaLeaderAssignmentRepository();
const courses = new PrismaCourseRepository();

/** ¿Este usuario tiene el rol ECU_LIDER en esta institución? Inyectado al
 *  use case AssignLeader para no acoplar el módulo a PrismaRoleRepository. */
async function userHasEcuLiderRole(institutionId: string, userId: string): Promise<boolean> {
  const row = await prisma.userRole.findFirst({
    where: {
      userId,
      user: { institutionId, deletedAt: null, isActive: true },
      role: "ECU_LIDER",
    },
    select: { id: true },
  });
  return row !== null;
}

export const makeAssignLeader = () => new AssignLeader(assignments, courses, userHasEcuLiderRole);
export const makeUnassignLeader = () => new UnassignLeader(assignments);
export const makeListLeaderAssignments = () => new ListLeaderAssignments(assignments);