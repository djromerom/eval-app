import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
}

/** Encabezado estándar de las páginas del dashboard. */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="mb-8">
      <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      {description ? (
        <div className="text-muted-foreground mt-1.5 text-sm">{description}</div>
      ) : null}
    </header>
  );
}
