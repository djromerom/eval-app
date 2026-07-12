import { type NotificationType as PrismaNotificationType } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { NotificationMessage, NotificationSender } from "../domain/notification";

/** Persiste notificaciones in-app (§3.8). El envío por email es un canal aparte (Fase 5). */
export class PrismaNotificationSender implements NotificationSender {
  async send(message: NotificationMessage): Promise<void> {
    await prisma.notification.create({
      data: {
        userId: message.userId,
        type: message.type as PrismaNotificationType,
        title: message.title,
        body: message.body ?? null,
        link: message.link ?? null,
      },
    });
  }
}
