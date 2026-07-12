import type { Result } from "@/shared/domain/result";

/**
 * Contrato de todo caso de uso de la capa application.
 * Un caso de uso = una acción de negocio con un input y un output claros.
 * Recibe sus dependencias (repositorios, servicios) por constructor.
 */
export interface UseCase<Input, Output> {
  execute(input: Input): Promise<Result<Output>>;
}
