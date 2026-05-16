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
const GRID_LEFT_RATIO = 0.66;
const GRID_RIGHT_RATIO = 0.985;
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

function computeHorizontalCoverage(params: {
  pixels: Buffer;
  channels: number;
  width: number;
  height: number;
  y: number;
}) {
  const left = Math.max(0, Math.floor(params.width * GRID_LEFT_RATIO));
  const right = Math.min(params.width, Math.ceil(params.width * GRID_RIGHT_RATIO));
  const radius = Math.max(2, Math.floor(params.height * 0.0012));
  const xStep = 2;
  let columns = 0;
  let activeColumns = 0;

  for (let x = left; x < right; x += xStep) {
    columns += 1;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = params.y + dy;
      if (y < 0 || y >= params.height) {
        continue;
      }

      const index = (y * params.width + x) * params.channels;
      const value = params.pixels[index] ?? 255;
      if (value < DARK_PIXEL_THRESHOLD) {
        activeColumns += 1;
        break;
      }
    }
  }

  return activeColumns / Math.max(columns, 1);
}

function detectHorizontalLinePeaks(params: {
  pixels: Buffer;
  channels: number;
  width: number;
  height: number;
  searchTop: number;
  searchBottom: number;
  expectedRowHeight: number;
}) {
  const samples: Array<{ y: number; score: number }> = [];

  for (let y = params.searchTop; y <= params.searchBottom; y += 1) {
    samples.push({
      y,
      score: computeHorizontalCoverage({
        pixels: params.pixels,
        channels: params.channels,
        width: params.width,
        height: params.height,
        y,
      }),
    });
  }

  const scores = samples.map((sample) => sample.score);
  const threshold = Math.max(0.12, quantile(scores, 0.9) * 0.72);
  const groups: Array<{ y: number; score: number }> = [];
  let current: Array<{ y: number; score: number }> = [];

  const flushGroup = () => {
    if (current.length === 0) {
      return;
    }

    const best = current.reduce((winner, item) => (item.score > winner.score ? item : winner), current[0]);
    groups.push(best);
    current = [];
  };

  for (const sample of samples) {
    if (sample.score >= threshold) {
      current.push(sample);
    } else {
      flushGroup();
    }
  }
  flushGroup();

  const minGap = Math.max(5, Math.floor(params.expectedRowHeight * 0.42));
  const merged: Array<{ y: number; score: number }> = [];
  for (const group of groups) {
    const previous = merged[merged.length - 1];
    if (previous && group.y - previous.y < minGap) {
      if (group.score > previous.score) {
        merged[merged.length - 1] = group;
      }
    } else {
      merged.push(group);
    }
  }

  return merged.map((group) => group.y).sort((left, right) => left - right);
}

function scoreBoundaryWindow(params: {
  boundaries: number[];
  expectedRowHeight: number;
  expectedBottomY: number;
}) {
  const gaps: number[] = [];
  for (let index = 1; index < params.boundaries.length; index += 1) {
    gaps.push(params.boundaries[index] - params.boundaries[index - 1]);
  }

  const medianGap = quantile(gaps, 0.5);
  if (medianGap <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const regularityPenalty =
    gaps.reduce((total, gap) => total + Math.abs(gap - medianGap) / medianGap, 0) / Math.max(gaps.length, 1);
  const heightPenalty = Math.abs(medianGap - params.expectedRowHeight) / Math.max(params.expectedRowHeight, 1);
  const bottomPenalty =
    Math.abs(params.boundaries[params.boundaries.length - 1] - params.expectedBottomY) /
    Math.max(params.expectedRowHeight, 1);

  return regularityPenalty + heightPenalty * 0.35 + bottomPenalty * 0.12;
}

function detectRowBoundariesFromGrid(params: {
  pixels: Buffer;
  channels: number;
  width: number;
  height: number;
  highestRowNumber: number;
  estimatedTopY: number;
  estimatedBottomY: number;
}) {
  const expectedRowHeight = Math.max(1, (params.estimatedBottomY - params.estimatedTopY) / params.highestRowNumber);
  const peaks = detectHorizontalLinePeaks({
    pixels: params.pixels,
    channels: params.channels,
    width: params.width,
    height: params.height,
    searchTop: Math.max(0, Math.floor(params.estimatedTopY - expectedRowHeight * 2.2)),
    searchBottom: Math.min(params.height - 1, Math.ceil(params.estimatedBottomY + expectedRowHeight * 1.4)),
    expectedRowHeight,
  });
  const requiredBoundaries = params.highestRowNumber + 1;

  if (peaks.length < requiredBoundaries) {
    return null;
  }

  let bestWindow: number[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let start = 0; start + requiredBoundaries <= peaks.length; start += 1) {
    const window = peaks.slice(start, start + requiredBoundaries);
    const score = scoreBoundaryWindow({
      boundaries: window,
      expectedRowHeight,
      expectedBottomY: params.estimatedBottomY,
    });

    if (score < bestScore) {
      bestScore = score;
      bestWindow = window;
    }
  }

  if (!bestWindow || bestScore > 1.2) {
    return null;
  }

  return bestWindow;
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
    const detectedBoundaries = detectRowBoundariesFromGrid({
      pixels: data,
      channels: info.channels,
      width: info.width,
      height: info.height,
      highestRowNumber,
      estimatedTopY: titleCutoffY,
      estimatedBottomY: tableBottomY,
    });
    const rowScores: Array<{ rowNumber: number; score: number; darkPixelRatio: number; inkColumnRatio: number }> = [];

    for (let rowNumber = 1; rowNumber <= highestRowNumber; rowNumber += 1) {
      const detectedTop = detectedBoundaries?.[rowNumber - 1];
      const detectedBottom = detectedBoundaries?.[rowNumber];
      const rowTop = Math.max(
        0,
        typeof detectedTop === "number" ? Math.floor(detectedTop) : Math.floor(titleCutoffY + (rowNumber - 1) * rowHeight),
      );
      const rowBottom = Math.min(
        info.height,
        typeof detectedBottom === "number" ? Math.ceil(detectedBottom) : Math.ceil(titleCutoffY + rowNumber * rowHeight),
      );
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
      `Filter TTD aktif di halaman ${page.pageNumber}: ${signedRows.length} dari ${highestRowNumber} baris terdeteksi bertanda tangan${
        detectedBoundaries ? " memakai garis tabel nyata." : " memakai estimasi tinggi baris."
      }`,
    );
  }

  return {
    active,
    presentRowKeys: [...presentRowKeys],
    notes,
  };
}
