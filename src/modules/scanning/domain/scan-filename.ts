/**
 * Nombrado de los escaneos que se suben a un lote.
 *
 * Vive fuera de `teacher/scan/actions.ts` porque ese archivo es `"use server"`
 * y ahi todo export debe ser una funcion async: el helper no seria testeable.
 */

/** Nombre con el que se guarda un escaneo: el nombre original del usuario mas
 *  un timestamp, conservando la extension.
 *
 *  Se conserva el nombre original porque es lo unico que permite rastrear una
 *  hoja hasta el archivo que salio del escaner; el timestamp evita que dos
 *  lotes con los mismos nombres se pisen. El nombre se sanea antes de tocar el
 *  disco: llega del cliente y sin limpiar admitiria `../` y salir del
 *  directorio del lote.
 *
 *  La extension sale del nombre solo si existe; `file.name.split(".").pop()`
 *  nunca devuelve undefined sobre un string no vacio, asi que el `?? "png"`
 *  anterior era codigo muerto y dejaba archivos `.undefined`. */
export function nombreDeArchivo(original: string, indice: number, usados: Set<string>): string {
  const limpio = (original ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const punto = limpio.lastIndexOf(".");
  const extCruda = punto > 0 ? limpio.slice(punto + 1) : "";
  const ext = extCruda.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "png";
  const baseCruda = punto > 0 ? limpio.slice(0, punto) : limpio;
  const base =
    baseCruda.replace(/[^\w.-]+/g, "_").replace(/^[._-]+/, "").slice(0, 80) ||
    `sheet_${String(indice + 1).padStart(3, "0")}`;

  let nombre = `${base}_${Date.now()}.${ext}`;
  for (let n = 2; usados.has(nombre); n++) nombre = `${base}_${Date.now()}_${n}.${ext}`;
  usados.add(nombre);
  return nombre;
}
