/**
 * Validación del parámetro `?volver=` que usan las pantallas de detalle para
 * saber a dónde regresar.
 *
 * Es un dato que viene de la URL, así que se trata como entrada hostil: sin
 * validar, un `?volver=https://otro-sitio` convierte el enlace "Volver" en un
 * redirect abierto — el patrón clásico para phishing sobre un dominio de
 * confianza. Solo se aceptan rutas internas.
 *
 * Se rechaza explícitamente:
 *   - cualquier cosa que no empiece con "/" (URLs absolutas, "javascript:")
 *   - "//host" y "/\host", que el navegador resuelve como protocol-relative
 *     y salen del sitio pese a empezar con "/"
 *   - saltos de línea, que permiten inyectar cabeceras
 */
export function safeReturnPath(valor: string | undefined, porDefecto: string): string {
  if (!valor) return porDefecto;
  const v = valor.trim();
  if (!v.startsWith("/")) return porDefecto;
  if (v.startsWith("//") || v.startsWith("/\\")) return porDefecto;
  if (/[\r\n\t]/.test(v)) return porDefecto;
  return v;
}
