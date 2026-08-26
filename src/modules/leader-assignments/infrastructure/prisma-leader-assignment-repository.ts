import { prisma } from "@/shared/infrastructure/db/prisma";
import type { LeaderAssignment, LeaderAssignmentRepository } from "../domain/leader-assignment";

export class PrismaLeaderAssignmentRepository implements LeaderAssignmentRepository {
  async assign(userId: string, courseId: string): Promise<void> {
    // createMany + skipDuplicates da idempotencia limpia sin un try/catch.
    // La unicidad la garantiza @@unique([userId, courseId]) en el schema.
    await prisma.leaderCourseAssignment.createMany({
      data: [{ userId, courseId }],
      skipDuplicates: true,
    });
  }

  async unassign(userId: string, courseId: string): Promise<void> {
    await prisma.leaderCourseAssignment.deleteMany({
      where: { userId, courseId },
    });
  }

  async isAssigned(userId: string, courseId: string): Promise<boolean> {
    const row = await prisma.leaderCourseAssignment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    return row !== null;
  }

  async listAssignments(institutionId: string, userId?: string): Promise<LeaderAssignment[]> {
    const rows = await prisma.leaderCourseAssignment.findMany({
      where: {
        user: { institutionId, deletedAt: null },
        ...(userId ? { userId } : {}),
      },
      include: {
        user: { select: { name: true } },
        course: { select: { name: true } },
      },
      orderBy: [{ user: { name: "asc" } }, { course: { name: "asc" } }],
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      courseId: r.courseId,
      courseName: r.course.name,
      userName: r.user.name,
    }));
  }

  async listAssignedCourseIds(institutionId: string, userId: string): Promise<string[]> {
    const rows = await prisma.leaderCourseAssignment.findMany({
      where: { user: { institutionId }, userId },
      select: { courseId: true },
    });
    return rows.map((r) => r.courseId);
  }
}