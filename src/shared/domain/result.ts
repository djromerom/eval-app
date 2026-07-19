/**
 * Result<T, E>: manejo explícito de errores de negocio sin excepciones.
 * Las excepciones quedan reservadas para fallos de infraestructura inesperados.
 */
export type Result<T, E = DomainError> = Ok<T> | Fail<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Fail<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const fail = <E>(error: E): Fail<E> => ({ ok: false, error });

/** Error de negocio: tiene código estable (para i18n/API) y mensaje legible. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} no encontrado: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "No tienes permisos para realizar esta acción") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION", message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}
