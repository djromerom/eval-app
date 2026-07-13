# components/editor — TipTap + KaTeX

Editor de texto enriquecido para el contenido de las evaluaciones (bloques de
contexto y enunciados de preguntas), REQUERIMIENTOS_v2.md §3.3. El contenido se
guarda como **JSON de TipTap** en los campos `Json` del schema (`content`, `text`).

- `extensions.ts` — extensiones **compartidas** (StarterKit, Image, Table…), marco
  agnóstico. Las usan tanto el editor (cliente) como `generateHTML` (servidor).
  NO importar `@tiptap/react` aquí.
- `rich-text-editor.tsx` — `"use client"`. Editor con barra de herramientas
  (negrita, itálica, título, listas, cita, tabla, imagen por URL). Sincroniza su
  documento JSON a un `<input type="hidden" name={name}>`, así los formularios lo
  envían como string JSON y las server actions lo parsean.
- `render.ts` — `renderRichText(value)`: TipTap JSON (o string heredado) → HTML
  seguro, **server-safe**, aplicando **KaTeX** a las fórmulas `$...$` / `$$...$$`.
  `richTextToPlain(value)` extrae texto plano (labels, búsquedas).
- `rich-text.tsx` — componentes de servidor `RichText` (bloque) y `RichTextInline`
  (opciones) que renderizan con `dangerouslySetInnerHTML`.

**Fórmulas**: se escriben como texto `$x^2$` y se renderizan con KaTeX **al
mostrar/imprimir** (no como nodo de TipTap), para funcionar igual en servidor
(impresión, detalle) y en el futuro PDF. El CSS de KaTeX se importa en el layout
raíz; los estilos de prosa están en `globals.css` (`.prose-eval`).

Pendiente: render en vivo de la fórmula dentro del editor (hoy se ve `$x^2$` como
texto mientras se edita), subir imágenes (hoy solo por URL), y usar el editor
también en el banco de preguntas (hoy textarea plano, ya se muestra con KaTeX).
