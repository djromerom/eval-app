"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" size="sm" className="ml-auto" onClick={() => window.print()}>
      Imprimir / Guardar PDF
    </Button>
  );
}
