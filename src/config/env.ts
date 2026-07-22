import { z } from "zod";

/**
 * Validación de variables de entorno del servidor.
 * Falla rápido y con mensaje claro si falta configuración.
 * Importar SOLO desde código de servidor.
 */
const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(16, "AUTH_SECRET debe tener al menos 16 caracteres"),
    AUTH_URL: z.string().url().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_ID: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.string().optional(),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    /** URL base desde la que los workers (PDF/OMR) hacen fetch de las
     *  rutas /print/*. Si está definida, tiene prioridad sobre AUTH_URL.
     *  Útil cuando AUTH_URL apunta al público (https://ecognia.pro) pero
     *  los workers deben apuntar al servidor interno donde corre Next.
     *  Si no está definida, los workers usan AUTH_URL. */
    PRINT_BASE_URL: z.string().url().optional(),
    STORAGE_DIR: z.string().default("./storage"),
    QR_SIGNING_SECRET: z.string().min(16, "QR_SIGNING_SECRET debe tener al menos 16 caracteres"),
    /** URL del microservicio Python de detección OMR (omr-service, FastAPI).
     *  Solo loopback: el worker OMR lo llama; nunca se expone públicamente. */
    OMR_SERVICE_URL: z.string().url().default("http://127.0.0.1:8000"),
    /** Opciones con las que se inicializa el editor de preguntas nuevas. */
    EVAL_DEFAULT_OPTIONS: z.coerce
      .number()
      .int()
      .min(2, "EVAL_DEFAULT_OPTIONS debe ser ≥ 2")
      .max(8, "EVAL_DEFAULT_OPTIONS debe ser ≤ 8 (máximo de la librería)")
      .default(4),
    /** Tope institucional para el número de opciones por pregunta. La
     *  librería (AnswerKey) tiene como techo absoluto 8 (A–H); este
     *  valor nunca puede superar 8. */
    EVAL_MAX_OPTIONS: z.coerce
      .number()
      .int()
      .min(2, "EVAL_MAX_OPTIONS debe ser ≥ 2")
      .max(8, "EVAL_MAX_OPTIONS debe ser ≤ 8 (máximo de la librería)")
      .default(8),
  })
  .refine((e) => e.EVAL_DEFAULT_OPTIONS <= e.EVAL_MAX_OPTIONS, {
    message: "EVAL_DEFAULT_OPTIONS no puede ser mayor que EVAL_MAX_OPTIONS",
    path: ["EVAL_DEFAULT_OPTIONS"],
  });

function loadEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
