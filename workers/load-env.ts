// Carga .env en procesos standalone (workers ejecutados con `tsx`/`node`), que
// —a diferencia de Next— no lo hacen solos. Debe importarse ANTES que cualquier
// módulo que lea `@/config/env`. En producción (PM2) el entorno ya viene
// inyectado y puede no existir .env: en ese caso se ignora sin error.
try {
  process.loadEnvFile(".env");
} catch {
  // .env ausente → se usa el entorno del proceso tal cual.
}
