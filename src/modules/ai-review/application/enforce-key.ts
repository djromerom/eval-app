/**
 * Regla de negocio: la clave que marcó el docente tiene que coincidir con
 * la clave que la IA obtuvo al RESOLVER el ítem.
 *
 * ¿Por qué hace falta? Porque un modelo puede aprobar un ítem sin mirar la
 * aritmética (se vio en la prueba real: aprobó un ítem de porcentajes con
 * la clave equivocada). Si la IA resolvió el ítem y le dio una clave
 * distinta a la del docente, el ítem NO puede pasar: lo que la IA resolvió
 * manda, porque la justificación la escribimos nosotros con su resultado.
 *
 * Función pura: no toca la red ni la base de datos.
 */

import type { AiReviewFinding, AiReviewInput, AiReviewVerdict } from "../domain/ai-review";

const CLAVE_RE = /^[A-H]$/;

export function enforceKeyConsistency(
  verdict: AiReviewVerdict,
  item: AiReviewInput,
): AiReviewVerdict {
  const solucion = verdict.solucion?.trim().toUpperCase() ?? "";
  const marcada = item.clave?.trim().toUpperCase() ?? "";

  // Sin una de las dos claves no hay nada que contrastar: dejamos el
  // veredicto como vino del proveedor.
  if (!CLAVE_RE.test(solucion) || !CLAVE_RE.test(marcada)) return verdict;
  if (solucion === marcada) return verdict;

  const hallazgo: AiReviewFinding = {
    area: "clave",
    titulo: "La opción marcada como correcta no es la correcta",
    justificacion: `Al resolver el ítem, la respuesta correcta es la opción ${solucion}, pero el docente marcó la opción ${marcada}.`,
    sugerencia: `Marcar la opción ${solucion} como correcta.`,
  };

  // Si la IA ya señaló el problema de la clave, su explicación es mejor
  // que la nuestra (trae el cálculo): no la duplicamos.
  const yaHayHallazgoDeClave = verdict.hallazgos.some((h) => h.area === "clave");

  // Si la IA no propuso corrección, se arma una con el ítem tal cual y la
  // clave correcta: el docente puede aplicarla con un clic igual.
  const correccion =
    verdict.correccion ??
    ({
      enunciado: item.enunciado,
      opciones: Object.fromEntries(item.opciones.map((o) => [o.key, o.texto])),
      clave: solucion,
    } satisfies NonNullable<AiReviewVerdict["correccion"]>);

  return {
    aprobado: false,
    solucion,
    hallazgos: yaHayHallazgoDeClave ? verdict.hallazgos : [hallazgo, ...verdict.hallazgos],
    correccion,
  };
}
