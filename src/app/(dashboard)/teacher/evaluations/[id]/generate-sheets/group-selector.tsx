"use client";

interface Student {
  id: string;
  name: string;
  code: string;
}

interface GroupData {
  group: { id: string; name: string };
  students: Student[];
}

export function GroupSelector({ groups }: { groups: GroupData[] }) {
  return (
    <>
      {groups.map((g) => {
        if (g.students.length === 0) return null;
        return (
          <details key={g.group.id} className="group mb-3" open>
            <summary className="cursor-pointer text-sm font-medium hover:underline">
              {g.group.name} ({g.students.length} estudiante
              {g.students.length !== 1 ? "s" : ""})
            </summary>
            <div className="mt-2 space-y-1">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    const container = e.currentTarget.closest("details");
                    container
                      ?.querySelectorAll<HTMLInputElement>('input[name="studentIds"]')
                      .forEach((cb) => {
                        cb.checked = checked;
                      });
                  }}
                />
                Seleccionar todos
              </label>
              {g.students.map((s) => (
                <label
                  key={s.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    name="studentIds"
                    value={s.id}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span>{s.name}</span>
                  <span className="text-muted-foreground ml-auto font-mono text-xs">{s.code}</span>
                </label>
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}
