/**
 * README.md para el ZIP LaTeX (L6 — sep 2026).
 * ============================================
 *
 * Texto fijo en español. El docente lo lee en el explorador de Overleaf
 * para entender cómo abrir el proyecto. NO es lógica — solo contenido.
 *
 * Lo importante:
 *   • Cómo subir el ZIP a Overleaf.
 *   • Estructura de archivos (`main.tex`, `eval-N.tex`, `images/`).
 *   • Caveats específicos de KaTeX → LaTeX que el docente puede
 *     encontrarse al recompilar (macros como `\class{}`, `\textcolor{}`,
 *     `\\` para newline en celdas).
 *   • Imágenes externas omitidas (debe subirlas manualmente a Overleaf).
 *   • Numbering continuo entre archivos.
 */

export function buildReadme(): string {
  return `# Cuadernillo editable en LaTeX

Este ZIP contiene las preguntas del cuadernillo en formato LaTeX, listas
para editar y recompilar en Overleaf.

## Cómo abrirlo en Overleaf

1. Ve a [overleaf.com](https://www.overleaf.com) e inicia sesión.
2. Haz clic en **"New Project"** → **"Upload"**.
3. Arrastra este ZIP completo (o selecciónalo desde el explorador).
4. Overleaf extraerá los archivos automáticamente y mostrará \`main.tex\`
   como documento principal.
5. Pulsa **"Recompile"** para generar el PDF.

## Estructura del proyecto

\`\`\`
.
├── README.md          ← este archivo
├── main.tex           ← documento raíz (NO editar estructura de preamble)
├── eval-1.tex         ← Formulación 1 (editable libremente)
├── eval-2.tex         ← Formulación 2 (editable libremente)
├── ...
├── eval-N.tex         ← Formulación N
└── images/
    ├── img-1.png      ← imágenes embebidas (NO renombrar)
    ├── img-2.jpg
    └── ...
\`\`\`

- **\`main.tex\`** orquesta todos los demás con \`\\input{eval-N.tex}\`.
  Contiene el preamble y los paquetes — no necesitas editarlo a menos
  que quieras cambiar márgenes, tipografía o paquetes.
- **\`eval-N.tex\`** son **fragmentos** sin \`\\documentclass\`. Puedes
  editar texto, reorganizar preguntas, añadir/quitar imágenes. Cada
  archivo corresponde a una formulación del cuadernillo.
- **\`images/\`** contiene los binarios de las imágenes incrustadas en las
  preguntas. Si renombras los archivos aquí, debes actualizar las
  referencias \`\\includegraphics{images/...}\` dentro de \`eval-N.tex\`.

## Caveats al recompilar

### Macros específicas de KaTeX

El renderizador KaTeX que usa el editor produce algunas macros que el
LaTeX stock no reconoce. Si ves un error como:

- **\`\\class{...}{...}\`** → reemplaza por su contenido (KaTeX la usa
  para asignar clases CSS; no aporta en LaTeX).
- **\`\\textcolor{...}{...}\`** → reemplaza por \`{\\color{...} ...}\` y
  añade \`\\usepackage{xcolor}\` al preamble, o simplemente quita el
  wrapper.
- **\`\\rule{...}{...}\`** → generalmente compila; ignora el warning si
  sale.

### Newlines en celdas de tabla

KaTeX usa \`\\\\\` para saltos de línea; en LaTeX eso es terminador de
fila de tabla y rompe la compilación. El conversor ya reemplaza
automáticamente \`\\\\\` por \`\\newline\` **dentro de celdas
\`tabularx\`**, pero si insertas manualmente un salto dentro de una
celda, usa \`\\newline\` explícitamente.

### Numeración continua entre archivos

Las preguntas se numeran de forma continua en todo el cuadernillo (la
pregunta 1 del eval-1, luego la pregunta 1 del eval-2 sigue a la última
del eval-1, etc.). Si reorganizas o mueves preguntas entre archivos,
ajusta el argumento \`[start=N]\` de los entornos \`enumerate\` en los
\`eval-N.tex\` afectados.

## Imágenes externas

Si una pregunta tenía una imagen con URL externa (\`https://...\` o
\`data:...\`) o ruta que el sistema no pudo resolver, fue **omitida** y
sustituida por un comentario \`% [imagen externa omitida: ...]\` en el
\`eval-N.tex\` correspondiente. Para incluir esa imagen:

1. Descárgala manualmente.
2. Súbela a Overleaf (panel izquierdo → "Upload" → arrastra el archivo).
3. Renombra el comentario reemplazando la línea completa por
   \`\\includegraphics[width=...]{nombre-del-archivo}\`.

## Soporte

Si encuentras errores de compilación o quieres pedir mejoras al
conversor, contacta al equipo de Eval indicando la pregunta/sección
afectada.
`;
}
