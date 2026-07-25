import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import type { Difficulty } from "@/modules/question-bank/domain/bank-question";
import type { SoloLevel } from "@/modules/evaluations/domain/evaluation";
import { makeSearchBankQuestions } from "@/modules/question-bank/infrastructure/container";
import { makeListSubjects } from "@/modules/academic/infrastructure/container";
import { BankQuestionForm } from "./bank-question-form";

export const metadata: Metadata = { title: "Banco de preguntas" };

const DIFF_LABEL: Record<Difficulty, string> = { EASY: "Fácil", MEDIUM: "Media", HARD: "Difícil" };
const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

export default async function QuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const sp = await searchParams;

  const subjectsRes = await makeListSubjects().execute({ actor });
  const subjects = subjectsRes.ok ? subjectsRes.value : [];

  const resultsRes = await makeSearchBankQuestions().execute({
    actor,
    filters: {
      subjectId: sp.subjectId || undefined,
      difficulty: (sp.difficulty as Difficulty) || undefined,
      soloLevel: (sp.soloLevel as SoloLevel) || undefined,
      search: sp.q || undefined,
      onlyMine: sp.onlyMine === "1",
    },
  });
  const questions = resultsRes.ok ? resultsRes.value : [];

  return (
    <>
      <PageHeader
        title="Banco de preguntas"
        description="Preguntas reutilizables (institucional y personal). Impórtalas a tus formulaciones."
      />

      <section className="bg-card space-y-4 rounded-xl border p-6">
        <h2 className="font-semibold">Nueva pregunta de banco</h2>
        <BankQuestionForm subjects={subjects} />
      </section>

      <form className="mt-8 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Buscar</label>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Texto del enunciado"
            className={`${selectClass} w-56`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Asignatura</label>
          <select name="subjectId" defaultValue={sp.subjectId ?? ""} className={selectClass}>
            <option value="">Todas</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Dificultad</label>
          <select name="difficulty" defaultValue={sp.difficulty ?? ""} className={selectClass}>
            <option value="">Todas</option>
            <option value="EASY">Fácil</option>
            <option value="MEDIUM">Media</option>
            <option value="HARD">Difícil</option>
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name="onlyMine"
            value="1"
            defaultChecked={sp.onlyMine === "1"}
            className="accent-primary"
          />
          Solo mías
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filtrar
        </Button>
      </form>

      <div className="mt-4 space-y-3">
        {questions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay preguntas que coincidan.</p>
        ) : (
          questions.map((q) => (
            <div key={q.id} className="rounded-lg border p-4">
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <span className="bg-muted rounded-full px-2 py-0.5">{q.subjectName}</span>
                <span className="bg-muted rounded-full px-2 py-0.5">
                  {DIFF_LABEL[q.difficulty]}
                </span>
                {q.isPersonal ? (
                  <span className="bg-muted rounded-full px-2 py-0.5">Personal</span>
                ) : (
                  <span className="bg-muted rounded-full px-2 py-0.5">Institucional</span>
                )}
                {q.tags.map((t) => (
                  <span key={t} className="bg-primary/10 text-primary rounded-full px-2 py-0.5">
                    #{t}
                  </span>
                ))}
              </div>
              <p className="mt-2 font-medium">{String(q.text)}</p>
              <ul className="text-muted-foreground mt-1 text-sm">
                {q.options.map((o) => (
                  <li key={o.key} className={o.key === q.correctAnswer ? "text-primary" : ""}>
                    {o.key}) {String(o.text)}
                    {o.key === q.correctAnswer ? " ✓" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </>
  );
}
