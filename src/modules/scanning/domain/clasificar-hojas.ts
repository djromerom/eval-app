/**
 * Clasificación de hojas por el cuadernillo que declara su QR.
 *
 * En el modo automático el usuario no elige objetivo: cada hoja lo trae
 * impreso. Esta función es la parte pura — recibe lo que se pudo leer de cada
 * archivo y decide en qué grupo cae — para poder probarla sin red ni base.
 *
 * Se clasifica solo por `bundle`. Un QR con `eval` (formulación suelta, el
 * camino legacy) queda sin clasificar a propósito: el modo automático existe
 * para lotes de cuadernillos, y adivinar ahí llevaría a mezclar dos flujos que
 * el resto del sistema trata distinto.
 */
export type MotivoSinClasificar =
  | "qr-ilegible"
  | "qr-invalido"
  | "firma-invalida"
  | "sin-cuadernillo"
  | "cuadernillo-desconocido"
  | "cuadernillo-no-listo";

export const MOTIVOS: Record<MotivoSinClasificar, string> = {
  "qr-ilegible": "No se pudo leer el QR",
  "qr-invalido": "El QR no tiene el formato esperado",
  "firma-invalida": "La firma del QR no valida (¿hoja de otro entorno?)",
  "sin-cuadernillo": "El QR es de una formulación suelta, no de un cuadernillo",
  "cuadernillo-desconocido": "El cuadernillo del QR no existe en esta institución",
  "cuadernillo-no-listo": "El cuadernillo existe pero no está LISTO para escanear",
};

/** Lo que se pudo averiguar de un archivo antes de agrupar. */
export interface LecturaDeHoja {
  indice: number;
  nombre: string;
  /** `null` si el QR no se pudo leer o no valida. */
  bundleId: string | null;
  motivo: MotivoSinClasificar | null;
}

export interface GrupoDeCuadernillo {
  bundleId: string;
  indices: number[];
}

export interface SinClasificar {
  indice: number;
  nombre: string;
  motivo: MotivoSinClasificar;
}

export interface Clasificacion {
  grupos: GrupoDeCuadernillo[];
  sinClasificar: SinClasificar[];
}

export function clasificarHojas(lecturas: readonly LecturaDeHoja[]): Clasificacion {
  const grupos = new Map<string, number[]>();
  const sinClasificar: SinClasificar[] = [];

  for (const l of lecturas) {
    if (l.bundleId === null) {
      sinClasificar.push({
        indice: l.indice,
        nombre: l.nombre,
        // Si algo no clasifica siempre hay un motivo; el fallback evita que un
        // bug de arriba haga desaparecer la hoja del reporte.
        motivo: l.motivo ?? "qr-ilegible",
      });
      continue;
    }
    grupos.set(l.bundleId, [...(grupos.get(l.bundleId) ?? []), l.indice]);
  }

  return {
    // Orden estable: el cuadernillo con más hojas primero, y a igualdad por id.
    // Sin esto el orden de los lotes creados dependería del orden del Map.
    grupos: [...grupos.entries()]
      .map(([bundleId, indices]) => ({ bundleId, indices }))
      .sort((a, b) => b.indices.length - a.indices.length || a.bundleId.localeCompare(b.bundleId)),
    sinClasificar,
  };
}
