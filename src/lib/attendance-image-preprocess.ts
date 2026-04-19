import sharp from "sharp";
import type { AttendanceScanImageInput } from "@/lib/ocr-attendance";

export type PreparedAttendanceScanImage = {
  pageNumber: number;
  name: string;
  ocrImage: AttendanceScanImageInput;
  visionImageBase64: string;
  fullImageBase64: string;
  headerImageBase64: string;
};

const TABLE_LEFT_COLUMNS_RATIO = 0.64;

function toBase64(buffer: Buffer) {
  return buffer.toString("base64");
}

async function extractHeaderCrop(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1200;
  const height = metadata.height || 1600;

  return sharp(buffer)
    .extract({
      left: Math.max(0, Math.floor(width * 0.06)),
      top: Math.max(0, Math.floor(height * 0.02)),
      width: Math.min(width - Math.floor(width * 0.06), Math.floor(width * 0.88)),
      height: Math.min(height - Math.floor(height * 0.02), Math.floor(height * 0.18)),
    })
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function preprocessForGemini(buffer: Buffer) {
  return sharp(buffer)
    .resize({ width: 2200, withoutEnlargement: true })
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function preprocessForVision(buffer: Buffer) {
  return sharp(buffer)
    .resize({ width: 2400, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.25 })
    .linear(1.14, -8)
    .png()
    .toBuffer();
}

async function preprocessForTesseract(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1200;
  const height = metadata.height || 1600;

  return sharp(buffer)
    .extract({
      left: 0,
      top: 0,
      width: Math.max(1, Math.floor(width * TABLE_LEFT_COLUMNS_RATIO)),
      height,
    })
    .resize({ width: 2400, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.4 })
    .threshold(182)
    .png()
    .toBuffer();
}

export async function prepareAttendanceScanImages(params: {
  images: AttendanceScanImageInput[];
  onProgress?: (progress: {
    pageNumber: number;
    totalPages: number;
    progress: number;
    message: string;
  }) => void;
}) {
  const prepared: PreparedAttendanceScanImage[] = [];
  const totalPages = Math.max(params.images.length, 1);

  for (let index = 0; index < params.images.length; index += 1) {
    const image = params.images[index];
    const pageNumber = index + 1;

    params.onProgress?.({
      pageNumber,
      totalPages,
      progress: 4 + ((index + 1) / totalPages) * 8,
      message: `Menormalkan gambar ${pageNumber}/${totalPages}...`,
    });

    const sourceBuffer = Buffer.from(image.base64Image.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const normalizedBuffer = await sharp(sourceBuffer)
      .rotate()
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      .toBuffer();

    const [headerImage, fullImage, visionImage, ocrImage] = await Promise.all([
      extractHeaderCrop(normalizedBuffer),
      preprocessForGemini(normalizedBuffer),
      preprocessForVision(normalizedBuffer),
      preprocessForTesseract(normalizedBuffer),
    ]);

    prepared.push({
      pageNumber,
      name: image.name,
      ocrImage: {
        name: `${image.name.replace(/\.[^.]+$/, "") || "scan"}-ocr.png`,
        mimeType: "image/png",
        base64Image: toBase64(ocrImage),
      },
      visionImageBase64: toBase64(visionImage),
      fullImageBase64: toBase64(fullImage),
      headerImageBase64: toBase64(headerImage),
    });
  }

  return prepared;
}
