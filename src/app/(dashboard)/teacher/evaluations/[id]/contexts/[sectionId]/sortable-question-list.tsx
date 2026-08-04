"use client";

import { useState, useTransition } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { reorderQuestionsAction } from "../../../actions";

/**
 * Lista vertical con drag & drop de las preguntas de una sección.
 *
 * El usuario arrastra con el handle (`GripVertical`) a la izquierda de cada
 * card. Al soltar:
 *  1. Reordenamos optimistamente en cliente (`arrayMove`) para feedback
 *     instantáneo.
 *  2. Llamamos al server action `reorderQuestionsAction` con el nuevo orden
 *     en JSON, que renumera las preguntas 1..N consecutivamente.
 *
 * Si el server action falla, la UI sigue mostrando el orden optimista
 * durante la transición y luego se revalida con `revalidatePath` desde el
 * server, así que el docente ve el estado autoritativo al refrescar.
 */
export function SortableQuestionList({
  evaluationId,
  sectionId,
  questionIds,
  renderItem,
  editable,
}: {
  evaluationId: string;
  sectionId: string;
  questionIds: string[];
  renderItem: (id: string, isDragging: boolean) => React.ReactNode;
  editable: boolean;
}) {
  const [items, setItems] = useState(questionIds);
  const [, startTransition] = useTransition();

  // Si el server reordena y la lista canónica cambia (p.ej. por otra pestaña),
  // sincronizamos. `useState` no se sincroniza automáticamente — lo hacemos
  // con un if durante render: solo entra cuando los arrays difieren, evitando
  // bucles infinitos.
  if (items.join("|") !== questionIds.join("|")) {
    setItems(questionIds);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.indexOf(String(active.id));
    const newIndex = items.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(items, oldIndex, newIndex);
    setItems(newItems);

    startTransition(async () => {
      const fd = new FormData();
      fd.set("evaluationId", evaluationId);
      fd.set("sectionId", sectionId);
      fd.set("orderedIds", JSON.stringify(newItems));
      await reorderQuestionsAction(fd);
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map((id) => (
          <SortableQuestionRow key={id} id={id} editable={editable}>
            {(isDragging) => renderItem(id, isDragging)}
          </SortableQuestionRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableQuestionRow({
  id,
  editable,
  children,
}: {
  id: string;
  editable: boolean;
  children: (isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {editable ? (
        <button
          type="button"
          aria-label="Arrastrar para reordenar"
          title="Arrastrar para reordenar"
          {...attributes}
          {...listeners}
          className="text-muted-foreground/60 hover:text-foreground absolute top-3 left-1 z-10 cursor-grab rounded p-1 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <div className={editable ? "pl-7" : ""}>{children(isDragging)}</div>
    </div>
  );
}
