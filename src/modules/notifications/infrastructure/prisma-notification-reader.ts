import { prisma } from "@/shared/infrastructure/db/prisma";
import type { NotificationReader, NotificationView } from "../application/notifications";
import type { NotificationType } from "../domain/notification";

export class PrismaNotificationReader implements NotificationReader {
  async listForUser(userId: string): Promise<NotificationView[]> {
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type as NotificationType,
      title: r.title,
      body: r.body,
      link: r.link,
      isRead: r.isRead,
      createdAt: r.createdAt,
    }));
  }

  async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
