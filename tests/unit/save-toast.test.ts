import { describe, expect, it, vi, beforeEach } from "vitest";

const { success } = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success },
}));

import {
  TOAST_SAVED,
  notifyItemSaved,
  type SaveToastMode,
} from "@/app/(dashboard)/teacher/evaluations/save-toast";

describe("notifyItemSaved", () => {
  beforeEach(() => {
    success.mockClear();
  });

  it("guardado normal → solo el mensaje principal", () => {
    notifyItemSaved("normal");
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(TOAST_SAVED);
  });

  it("por defecto es el guardado normal", () => {
    notifyItemSaved();
    expect(success).toHaveBeenCalledWith(TOAST_SAVED);
  });

  it("IA sin sugerencias → lo dice en la descripción", () => {
    notifyItemSaved("ia-sin-sugerencias");
    expect(success).toHaveBeenCalledWith(TOAST_SAVED, {
      description: "La IA no hizo ninguna sugerencia.",
    });
  });

  it("IA con sugerencias ignoradas → lo dice en la descripción", () => {
    notifyItemSaved("ia-ignorado");
    expect(success).toHaveBeenCalledWith(TOAST_SAVED, {
      description: "Se guardó sin aplicar las sugerencias de la IA.",
    });
  });

  it("corrección de la IA aplicada → lo dice en la descripción", () => {
    notifyItemSaved("ia-corregido");
    expect(success).toHaveBeenCalledWith(TOAST_SAVED, {
      description: "Se guardó con las correcciones sugeridas por la IA.",
    });
  });

  it("IA que no pudo revisar → lo dice en la descripción", () => {
    notifyItemSaved("ia-no-reviso");
    expect(success).toHaveBeenCalledWith(TOAST_SAVED, {
      description: "No se pudo completar la revisión con IA.",
    });
  });

  it("todos los modos usan el mismo texto principal", () => {
    const modos: SaveToastMode[] = [
      "normal",
      "ia-sin-sugerencias",
      "ia-ignorado",
      "ia-corregido",
      "ia-no-reviso",
    ];
    for (const modo of modos) {
      success.mockClear();
      notifyItemSaved(modo);
      expect(success.mock.calls[0]?.[0]).toBe(TOAST_SAVED);
    }
  });
});
