"use client";

import { useMemo, useState, useTransition } from "react";

import { Switch } from "@/components/ui/switch";
import {
  toggleDisabledQuestionAction,
  type ToggleDisabledQuestionCode,
} from "./disabled-questions-action";

// ============================================================================
// Tipos espejo de los DTOs del use case. Re-declarados localmente (no
// importamos desde `@/modules/...`) porque Next.js client components no
// deben depender de tipos de la capa de aplicación — la barrera entre
// server (use case) y client (componente) es el server component que
// carga los datos y los pasa serializados.
// ============================================================================

interface BundleQuestionForToggle {
  questionId: string;
  bundlePosition: number;
  evaluationOrder: number;
  evaluationTitle: string;
  sectionOrder: number;
  sectionTitle: string | null;
  questionNumber: number;
  statementJson: unknown;
  disabled: boolean;
  disabledAt: Date | null;
  disabledByUserId: string | null;
}

interface BundleQuestionsForToggle {
  bundleId: string;
  bundleStatus: "DRAFT" | "READY";
  hasAnyScanBatch: boolean;
  totalQuestions: number;
  disabledCount: number;
  questions: BundleQuestionForToggle[];
}

// ============================================================================
// Helpers locales — sin tests unitarios (helpers triviales de presentación).
// ============================================================================

/**
 * Convierte un documento TipTap JSON a texto plano concatenado.
 * Itera recursivamente sobre `content[]` y extrae `text` de los nodos
 * `text`. Los nodos de bloque (paragraph, heading, etc.) se separan por
 * un espacio para no pegar enunciados consecutivos.
 *
 * NO parsea marcas (bold, italic) — son ruido para el preview. Si el
 * enunciado tiene una imagen, devuelve "" (no representable en texto).
 */
function tiptapJsonToPlain(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    // Los hijos de un nodo contenedor de bloques (doc, listas, blockquote…)
    // son bloques: se separan con espacio para que dos párrafos no salgan
    // pegados. Los hijos de un paragraph/heading son inline: se concatenan.
    const isBlockContainer =
      n.type === "doc" ||
      n.type === "bulletList" ||
      n.type === "orderedList" ||
      n.type === "listItem" ||
      n.type === "blockquote";
    return n.content.map(tiptapJsonToPlain).join(isBlockContainer ? " " : "");
  }
  return "";
}

/** Trunca `s` a `max` caracteres, agregando "…" si se cortó. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}

// ============================================================================
// Componente
// ============================================================================

/**
 * Panel de inhabitaciones del cuadernillo (PR #3 del sprint Preguntas
 * inhabitadas, sep 2026). Lista cada pregunta del cuadernillo con un
 * Switch shadcn para inhabitarla / re-habilitarla.
 *
 * Reglas UI:
 *   - Si `data.hasAnyScanBatch`: banner amarillo + TODOS los switches
 *     disabled (lock post-scan — el use case de mutación lo enforza a
 *     nivel DB-query, acá solo reflejamos el lock).
 *   - `LOCKED_SCAN` (race condition: entre carga y click se subió un
 *     ScanBatch) → banner bulk (afecta a todo el bundle).
 *   - `LAST_EFFECTIVE` (intentar inhabitarla última efectiva) → error
 *     contextual pegado a la pregunta.
 *   - Otros errores (NOT_IN_BUNDLE, NOT_FOUND, FORBIDDEN) → banner bulk.
 *
 * El enunciado se muestra truncado a 200 chars con el texto completo
 * accesible vía `title` (hover). Decisión confirmada con el docente.
 */
export function DisabledQuestionsManager({
  bundleId,
  data,
}: {
  bundleId: string;
  data: BundleQuestionsForToggle;
}) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Hidratamos el enunciado plano UNA vez por render (los statementJson
  // vienen del server y no cambian entre renders sin revalidatePath).
  const plainStatements = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of data.questions) {
      m.set(q.questionId, tiptapJsonToPlain(q.statementJson).trim());
    }
    return m;
  }, [data.questions]);

  const handleToggle = (questionId: string, nextDisabled: boolean) => {
    // Limpiamos errores previos antes de empezar.
    setBulkError(null);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
    startTransition(async () => {
      const r = await toggleDisabledQuestionAction(bundleId, questionId, nextDisabled);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
      if (r.code) {
        routeError(r.code, r.error ?? "Error", questionId);
      }
    });
  };

  const routeError = (code: ToggleDisabledQuestionCode, message: string, questionId: string) => {
    if (code === "LOCKED_SCAN") {
      setBulkError(message);
      return;
    }
    if (code === "LAST_EFFECTIVE" || code === "NOT_IN_BUNDLE") {
      setRowErrors((prev) => ({ ...prev, [questionId]: message }));
      return;
    }
    setBulkError(message);
  };

  // Agrupamos por (evaluación, sección) para que el render refleje la
  // jerarquía del cuadernillo impreso (más fácil de mapear pregunta↔bundle).
  type Group = {
    evaluationOrder: number;
    evaluationTitle: string;
    sections: Map<
      number,
      { sectionOrder: number; sectionTitle: string | null; questions: BundleQuestionForToggle[] }
    >;
  };
  const groups: Group[] = [];
  const groupIndex = new Map<string, Group>(); // key = `${evalOrder}`
  for (const q of data.questions) {
    let g = groupIndex.get(String(q.evaluationOrder));
    if (!g) {
      g = {
        evaluationOrder: q.evaluationOrder,
        evaluationTitle: q.evaluationTitle,
        sections: new Map(),
      };
      groupIndex.set(String(q.evaluationOrder), g);
      groups.push(g);
    }
    let s = g.sections.get(q.sectionOrder);
    if (!s) {
      s = {
        sectionOrder: q.sectionOrder,
        sectionTitle: q.sectionTitle,
        questions: [],
      };
      g.sections.set(q.sectionOrder, s);
    }
    s.questions.push(q);
  }

  const effectiveCount = data.totalQuestions - data.disabledCount;
  const lockActive = data.hasAnyScanBatch;

  return (
    <div className="bg-card space-y-4 rounded-xl border p-6">
      <div className="space-y-1">
        <h2 className="font-semibold">Preguntas del cuadernillo</h2>
        <p className="text-muted-foreground text-xs">
          {data.totalQuestions} preguntas · {effectiveCount} efectivas · {data.disabledCount}{" "}
          inhabitadas
        </p>
      </div>

      {lockActive ? (
        <div
          className="bg-accent/30 border-accent/40 rounded-md border-2 border-dashed p-3 text-xs"
          role="status"
        >
          Este cuadernillo ya tiene hojas escaneadas — las inhabitaciones no se pueden modificar.
          Crea un cuadernillo nuevo si necesitas excluir preguntas.
        </div>
      ) : null}

      {bulkError ? (
        <p className="text-destructive text-xs" role="alert">
          {bulkError}
        </p>
      ) : null}

      {data.questions.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Este cuadernillo aún no tiene preguntas.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.evaluationOrder} className="space-y-3">
              <h3 className="font-display text-sm font-bold">
                {g.evaluationOrder}. {g.evaluationTitle}
              </h3>
              {Array.from(g.sections.values()).map((s) => (
                <div key={`${g.evaluationOrder}-${s.sectionOrder}`} className="space-y-2">
                  <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {s.sectionTitle ?? `Sección ${s.sectionOrder}`}
                  </h4>
                  <ul className="space-y-1">
                    {s.questions.map((q) => {
                      const fullStatement = plainStatements.get(q.questionId) ?? "";
                      const isPending = pendingIds.has(q.questionId);
                      const rowError = rowErrors[q.questionId];
                      return (
                        <li
                          key={q.questionId}
                          className={
                            q.disabled
                              ? "bg-muted text-muted-foreground flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
                              : "flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
                          }
                        >
                          <span className="w-12 shrink-0 pt-1 font-mono text-xs">
                            #{q.bundlePosition}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className={
                                q.disabled
                                  ? "text-sm leading-snug line-through"
                                  : "text-sm leading-snug"
                              }
                              title={fullStatement}
                            >
                              {truncate(fullStatement, 200)}
                            </p>
                            {q.disabled ? (
                              <span className="bg-muted text-muted-foreground mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium">
                                No efectiva
                              </span>
                            ) : null}
                            {rowError ? (
                              <p className="text-destructive mt-1 text-xs" role="alert">
                                {rowError}
                              </p>
                            ) : null}
                          </div>
                          <div className="shrink-0 pt-1">
                            <Switch
                              checked={q.disabled}
                              disabled={lockActive || isPending}
                              onCheckedChange={(next) => handleToggle(q.questionId, next)}
                              aria-label={
                                q.disabled ? "Re-habilitar pregunta" : "Inhabilitar pregunta"
                              }
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
