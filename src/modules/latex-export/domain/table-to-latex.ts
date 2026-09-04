/**
 * Stub temporal — implementación completa en L4.
 *
 * El walker ya está completo y testeable; este stub evita un import error
 * durante los commits intermedios. Será reemplazado en el commit L4
 * (tabularx con colwidth preservation).
 */
import type { TipTapNode, WalkerContext } from "./latex-walker";

export function tiptapTableToLatex(node: TipTapNode, _ctx: WalkerContext): string {
  return `% [table stub — full impl in L4: ${node.content?.length ?? 0} rows]`;
}
