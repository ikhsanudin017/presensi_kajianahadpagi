export type AttendanceVisionImageInput = {
  pageNumber: number;
  base64Image: string;
  mimeType?: string;
};

export type AttendanceVisionScanResult = {
  pages: Array<{
    pageNumber: number;
    text: string;
  }>;
  notes: string[];
};

function getVisionApiKey() {
  return process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_API_KEY || null;
}

async function callVisionDocumentText(base64Image: string) {
  const apiKey = getVisionApiKey();
  if (!apiKey) {
    throw new Error("GOOGLE_CLOUD_VISION_API_KEY_MISSING");
  }

  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: base64Image,
          },
          features: [
            {
              type: "DOCUMENT_TEXT_DETECTION",
            },
          ],
          imageContext: {
            languageHints: ["id", "en"],
          },
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `VISION_REQUEST_FAILED_${response.status}`;
    throw new Error(message);
  }

  const annotation = payload?.responses?.[0];
  if (annotation?.error?.message) {
    throw new Error(annotation.error.message);
  }

  return String(annotation?.fullTextAnnotation?.text || "").trim();
}

function toVisionWarning(pageNumber: number, error: unknown) {
  const message = error instanceof Error ? error.message : "VISION_REQUEST_FAILED";
  const lower = message.toLowerCase();

  if (lower.includes("requires billing to be enabled") || lower.includes("billing")) {
    return `Vision halaman ${pageNumber} dilewati karena billing Google Cloud belum aktif. Fallback OCR lokal tetap dipakai.`;
  }

  if (message === "GOOGLE_CLOUD_VISION_API_KEY_MISSING") {
    return `Vision halaman ${pageNumber} dilewati karena API key belum tersedia.`;
  }

  return `Vision halaman ${pageNumber} gagal: ${message}`;
}

export async function scanAttendanceImagesWithVision(params: {
  images: AttendanceVisionImageInput[];
  onProgress?: (progress: {
    pageNumber: number;
    totalPages: number;
    progress: number;
    message: string;
  }) => void;
}): Promise<AttendanceVisionScanResult> {
  const pages: AttendanceVisionScanResult["pages"] = [];
  const notes: string[] = [];
  const totalPages = Math.max(params.images.length, 1);

  if (!getVisionApiKey()) {
    return {
      pages,
      notes: ["Google Vision dilewati karena API key belum tersedia."],
    };
  }

  for (let index = 0; index < params.images.length; index += 1) {
    const image = params.images[index];
    const pageNumber = image.pageNumber;

    params.onProgress?.({
      pageNumber,
      totalPages,
      progress: 10 + ((index + 1) / totalPages) * 16,
      message: `Vision OCR membaca halaman ${pageNumber}/${totalPages}...`,
    });

    try {
      const text = await callVisionDocumentText(image.base64Image);
      pages.push({
        pageNumber,
        text,
      });
    } catch (error) {
      notes.push(toVisionWarning(pageNumber, error));
    }
  }

  return { pages, notes };
}
