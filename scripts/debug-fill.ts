import sharp from "sharp";
import {
  preprocessScan,
  measureFillRatio,
} from "@/modules/scanning/infrastructure/preprocess-image";

async function main() {
  const W = 1200,
    H = 1700;
  const r = Math.round(W * 0.006); // 7px radius as in verify-omr
  const cx = Math.round(W * 0.39); // B column
  const cy = Math.round(H * 0.05); // row 0
  const bubbleDiamPx = 14;

  // SVG circle (same as verify-omr)
  const sheet = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${W}" height="${H}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="black"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const binary = await preprocessScan(sheet);
  const ratio = await measureFillRatio(binary, {
    left: cx - Math.floor(bubbleDiamPx / 2),
    top: cy - Math.floor(bubbleDiamPx / 2),
    width: bubbleDiamPx,
    height: bubbleDiamPx,
  });
  console.log(`Circle (r=${r}) at (${cx},${cy}) 14×14: ${ratio.toFixed(4)}`);
  console.log(`classify: ${ratio > 0.6 ? "MARKED" : ratio < 0.2 ? "EMPTY" : "AMBIGUOUS"}`);

  // Same with a rect
  const sheet2 = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${W}" height="${H}"><rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" fill="black"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const binary2 = await preprocessScan(sheet2);
  const ratio2 = await measureFillRatio(binary2, {
    left: cx - 7,
    top: cy - 7,
    width: 14,
    height: 14,
  });
  console.log(`Rect at (${cx},${cy}) 14×14: ${ratio2.toFixed(4)}`);
  console.log(`classify: ${ratio2 > 0.6 ? "MARKED" : ratio2 < 0.2 ? "EMPTY" : "AMBIGUOUS"}`);
}

main().catch(console.error);
