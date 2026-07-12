import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { NotificationType } from "../domain/notification";

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
}

/** Lectura de notificaciones propias del actor. Puerto de solo lectura. */
export interface NotificationReader {
  listForUser(userId: string): Promise<NotificationView[]>;
  countUnread(userId: string): Promise<number>;
  markAllRead(userId: string): Promise<void>;
}

export interface ListNotificationsInput {
  actor: AuthenticatedUser;
}

export class ListNotifications implements UseCase<ListNotificationsInput, NotificationView[]> {
  constructor(private readonly reader: NotificationReader) {}

  async execute({ actor }: ListNotificationsInput): Promise<Result<NotificationView[]>> {
    return ok(await this.reader.listForUser(actor.userId));
  }
}

export class MarkNotificationsRead implements UseCase<ListNotificationsInput, void> {
  constructor(private readonly reader: NotificationReader) {}

  async execute({ actor }: ListNotificationsInput): Promise<Result<void>> {
    await this.reader.markAllRead(actor.userId);
    return ok(undefined);
  }
}
