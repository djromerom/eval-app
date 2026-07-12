interface PageHeaderProps {
  title: string;
  description?: string;
}

/** Encabezado estándar de las páginas del dashboard. */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
    </header>
  );
}
