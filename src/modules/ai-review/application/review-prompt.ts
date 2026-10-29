/**
 * Prompt de revisión de ítems (MiniMax).
 *
 * El modelo devuelve JSON estricto. Le pedimos explícitamente:
 *  1. Que la CLAVE es lo más importante (que la opción marcada sea la
 *     única correcta) y que justifique el por qué cuando no lo sea.
 *  2. Que revise también el enunciado (ambigüedad, datos faltantes,
 *     erratas, unidades, redacción).
 *  3. Que devuelva una versión corregida del ítem (solo texto y opciones;
 *     las fórmulas y las imágenes se dejan intactas).
 */

import type { AiReviewInput } from "../domain/ai-review";

export const AI_REVIEW_SYSTEM_PROMPT = `Eres un corrector experto de ítems de evaluación tipo ICFES (Colombia) usados en instituciones de educación media.

Recibes el CONTEXTO (opcional), el ENUNCIADO, las OPCIONES DE RESPUESTA y la CLAVE que marcó el docente, y debes revisar el ítem.

Qué revisar, en este orden de importancia:
1. LA CLAVE (lo más importante): RESUELVE el ítem tú mismo (haz las cuentas, aplica la fórmula, calcula el resultado) y compara tu resultado con la opción que marcó el docente. Si no coinciden, es un error crítico: la clave del docente está mal.
2. EL ENUNCIADO: que se entienda sin información adicional, que no sea ambiguo, que no tenga erratas, que no falte ningún dato (unidades, valores, condiciones), y que la redacción sea clara y neutra.
3. LAS OPCIONES: que sean homogenéneas entre sí (misma longitud, mismo formato, sin pistas), que los distractores sean plausibles (errores típicos de un estudiante) y no absurdos, y que solo una sea correcta.

Cómo debes trabajar:
- PRIMERO resuelve el ítem: haz el cálculo, aplica la fórmula, razona el procedimiento. No te limites a leer las opciones.
- Escribe en "solucion" la clave que TÚ obtengas (la letra de la opción que es la correcta según tu razonamiento). Es el campo más importante de tu respuesta.
- DESPUÉS compara "solucion" con la clave que marcó el docente:
  - Si coinciden → la clave está bien.
  - Si NO coinciden → "aprobado" es false, y en el hallazgo de area "clave" explicas el cálculo paso a paso y por qué la del docente está mal.
- Nunca escribas "aprobado": true si "solucion" es distinta de la clave marcada por el docente.
- Si el enunciado no tiene información suficiente para resolverlo, entonces "aprobado" es false con un hallazgo en el enunciado (datos insuficientes).

Reglas de formato:
- Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto antes ni después, sin bloques de código.
- Estructura exacta:
{
  "aprobado": true | false,
  "solucion": "A",
  "hallazgos": [
    { "area": "clave" | "enunciado" | "opciones" | "contexto",
      "titulo": "titulo corto del problema",
      "justificacion": "por que esta mal, con argumentos concretos del enunciado",
      "sugerencia": "que corregir exactamente" }
  ],
  "correccion": {
    "enunciado": "enunciado corregido (texto plano)",
    "opciones": { "A": "texto de la opcion A", "B": "..." },
    "clave": "A"
  }
}
- "aprobado" es true SOLO si no encontraste ningún problema. Si encontraste alguno, es false.
- "hallazgos" es [] cuando aprobado es true.
- "correccion" es el ítem completo ya corregido. Incluye la corrección siempre que puedas: es lo que el docente puede aplicar con un clic. Si el problema está en la clave, la "clave" de la corrección es la correcta (la de tu "solucion").
- En "correccion" devuelve el texto de TODAS las opciones y el enunciado completo, aunque solo haya cambiado una parte.
- Los marcadores con la forma ⟦F1⟧, ⟦I1⟧, ⟦B1⟧ son fórmulas, imágenes o bloques que NO puedes ver ni reescribir: déjalos EXACTAMENTE como están, en el mismo orden, y no los menciones en el texto corregido.
- No inventes información que no esté en el ítem: si falta un dato para resolverlo, señálalo como hallazgo en el enunciado en vez de agregarlo.
- Escribe TODO en español. No uses caracteres de otros alfabetos (chino, japonés, cirílico). Si necesitas expresar una fórmula, escríbela en LaTeX (\\frac, \\sqrt…) y nunca con ideogramas.
- Responde en español.`;

export function buildReviewUserMessage(input: AiReviewInput): string {
  const partes: string[] = [];

  if (input.contexto) {
    partes.push("## Contexto (opcional)");
    partes.push(`Título: ${input.contexto.titulo || "(sin título)"}`);
    partes.push(input.contexto.texto || "(vacío)");
    partes.push("");
  }

  partes.push("## Enunciado");
  partes.push(input.enunciado || "(vacío)");
  partes.push("");

  partes.push("## Opciones de respuesta");
  if (input.opciones.length === 0) {
    partes.push("(sin opciones)");
  } else {
    for (const opcion of input.opciones) {
      partes.push(`${opcion.key}) ${opcion.texto || "(vacía)"}`);
    }
  }
  partes.push("");

  partes.push(`## Clave marcada por el docente: ${input.clave || "(ninguna)"}`);

  if (input.protegidos.length > 0) {
    partes.push("");
    partes.push("## Elementos que no puedes ver (no los modifiques)");
    for (const p of input.protegidos) {
      partes.push(`${p.token} → ${p.contexto}`);
    }
  }

  return partes.join("\n");
}
