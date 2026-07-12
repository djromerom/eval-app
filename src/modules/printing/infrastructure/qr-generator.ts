import QRCode from "qrcode";
import { env } from "@/config/env";
import {
  canonicalJson,
  deriveInstitutionSecret,
  signPayload,
} from "@/shared/infrastructure/crypto/hmac";
import type { QrPayload, SignedQrContent } from "@/modules/scanning/domain/qr-payload";

/** Construye el contenido firmado del QR de una hoja de respuestas. */
export function buildSignedQrContent(payload: QrPayload): SignedQrContent {
  const secret = deriveInstitutionSecret(env.QR_SIGNING_SECRET, payload.inst);
  return { ...payload, sig: signPayload(payload, secret) };
}

/** Genera el QR como data URL (PNG) para incrustar en la hoja de respuestas. */
export async function generateQrDataUrl(content: SignedQrContent): Promise<string> {
  const { sig, ...payload } = content;
  return QRCode.toDataURL(JSON.stringify({ ...JSON.parse(canonicalJson(payload)), sig }), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
}
