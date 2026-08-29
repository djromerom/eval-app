"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import { REVIEW_FILTER_OPTIONS } from "./review-constants";

/** Dropdown client-side que navega a `?status=X` cuando cambia.
 *  SSR-friendly: la URL es la fuente de verdad (compartible, back-button,
 *  sin perder scroll). El page.tsx server-side lee `searchParams.status`
 *  y filtra la query. `useTransition` evita parpadeo entre clicks. */
export function StatusFilter({ current }: { current: EvaluationStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Filtrar por estado"
      value={current}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as EvaluationStatus;
        startTransition(() => {
          router.replace(`/coordinator/review?status=${next}`);
        });
      }}
      className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
    >
      {REVIEW_FILTER_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
