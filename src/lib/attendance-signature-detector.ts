import sharp from "sharp";
import type { DetectedAttendanceCandidate } from "@/lib/ocr-attendance";

type SignaturePageInput = {
  pageNumber: number;
  signatureImageBase64: string;
};

export type AttendanceSignatureDetectionResult = {
  active: boolean;
  presentRowKeys: string[];
  notes: string[];
};

const TITLE_TOP_RATIO = 0.075;
const TABLE_HEIGHT_RATIO = 0.89;
const SIGNATURE_LEFT_RATIO = 0.79;
const SIGNATURE_RIGHT_RATIO = 0.97;
const CELL_MARGIN_X_RATIO = 0.06;
const CELL_MARGIN_Y_RATIO = 0.16;
const DARK_PIXEL_THRESHOLD = 180;

function quantile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

function rowKey(pageNumber: number, rowNumber: number) {
  return `${pageNumber}:${rowNumber}`;
}

function base64ToBuffer(base64Image: string) {
  return Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ""), "base64");
}

function getRowNumbersForPage(candidates: DetectedAttendanceCandidate[], pageNumber: number) {
  return Array.from(
    new Set(
      candidates
        .filter((candidate) => candidate.pageNumber === pageNumber)
        .map((candidate) => candidate.rowNumber)
        .filter((rowNumber): rowNumber is number => typeof rowNumber === "number" && Number.isFinite(rowNumber) && rowNumber >= 1),
    ),
  ).sort((left, right) => left - right);
}

function computeSignatureScore(params: {
  pixels: Buffer;
  channels: number;
  width: number;
  height: number;
  rowTop: number;
  rowBottom: number;
}) {
  const signatureLeft = Math.max(0, Math.floor(params.width * SIGNATURE_LEFT_RATIO));
  const signatureRight = Math.min(params.width, Math.ceil(params.width * SIGNATURE_RIGHT_RATIO));
  const signatureWidth = Math.max(1, signatureRight - signatureLeft);
  const rowHeight = Math.max(1, params.rowBottom - params.rowTop);

  const innerLeft = Math.min(signatureRight - 1, signatureLeft + Math.floor(signatureWidth * CELL_MARGIN_X_RATIO));
  const innerRight = Math.max(innerLeft + 1, signatureRight - Math.floor(signatureWidth * CELL_MARGIN_X_RATIO));
  const innerTop = Math.min(params.rowBottom - 1, params.rowTop + Math.floor(rowHeight * CELL_MARGIN_Y_RATIO));
  const innerBottom = Math.max(innerTop + 1, params.rowBottom - Math.floor(rowHeight * CELL_MARGIN_Y_RATIO));

  const innerWidth = Math.max(1, innerRight - innerLeft);
  const innerHeight = Math.max(1, innerBottom - innerTop);
  const minDarkPerColumn = Math.max(2, Math.floor(innerHeight * 0.04));

  let darkPixels = 0;
  let inkColumns = 0;

  for (let x = innerLeft; x < innerRight; x += 1) {
    let darkInColumn = 0;
    for (let y = innerTop; y < innerBottom; y += 1) {
      const index = (y * params.width + x) * params.channels;
      const value = params.pixels[index] ?? 255;
      if (value < DARK_PIXEL_THRESHOLD) {
        darkPixels += 1;
        darkInColumn += 1;
      }
    }

    if (darkInColumn >= minDarkPerColumn) {
      inkColumns += 1;
    }
  }

  const area = innerWidth * innerHeight;
  const darkPixelRatio = darkPixels / Math.max(area, 1);
  const inkColumnRatio = inkColumns / Math.max(innerWidth, 1);
  const score = darkPixelRatio * 100 + inkColumnRatio * 30;

  return {
    darkPixelRatio,
    inkColumnRatio,
    score,
  };
}

export async function detectAttendanceRowsWithSignature(params: {
  pages: SignaturePageInput[];
  candidates: DetectedAttendanceCandidate[];
}): Promise<AttendanceSignatureDetectionResult> {
  const notes: string[] = [];
  const presentRowKeys = new Set<string>();
  let active = false;

  for (const page of params.pages) {
    const pageRowNumbers = getRowNumbersForPage(params.candidates, page.pageNumber);
    const highestRowNumber = pageRowNumbers.length > 0 ? Math.max(...pageRowNumbers) : 0;

    if (pageRowNumbers.length < 10 || highestRowNumber < 10) {
      continue;
    }

    const image = sharp(base64ToBuffer(page.signatureImageBase64)).grayscale();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const titleCutoffY = Math.max(1, Math.round(info.height * TITLE_TOP_RATIO));
    const tableBottomY = Math.min(info.height, Math.round(titleCutoffY + info.height * TABLE_HEIGHT_RATIO));
    const tableHeight = Math.max(1, tableBottomY - titleCutoffY);
    const rowHeight = tableHeight / highestRowNumber;
    const rowScores: Array<{ rowNumber: number; score: number; darkPixelRatio: number; inkColumnRatio: number }> = [];

    for (let rowNumber = 1; rowNumber <= highestRowNumber; rowNumber += 1) {
      const rowTop = Math.max(0, Math.floor(titleCutoffY + (rowNumber - 1) * rowHeight));
      const rowBottom = Math.min(info.height, Math.ceil(titleCutoffY + rowNumber * rowHeight));
      rowScores.push({
        rowNumber,
        ...computeSignatureScore({
          pixels: data,
          channels: info.channels,
          width: info.width,
          height: info.height,
          rowTop,
          rowBottom,
        }),
      });
    }

    const scoreBaseline = quantile(rowScores.map((row) => row.score), 0.35);
    const darkBaseline = quantile(rowScores.map((row) => row.darkPixelRatio), 0.35);
    const threshold = Math.max(1.4, scoreBaseline + 0.9);
    const darkThreshold = Math.max(0.0035, darkBaseline + 0.0025);
    const signedRows = rowScores
      .filter(
        (row) =>
          row.score >= threshold &&
          row.darkPixelRatio >= darkThreshold &&
          (row.inkColumnRatio >= 0.035 || row.darkPixelRatio >= darkThreshold + 0.004),
      )
      .map((row) => row.rowNumber);

    if (signedRows.length === 0) {
      continue;
    }

    active = true;
    for (const rowNumber of signedRows) {
      presentRowKeys.add(rowKey(page.pageNumber, rowNumber));
    }

    notes.push(
      `Filter TTD aktif di halaman ${page.pageNumber}: ${signedRows.length} dari ${highestRowNumber} baris terdeteksi bertanda tangan.`,
    );
  }

  return {
    active,
    presentRowKeys: [...presentRowKeys],
    notes,
  };
}
