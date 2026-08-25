/**
 * Calcula qué archivos del save anterior quedaron huérfanos tras un
 * nuevo save (ago 2026).
 * ==============================================================
 *
 * Son los `priorExtracted` (paths escritos por el save anterior) que NO
 * aparecen ni en `extractedAssets` (los nuevos) ni referenciados como
 * URL `/api/uploads/...` dentro de `slimHtml`.
 *
 * ## Por qué existe
 *
 * El orden anterior en `saveCoverHtmlAction` borraba los archivos del
 * save anterior ANTES de extraer los nuevos. Si el iframe del navegador
 * tenía esas URLs en HTTP cache y el cache fallaba al miss (p.ej.
 * recarga tras `revalidatePath`), recibía 404 → imagen rota. Con este
 * helper, los archivos se mantienen hasta confirmar que el nuevo HTML
 * ya no los referencia.
 *
 * ## Casos cubiertos
 *
 *   • Save CON editar: el HTML que llega al action ya venía con URLs
 *     (de la carga previa del iframe tras la primera extracción),
 *     `extractInlineAssets` no extrajo nada nuevo (`extractedAssets = []`),
 *     pero `slimHtml` sigue apuntando a esos archivos. **NO se borran.**
 *
 *   • Re-save SIN editar (mismo contenido): `slimHtml` no cambia,
 *     `extractedAssets = []`. Las URLs del save anterior se mantienen
 *     — útil cuando el iframe todavía las tiene en cache HTTP.
 *
 *   • Save con contenido nuevo: `extractInlineAssets` genera URLs
 *     nuevas; las viejas quedan huérfanas y se pueden borrar.
 *
 * ## Pureza
 *
 * Esta función no toca disco ni Prisma — recibe solo strings/arrays.
 * Se testea directamente en `tests/unit/compute-orphan-assets.test.ts`.
 */
export function computeOrphanAssets(params: {
  priorExtracted: readonly string[];
  slimHtml: string;
  extractedAssets: readonly string[];
}): string[] {
  const urlsToKeep = new Set<string>(params.extractedAssets);

  // Sumar también cualquier URL `/api/uploads/...` referenciada dentro
  // de slimHtml. Capturamos todo lo que NO sea quote/paren/space — eso
  // cubre `<img src="...">`, `url(...)`, etc.
  const urlRegex = /\/api\/uploads\/([^"'()\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(params.slimHtml)) !== null) {
    // El capture group es `+` (≥1 char), así que si el match global
    // acertó, `match[1]` siempre existe. El `!` es seguro por construcción
    // del patrón — TS no analiza la semántica de regex.
    urlsToKeep.add(match[1]!);
  }

  return params.priorExtracted.filter((p) => !urlsToKeep.has(p));
}
