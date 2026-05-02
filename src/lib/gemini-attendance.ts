import type {
  AttendanceOcrScanResult,
  DetectedAttendanceCandidate,
} from "@/lib/ocr-attendance";
import {
  findBestParticipantMatch,
  looksLikeHumanName,
  toDisplayPersonName,
} from "@/lib/name-matching";
import { processAttendanceOcrText } from "@/lib/attendance-photo-parser";

export type AttendanceGeminiScanImageInput = {
  pageNumber: number;
  mimeType?: string;
  fullImageBase64: string;
  headerImageBase64: string;
  visionText?: string;
};

export type AttendanceGeminiScanResult = AttendanceOcrScanResult & {
  displayDate: string | null;
  detectedEventDate: string | null;
  previewText: string;
};

type GeminiExtractedRow = {
  rowNumber?: number | null;
  name?: string | null;
  addressHint?: string | null;
  confidence?: number | null;
};

type GeminiStructuredPageResult = {
  displayDate?: string | null;
  detectedDate?: string | null;
  normalizedTranscript?: string | null;
  rows?: GeminiExtractedRow[] | null;
  notes?: string | null;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

function toGeminiEndpoint() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return null;
  }

  const preferredModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const fallbackModels = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.0-flash")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = Array.from(new Set([preferredModel, ...fallbackModels]));

  return { apiKey, models };
}

function tryParseJsonObject(raw: string) {
  const cleaned = raw.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = (fenced?.[1] || cleaned).trim();
  const firstObject = jsonText.indexOf("{");
  const lastObject = jsonText.lastIndexOf("}");
  if (firstObject < 0 || lastObject <= firstObject) {
    return null;
  }

  try {
    return JSON.parse(jsonText.slice(firstObject, lastObject + 1)) as GeminiStructuredPageResult;
  } catch {
    return null;
  }
}

function extractGeminiText(payload: GeminiGenerateContentResponse) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    ?.trim();

  if (!text) {
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }

  return text;
}

async function extractStructuredRowsFromImage(params: {
  image: AttendanceGeminiScanImageInput;
  participantNames: string[];
}): Promise<{ result: GeminiStructuredPageResult | null; error: string | null }> {
  const endpoint = toGeminiEndpoint();
  if (!endpoint) {
    return {
      result: null,
      error: "GEMINI_API_KEY_MISSING",
    };
  }

  const participantHint =
    params.participantNames.length > 0 && params.participantNames.length <= 120
      ? `Contoh nama peserta yang sudah ada: ${params.participantNames.join(", ")}`
      : "";

  const prompt = [
    "Anda membaca foto daftar presensi tulisan tangan Kajian Ahad Pagi.",
    "Tugas utama: ekstrak semua nama peserta dari kolom NAMA.",
    "Jika di header terlihat tanggal, isi displayDate sesuai tulisan asli dan detectedDate dalam format YYYY-MM-DD.",
    "Fokus pada kolom nomor urut dan nama. Abaikan alamat, nomor telepon, dan tanda tangan.",
    "Jika nomor baris terlihat, isi rowNumber sebagai angka.",
    "Jika ejaan nama jelas salah karena OCR, rapikan menjadi nama manusia yang paling masuk akal tanpa mengarang.",
    "Jangan memasukkan teks acak, judul tabel, atau isi alamat sebagai nama.",
    "normalizedTranscript berisi ringkasan hasil baca yang rapi untuk ditampilkan ke user.",
    participantHint,
    "Gunakan gambar sebagai sumber utama. OCR Vision di bawah hanya bantuan tambahan.",
    `OCR bantuan:\n${params.image.visionText?.trim() || "(tidak ada OCR bantuan)"}`,
    "Keluarkan hanya JSON valid dengan struktur ini:",
    '{"displayDate":"Ahad 19 April 2026","detectedDate":"2026-04-19","normalizedTranscript":"1. Dina A\\n2. Yuli Maryani","rows":[{"rowNumber":1,"name":"Dina A","addressHint":"","confidence":0.94}],"notes":""}',
    "confidence bernilai 0..1. Jika tidak yakin pada tanggal, isi null.",
  ]
    .filter(Boolean)
    .join("\n");

  const schema = {
    type: "object",
    properties: {
      displayDate: {
        type: ["string", "null"],
      },
      detectedDate: {
        type: ["string", "null"],
      },
      normalizedTranscript: {
        type: "string",
      },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rowNumber: {
              type: ["integer", "null"],
            },
            name: {
              type: "string",
            },
            addressHint: {
              type: ["string", "null"],
            },
            confidence: {
              type: ["number", "null"],
            },
          },
          required: ["rowNumber", "name", "addressHint", "confidence"],
        },
      },
      notes: {
        type: "string",
      },
    },
    required: ["displayDate", "detectedDate", "normalizedTranscript", "rows", "notes"],
  };

  let lastError = "GEMINI_REQUEST_FAILED";

  for (const model of endpoint.models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": endpoint.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: params.image.mimeType || "image/jpeg",
                      data: params.image.fullImageBase64,
                    },
                  },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: params.image.headerImageBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
              responseJsonSchema: schema,
            },
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as GeminiGenerateContentResponse;
      if (!response.ok) {
        const message = payload?.error?.message || `GEMINI_REQUEST_FAILED_${model}_${response.status}`;
        lastError = message;
        continue;
      }

      const rawText = extractGeminiText(payload);
      const parsed = tryParseJsonObject(rawText);
      if (!parsed) {
        lastError = `GEMINI_PARSE_FAILED_${model}`;
        continue;
      }

      return {
        result: parsed,
        error: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : `GEMINI_REQUEST_EXCEPTION_${model}`;
    }
  }

  return {
    result: null,
    error: lastError,
  };
}

function toConfidenceLabel(value?: number | null): DetectedAttendanceCandidate["confidence"] {
  if (typeof value !== "number") {
    return "medium";
  }
  if (value >= 0.84) return "high";
  if (value >= 0.62) return "medium";
  return "low";
}

type ParticipantHintMatch = NonNullable<ReturnType<typeof findBestParticipantMatch<{ id: string; name: string }>>>;

function shouldUseMatchedParticipantName(
  match: ReturnType<typeof findBestParticipantMatch<{ id: string; name: string }>>,
): match is ParticipantHintMatch {
  if (!match || match.ambiguous) {
    return false;
  }

  if (match.reason === "exact" || match.reason === "phonetic") {
    return match.score >= 0.78;
  }

  return match.score >= 0.92;
}

function buildGeminiCandidate(params: {
  pageNumber: number;
  row: GeminiExtractedRow;
  participantsForMatch: Array<{ id: string; name: string }>;
  defaultConfidence?: DetectedAttendanceCandidate["confidence"];
  reason: string;
}) {
  const rawName = toDisplayPersonName(params.row.name || "");
  if (!rawName || rawName.replace(/\s+/g, "").length < 3) {
    return null;
  }

  const matched =
    params.participantsForMatch.length > 0
      ? findBestParticipantMatch(rawName, params.participantsForMatch)
      : null;
  const resolvedName =
    shouldUseMatchedParticipantName(matched)
      ? toDisplayPersonName(matched.participant.name)
      : rawName;

  if (!looksLikeHumanName(resolvedName)) {
    return null;
  }

  return {
    pageNumber: params.pageNumber,
    rowNumber: typeof params.row.rowNumber === "number" ? params.row.rowNumber : undefined,
    sourceName: params.row.name?.trim() || resolvedName,
    resolvedName,
    confidence: params.defaultConfidence ?? toConfidenceLabel(typeof params.row.confidence === "number" ? params.row.confidence : matched?.score),
    reason: params.reason,
    addressHint: params.row.addressHint?.trim() || undefined,
  } satisfies DetectedAttendanceCandidate;
}

export async function scanAttendanceImagesWithGemini(params: {
  images: AttendanceGeminiScanImageInput[];
  participantNames?: string[];
  onProgress?: (progress: {
    pageNumber: number;
    totalPages: number;
    progress: number;
    message: string;
  }) => void;
}): Promise<AttendanceGeminiScanResult> {
  const attendees: DetectedAttendanceCandidate[] = [];
  const skipped: AttendanceOcrScanResult["skipped"] = [];
  const notes: string[] = [];
  const previewParts: string[] = [];
  const totalPages = Math.max(params.images.length, 1);
  const seenNames = new Set<string>();
  let displayDate: string | null = null;
  let detectedEventDate: string | null = null;
  const participantsForMatch = (params.participantNames ?? []).map((name, index) => ({
    id: String(index + 1),
    name,
  }));

  for (let index = 0; index < params.images.length; index += 1) {
    const image = params.images[index];
    const pageNumber = image.pageNumber;

    params.onProgress?.({
      pageNumber,
      totalPages,
      progress: 28 + ((index + 1) / totalPages) * 18,
      message: `Gemini menyusun hasil halaman ${pageNumber}/${totalPages}...`,
    });

    const extracted = await extractStructuredRowsFromImage({
      image,
      participantNames: params.participantNames ?? [],
    });

    if (extracted.error || !extracted.result) {
      notes.push(`Gemini halaman ${pageNumber} gagal: ${extracted.error || "GEMINI_PARSE_FAILED"}`);
      continue;
    }

    displayDate ??=
      typeof extracted.result.displayDate === "string" && extracted.result.displayDate.trim()
        ? extracted.result.displayDate.trim()
        : null;
    detectedEventDate ??=
      typeof extracted.result.detectedDate === "string" && extracted.result.detectedDate.trim()
        ? extracted.result.detectedDate.trim()
        : null;

    if (typeof extracted.result.notes === "string" && extracted.result.notes.trim()) {
      notes.push(`Gemini halaman ${pageNumber}: ${extracted.result.notes.trim()}`);
    }

    const normalizedTranscript =
      typeof extracted.result.normalizedTranscript === "string"
        ? extracted.result.normalizedTranscript.trim()
        : "";

    if (normalizedTranscript) {
      previewParts.push(`Halaman ${pageNumber}`);
      previewParts.push(normalizedTranscript);
      previewParts.push("");
    }

    const transcriptRows = normalizedTranscript
      ? processAttendanceOcrText({
          pages: [{ pageNumber, text: normalizedTranscript }],
        }).attendees.map((item) => ({
          rowNumber: item.rowNumber,
          name: item.resolvedName,
          addressHint: item.addressHint ?? null,
          confidence: item.confidence === "high" ? 0.9 : item.confidence === "medium" ? 0.76 : 0.58,
        } satisfies GeminiExtractedRow))
      : [];

    const rowsToProcess = [
      ...(extracted.result.rows ?? []).map((row) => ({
        row,
        reason: "Nama dibaca oleh Gemini Vision lalu dirapikan menjadi hasil terstruktur.",
      })),
      ...transcriptRows.map((row) => ({
        row,
        reason: "Nama diparse ulang dari transcript Gemini yang tampil di ringkasan.",
      })),
    ];

    for (const { row, reason } of rowsToProcess) {
      const candidate = buildGeminiCandidate({
        pageNumber,
        row,
        participantsForMatch,
        reason,
      });

      if (!candidate) {
        skipped.push({
          pageNumber,
          sourceName: row.name?.trim() || "",
          reason: "Gemini membaca teks, tetapi belum cukup valid sebagai nama peserta.",
        });
        continue;
      }

      const normalizedCandidateName = candidate.resolvedName.toLowerCase().replace(/\s+/g, " ").trim();
      const key = candidate.rowNumber
        ? `${candidate.pageNumber}:${candidate.rowNumber}:${normalizedCandidateName}`
        : normalizedCandidateName;
      if (!key || seenNames.has(key)) {
        continue;
      }
      seenNames.add(key);

      attendees.push(candidate);
    }
  }

  return {
    attendees,
    skipped,
    notes,
    displayDate,
    detectedEventDate,
    previewText: previewParts.join("\n").trim(),
  };
}
