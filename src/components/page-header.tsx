import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Slot opcional a la derecha del título (botones de export, "Nuevo", etc.).
   *  El header pasa a ser flex; el `title+description` mantiene el ancho
   *  intrínseco y `actions` se empuja a la derecha con `ml-auto`. */
  actions?: ReactNode;
}

/** Encabezado estándar de las páginas del dashboard. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <div className="text-muted-foreground mt-1.5 text-sm">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
