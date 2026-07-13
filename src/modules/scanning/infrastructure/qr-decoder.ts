import decodeQR from "qr/decode.js";
import sharp from "sharp";
import type { QrDecoder } from "../domain/answer-sheet";

export const sharpQrDecoder: QrDecoder = {
  async decode(buffer: Buffer) {
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    try {
      const text = decodeQR({ width: info.width, height: info.height, data });
      return text ? { text } : null;
    } catch {
      return null;
    }
  },
};
