import { ListNotifications, MarkNotificationsRead } from "../application/notifications";
import { PrismaNotificationReader } from "./prisma-notification-reader";
import { PrismaNotificationSender } from "./prisma-notification-sender";

/** Composition root del módulo notifications. */
const reader = new PrismaNotificationReader();
export const notificationSender = new PrismaNotificationSender();

export const makeListNotifications = () => new ListNotifications(reader);
export const makeMarkNotificationsRead = () => new MarkNotificationsRead(reader);
