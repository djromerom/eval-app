/**
 * HTML de muestra para el editor HTML Live de cover-html.
 *
 * Es una portada institucional con placeholders Mustache que el pipeline
 * de `RenderCover` ya conoce — distinto a la "tarjeta de presentación"
 * del editor original (Ana Martínez) que no aplica al dominio escolar.
 *
 * El botón "Ejemplo" del editor la carga como contenido inicial cuando
 * el docente quiere ver un punto de partida creíble.
 */
export const SAMPLE_COVER_HTML = [
  "<!DOCTYPE html>",
  '<html lang="es">',
  "<head>",
  '  <meta charset="UTF-8">',
  "  <title>Portada institucional</title>",
  "  <style>",
  "    body { font-family: Georgia, serif; background: #f8fafc; color: #0f172a;",
  "           max-width: 720px; margin: 40px auto; padding: 48px;",
  "           border: 1px solid #cbd5e1; border-radius: 8px; }",
  "    h1 { color: #0a4fa8; margin: 0 0 8px; font-size: 28px; }",
  "    .sub { color: #64748b; font-size: 14px; margin: 0 0 24px; }",
  "    hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }",
  "    .footer { color: #94a3b8; font-size: 12px; margin-top: 32px; }",
  "  </style>",
  "</head>",
  "<body>",
  "  <h1>{{bundle.name}}</h1>",
  '  <p class="sub">{{course.name}} &middot; {{period.name}}</p>',
  "  <hr />",
  "  <p><strong>Institución:</strong> {{institution.name}}</p>",
  "  <p><strong>Estudiante:</strong> {{student.fullName}}</p>",
  '  <p class="footer">Edita cualquier texto haciendo clic. Pulsa "Exportar" para descargar el HTML.</p>',
  "</body>",
  "</html>",
].join("\n");
