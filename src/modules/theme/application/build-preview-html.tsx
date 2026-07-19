/**
 * Construye un HTML reducido del cuadernillo aplicando `themeToCssVars()`.
 *
 * Se usa tanto en el designer de evaluación (teacher) como en el de
 * compendio (admin bundles). Reutilizable porque la maqueta es la misma:
 * una hoja de preview que muestra cómo afecta cada ajuste del tema al
 * cuadernillo final (cover, intro, separador, footer).
 *
 * NO renderiza el cuadernillo real (eso vive en `/print/...` con auth,
 * estilos completos y tipografía real). Este preview muestra una maqueta
 * con la MISMA CSS-variable bridge que la página real — suficiente para
 * que el admin / docente vea el efecto de cada ajuste antes de imprimir.
 *
 * Si en el futuro la fidelidad pixel-perfect del preview es crítica, mover
 * el iframe a una página real con un query-string `?preview=1` y dejar que
 * el server renderice — pero esa migración no es prioritaria ahora.
 */
import { type ResolvedTheme, themeToCssVars } from "../domain/theme";

export function buildPreviewHtml(theme: ResolvedTheme): string {
  const cssVars = themeToCssVars(theme);
  const vars = Object.entries(cssVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
  // Render plano del TipTap JSON para el preview (no necesitamos rich-text
  // exacto, solo que el docente vea que su bloque aparece antes de las
  // preguntas). La página real usa el `RichText` component.
  const introHtml = theme.introText ? renderTipTapPreview(theme.introText) : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
  :root { ${vars} }
  body {
    font-family: var(--print-font-family);
    line-height: var(--print-line-height);
    color: #111;
    margin: 0;
    padding: 24px;
  }
  .cover {
    text-align: center;
    padding: 40px 20px;
    border: 2px solid var(--print-primary);
  }
  .cover-logo {
    display: var(--print-show-logo);
    width: 80px; height: 80px;
    margin: 0 auto 16px;
    border: 1px dashed #999;
    border-radius: 4px;
    line-height: 80px;
    color: #999;
    font-size: 11px;
  }
  .cover h1 { color: var(--print-primary); font-size: 22px; margin: 8px 0; }
  .cover h2 { font-size: 14px; margin: 4px 0; font-weight: normal; }
  .cover .subtitle { color: var(--print-primary); font-weight: bold; }
  .intro {
    background: #fafafa;
    border-left: 3px solid var(--print-primary);
    padding: 10px 14px;
    margin: 18px 0;
    font-size: 13px;
  }
  .intro p { margin: 4px 0; }
  .intro h3 { color: var(--print-primary); font-size: 14px; margin: 6px 0 4px; }
  .intro ul, .intro ol { margin: 4px 0 4px 20px; }
  .section-divider {
    border: 0;
    margin: 18px 0;
    border-top: 1px solid var(--print-primary);
  }
  .section-divider.double { border-top: 3px double var(--print-primary); }
  .section-divider.dots { border-top: 1px dotted var(--print-primary); height: 6px; }
  .q { margin: 10px 0; }
  .footer {
    margin-top: 30px;
    padding-top: 6px;
    border-top: 1px solid #ccc;
    text-align: center;
    font-size: 10px;
    color: #555;
  }
  .footer::before { content: var(--print-footer-text); }
</style>
</head>
<body>
  <div class="cover">
    <div class="cover-logo">logo</div>
    <h1>I.E. Colegio Demo</h1>
    <h2>Prueba de Matemáticas — 11°</h2>
    ${theme.coverSubtitle ? `<p class="subtitle">${escapeHtml(theme.coverSubtitle)}</p>` : ""}
  </div>
  ${introHtml}
  <hr class="section-divider ${theme.sectionDivider}" />
  <div class="q"><strong>1.</strong> ¿Cuál es el resultado de 2 + 2?</div>
  <div class="q"><strong>2.</strong> Pregunta de opción múltiple con 4 alternativas…</div>
  <hr class="section-divider ${theme.sectionDivider}" />
  <div class="q"><strong>3.</strong> Otra pregunta después del divisor de sección.</div>
  <div class="footer"></div>
</body>
</html>`;
}

/**
 * Render minimalista de TipTap JSON para el preview. Solo necesitamos los
 * nodos que el docente típicamente usa en un intro (paragraph, heading,
 * bulletList, orderedList). Los nodos desconocidos se ignoran.
 */
function renderTipTapPreview(doc: Record<string, unknown>): string {
  const out: string[] = [];
  const content = Array.isArray(doc.content) ? (doc.content as unknown[]) : [];
  for (const node of content) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    const text = collectText(n);
    switch (n.type) {
      case "paragraph":
        out.push(`<p>${escapeHtml(text)}</p>`);
        break;
      case "heading": {
        const level =
          typeof n.attrs === "object" && n.attrs && "level" in n.attrs
            ? ((n.attrs as { level?: number }).level ?? 3)
            : 3;
        out.push(`<h${level}>${escapeHtml(text)}</h${level}>`);
        break;
      }
      case "bulletList":
        out.push(renderList(n, "ul"));
        break;
      case "orderedList":
        out.push(renderList(n, "ol"));
        break;
      default:
        // Bloque desconocido (blockquote, codeBlock, etc.) → solo el texto.
        if (text) out.push(`<p>${escapeHtml(text)}</p>`);
        break;
    }
  }
  return out.length ? `<div class="intro">${out.join("")}</div>` : "";
}

function renderList(n: Record<string, unknown>, tag: "ul" | "ol"): string {
  const items = Array.isArray(n.content) ? (n.content as unknown[]) : [];
  const li = items
    .map((it) => {
      if (!it || typeof it !== "object") return "";
      const item = it as Record<string, unknown>;
      return `<li>${escapeHtml(collectText(item))}</li>`;
    })
    .join("");
  return `<${tag}>${li}</${tag}>`;
}

function collectText(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return (node.content as unknown[])
      .map((c) => (c && typeof c === "object" ? collectText(c as Record<string, unknown>) : ""))
      .join("");
  }
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
