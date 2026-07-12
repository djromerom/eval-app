export type NotificationType =
  | "EVALUATION_PENDING_REVIEW"
  | "EVALUATION_APPROVED"
  | "EVALUATION_REJECTED"
  | "SCANNING_COMPLETED"
  | "SCANNING_ERROR"
  | "NEW_STUDENT_ASSIGNED";

export interface NotificationMessage {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string; // ej: /teacher/evaluations/{id}
}

/** Puerto: los módulos de negocio notifican a través de esta interfaz. */
export interface NotificationSender {
  send(message: NotificationMessage): Promise<void>;
}
