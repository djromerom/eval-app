# Módulo: notifications

Notificaciones in-app (campana en el header) y por email (digest opcional).
Eventos: evaluación enviada a revisión / aprobada / rechazada, escaneo completado,
errores OMR, estudiante asignado. Los módulos emisores dependen del puerto
`NotificationSender`, no de la implementación.
