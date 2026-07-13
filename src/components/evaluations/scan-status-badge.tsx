const COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  SCANNED: "bg-blue-100 text-blue-700",
  PROCESSING: "bg-cyan-100 text-cyan-700",
  GRADED: "bg-green-100 text-green-700",
  REVIEW: "bg-red-100 text-red-700",
  COMPLETED: "bg-gray-100 text-gray-700",
  PARTIAL: "bg-orange-100 text-orange-700",
  FAILED: "bg-red-100 text-red-700",
};

const LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  SCANNED: "Escaneada",
  PROCESSING: "Procesando",
  GRADED: "Calificada",
  REVIEW: "Revisión",
  COMPLETED: "Completada",
  PARTIAL: "Parcial",
  FAILED: "Error",
};

export function ScanStatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
  const px = size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-block rounded-full font-medium ${COLORS[status] ?? "bg-gray-100 text-gray-500"} ${px}`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
