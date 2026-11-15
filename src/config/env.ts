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
    /** Tiempo máximo (ms) que el worker espera el análisis de una hoja en
     *  omr-service. Una hoja pesada o con QR ilegible (el motor busca el QR
     *  en toda la hoja y corre el OCR de identidad) puede pasar de 30 s en
     *  un servidor chico. */
    OMR_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    /** Tiempo (ms) que la request HTTP espera a que el worker PDF termine el
     *  job encolado (BullMQ `waitUntilFinished`). Un cuadernillo con 1.400
     *  estudiantes o un informe por grupo de 49 grupos puede tardar varios
     *  minutos en Chromium; si la espera se corta antes, la ruta responde
     *  504 aunque el worker siga trabajando. */
    PDF_QUEUE_WAIT_MS: z.coerce.number().int().positive().default(900_000),
    /** Tiempo (ms) de las operaciones de Chromium en la ruta /print: la
     *  carga de la página (`page.goto`), la generación del PDF (`page.pdf`)
     *  y la captura de la hoja. Sin timeout explícito, Puppeteer usa 30 s por
     *  defecto y una hoja de respuestas unificada de un grado entero (cientos
     *  de páginas carta) revienta con "Timed out after waiting 30000ms". */
    PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
    /** Tiempo (ms) que el worker espera a que el `PrintImageSizer` del
     *  cliente termine de aplicar los topes de calidad de las imágenes. */
    PDF_IMAGE_WAIT_MS: z.coerce.number().int().positive().default(120_000),
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
    /** Prefijo BullMQ para aislar el namespace de jobs por ambiente.
     *  Vacío (default) en prod → BullMQ usa "bull:". En staging se setea
     *  a "stg:" → jobs viven bajo "bull:stg:". Sin este prefijo, dos
     *  ambientes que comparten Redis se pisan jobs entre sí. */
    BULLMQ_PREFIX: z.string().default(""),
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
