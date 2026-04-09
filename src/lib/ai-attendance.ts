import { z } from "zod";
import { sanitizeDetectedName } from "@/lib/name-matching";

type ParticipantContext = {
  name: string;
  address?: string | null;
};

export type AttendanceScanImageInput = {
  name: string;
  mimeType: string;
  base64Image: string;
};

let visionAvailability:
  | { status: "unknown" | "enabled" }
  | { status: "disabled"; reason: "billing" | "missing_key" | "forbidden" | "other" } = {
  status: "unknown",
};

const visionResponseSchema = z.object({
  responses: z
    .array(
      z.object({
        fullTextAnnotation: z
          .object({
            text: z.string().optional(),
          })
          .optional(),
        error: z
          .object({
            message: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const geminiResponseSchema = z.object({
  attendees: z
    .array(
      z.object({
        sourceName: z.string().trim().min(1),
        resolvedName: z.string().trim().min(1),
        matchedExistingParticipant: z.boolean(),
        confidence: z.enum(["high", "medium", "low"]),
        reason: z.string().trim().min(1),
        addressHint: z.string().trim().optional().default(""),
      }),
    )
    .default([]),
  skipped: z
    .array(
      z.object({
        sourceName: z.string().trim().min(1),
        reason: z.string().trim().min(1),
      }),
    )
    .default([]),
  notes: z.array(z.string()).default([]),
});

type GeminiAttendanceResponse = z.infer<typeof geminiResponseSchema>;

export type DetectedAttendanceCandidate = {
  pageNumber: number;
  sourceName: string;
  resolvedName: string;
  matchedExistingParticipant: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  addressHint?: string;
};

export type AttendanceAiScanResult = {
  attendees: DetectedAttendanceCandidate[];
  skipped: Array<{
    pageNumber: number;
    sourceName: string;
    reason: string;
  }>;
  notes: string[];
};

const RETRYABLE_GEMINI_STATUSES = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_ATTEMPTS = 4;
const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash-lite"];

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_MISSING`);
  }
  return value;
}

function toBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueTrimmed(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function getGeminiModelCandidates() {
  const primaryModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const configuredFallbackModels = (process.env.GEMINI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return uniqueTrimmed([primaryModel, ...configuredFallbackModels, ...DEFAULT_GEMINI_FALLBACK_MODELS]);
}

function isRetryableGeminiError(status: number, body: string) {
  return (
    RETRYABLE_GEMINI_STATUSES.has(status) ||
    /UNAVAILABLE|high demand|try again later|rate limit|temporar/i.test(body)
  );
}

function toVisionFallbackNote(error: unknown, pageNumber: number) {
  const message = error instanceof Error ? error.message : String(error ?? "VISION_OCR_FAILED");

  if (message.includes("GOOGLE_CLOUD_VISION_API_KEY_MISSING")) {
    return `Halaman ${pageNumber}: Google Vision API key belum diisi, jadi analisis dilanjutkan hanya dengan Gemini.`;
  }

  if (message.includes("VISION_REQUEST_FAILED:403") && /billing/i.test(message)) {
    return `Halaman ${pageNumber}: Google Vision tidak bisa dipakai karena billing project belum aktif, jadi analisis dilanjutkan hanya dengan Gemini.`;
  }

  if (message.includes("VISION_REQUEST_FAILED:403")) {
    return `Halaman ${pageNumber}: Google Vision menolak request, jadi analisis dilanjutkan hanya dengan Gemini.`;
  }

  if (message.includes("VISION_ERROR:")) {
    return `Halaman ${pageNumber}: Google Vision mengembalikan error, jadi analisis dilanjutkan hanya dengan Gemini.`;
  }

  return `Halaman ${pageNumber}: Google Vision gagal dipakai, jadi analisis dilanjutkan hanya dengan Gemini.`;
}

function getCachedVisionFallbackNote(pageNumber: number) {
  if (visionAvailability.status !== "disabled") {
    return null;
  }

  if (visionAvailability.reason === "billing") {
    return `Halaman ${pageNumber}: Google Vision dilewati karena billing project belum aktif, jadi analisis dilanjutkan hanya dengan Gemini.`;
  }

  if (visionAvailability.reason === "missing_key") {
    return `Halaman ${pageNumber}: Google Vision dilewati karena API key belum diisi, jadi analisis dilanjutkan hanya dengan Gemini.`;
  }

  if (visionAvailability.reason === "forbidden") {
    return `Halaman ${pageNumber}: Google Vision dilewati karena akses ditolak, jadi analisis dilanjutkan hanya dengan Gemini.`;
  }

  return `Halaman ${pageNumber}: Google Vision dilewati karena sebelumnya gagal, jadi analisis dilanjutkan hanya dengan Gemini.`;
}

async function extractOcrText(base64Image: string) {
  const apiKey = requireEnv("GOOGLE_CLOUD_VISION_API_KEY");
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
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
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`VISION_REQUEST_FAILED:${response.status}:${body.slice(0, 240)}`);
  }

  const json = visionResponseSchema.parse(await response.json());
  const firstResponse = json.responses[0];

  if (firstResponse?.error?.message) {
    throw new Error(`VISION_ERROR:${firstResponse.error.message}`);
  }

  return firstResponse?.fullTextAnnotation?.text?.trim() ?? "";
}

async function safeExtractOcrText(base64Image: string, pageNumber: number) {
  const cachedNote = getCachedVisionFallbackNote(pageNumber);
  if (cachedNote) {
    return {
      text: "",
      note: cachedNote,
    } as const;
  }

  try {
    const result = {
      text: await extractOcrText(base64Image),
      note: null,
    } as const;
    visionAvailability = { status: "enabled" };
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "VISION_OCR_FAILED");

    if (message.includes("GOOGLE_CLOUD_VISION_API_KEY_MISSING")) {
      visionAvailability = { status: "disabled", reason: "missing_key" };
    } else if (message.includes("VISION_REQUEST_FAILED:403") && /billing/i.test(message)) {
      visionAvailability = { status: "disabled", reason: "billing" };
    } else if (message.includes("VISION_REQUEST_FAILED:403")) {
      visionAvailability = { status: "disabled", reason: "forbidden" };
    } else if (message.includes("VISION_ERROR:")) {
      visionAvailability = { status: "disabled", reason: "other" };
    }

    if (!message.includes("VISION_REQUEST_FAILED:403") && !message.includes("GOOGLE_CLOUD_VISION_API_KEY_MISSING")) {
      console.warn(`Vision OCR unavailable on page ${pageNumber}: ${message.slice(0, 180)}`);
    }
    return {
      text: "",
      note: toVisionFallbackNote(error, pageNumber),
    } as const;
  }
}

function buildParticipantsContext(participants: ParticipantContext[]) {
  return participants
    .map((participant, index) => {
      const address = participant.address?.trim();
      return `${index + 1}. ${participant.name}${address ? ` | ${address}` : ""}`;
    })
    .join("\n");
}

function extractGeminiText(json: unknown) {
  const parsed = z
    .object({
      candidates: z
        .array(
          z.object({
            content: z.object({
              parts: z
                .array(
                  z.object({
                    text: z.string().optional(),
                  }),
                )
                .default([]),
            }),
          }),
        )
        .default([]),
    })
    .safeParse(json);

  if (!parsed.success) {
    return "";
  }

  return parsed.data.candidates
    .flatMap((candidate) => candidate.content.parts)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

async function analyzeAttendanceImageWithGemini(params: {
  base64Image: string;
  mimeType: string;
  ocrText: string;
  participants: ParticipantContext[];
  imageName?: string;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    attemptedModel: string;
    nextModel: string;
  }) => void;
}) {
  const geminiApiKey = requireEnv("GEMINI_API_KEY");
  const modelCandidates = getGeminiModelCandidates();
  const requestBody = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Anda membantu sistem absensi Kajian Ahad Pagi.",
              "Tugas Anda adalah membaca foto lembar absensi, lalu keluarkan semua peserta yang namanya tertulis pada baris daftar yang terlihat di gambar ini.",
              "Gambar bisa berupa satu halaman penuh atau potongan/zoom dari sebagian halaman. Sebagian gambar memang sengaja dipotong agar fokus ke kolom nama. Tetap baca semua baris yang terlihat pada gambar ini dari atas ke bawah.",
              "Fokus utama adalah kolom nama. Jika pada satu baris terlihat ada nama orang, anggap itu peserta hadir walaupun kolom tanda tangan kosong, samar, atau tidak terbaca.",
              "Kolom tanda tangan, alamat, dan nomor urut hanya sebagai konteks tambahan untuk membantu membaca nama dengan benar. Jika kolom kanan tidak terlihat penuh, itu tidak masalah.",
              "Gunakan kolom nomor urut di kiri untuk memastikan tidak ada baris nama yang terlewat. Jika terlihat nomor 1 sampai 41, cek semua nomor yang memiliki nama.",
              "Fokus pada jumlah peserta hadir yang lengkap berdasarkan nama. Jangan berhenti di 20 nama pertama; baca seluruh baris yang terlihat, termasuk bagian tengah dan bawah gambar.",
              "Sebelum menjawab, cek ulang sekali lagi apakah semua baris bernama sudah masuk ke attendees.",
              "Gunakan gambar sebagai sumber utama. OCR Google Vision di bawah hanya sebagai bantuan karena bisa salah baca.",
              "Jika tulisan nama agak sulit dibaca tetapi masih terlihat seperti nama orang, tetap masukkan ke attendees dengan sourceName terbaik yang paling masuk akal dan confidence medium atau low.",
              "Jika tulisan di foto berbeda tipis tetapi jelas orang yang sama dengan peserta existing, gunakan nama peserta existing yang paling tepat.",
              "Contoh: Ikhsan bisa terbaca Ihsan atau Isan, tetapi itu tetap orang yang sama.",
              "Jika orangnya memang belum ada di daftar peserta existing, isi resolvedName dengan nama paling masuk akal dan set matchedExistingParticipant=false.",
              "Jika tidak yakin exact match ke peserta existing, lebih baik tetap masukkan ke attendees dengan matchedExistingParticipant=false daripada menghilangkan orang yang hadir.",
              "Hanya taruh ke skipped jika baris memang kosong, bukan nama orang, atau nama sama sekali tidak bisa dibaca.",
              "Saat matchedExistingParticipant=true, resolvedName harus persis sama dengan salah satu nama pada daftar peserta existing.",
              "",
              `Nama file/gambar: ${params.imageName || "(tanpa nama)"}`,
              "",
              "Daftar peserta existing:",
              buildParticipantsContext(params.participants) || "(kosong)",
              "",
              "OCR dari Google Vision:",
              params.ocrText || "(OCR kosong)",
            ].join("\n"),
          },
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.15,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          attendees: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                sourceName: { type: "STRING" },
                resolvedName: { type: "STRING" },
                matchedExistingParticipant: { type: "BOOLEAN" },
                confidence: {
                  type: "STRING",
                  enum: ["high", "medium", "low"],
                },
                reason: { type: "STRING" },
                addressHint: { type: "STRING" },
              },
              required: [
                "sourceName",
                "resolvedName",
                "matchedExistingParticipant",
                "confidence",
                "reason",
              ],
            },
          },
          skipped: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                sourceName: { type: "STRING" },
                reason: { type: "STRING" },
              },
              required: ["sourceName", "reason"],
            },
          },
          notes: {
            type: "ARRAY",
            items: {
              type: "STRING",
            },
          },
        },
        required: ["attendees", "skipped", "notes"],
      },
    },
  });

  let json: unknown = null;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    const model = modelCandidates[Math.min(attempt - 1, modelCandidates.length - 1)];
    const nextModel =
      modelCandidates[Math.min(attempt, modelCandidates.length - 1)] ?? modelCandidates[modelCandidates.length - 1];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    if (response.ok) {
      json = await response.json();
      break;
    }

    const body = await response.text().catch(() => "");
    const retryable = isRetryableGeminiError(response.status, body);

    if (retryable && attempt < GEMINI_MAX_ATTEMPTS) {
      const delayMs = 1400 * 2 ** (attempt - 1);
      params.onRetry?.({
        attempt,
        maxAttempts: GEMINI_MAX_ATTEMPTS,
        delayMs,
        attemptedModel: model,
        nextModel,
      });
      await wait(delayMs);
      continue;
    }

    if (retryable) {
      throw new Error("GEMINI_TEMPORARILY_UNAVAILABLE");
    }

    throw new Error(`GEMINI_REQUEST_FAILED:${response.status}:${body.slice(0, 240)}`);
  }

  if (!json) {
    throw new Error("GEMINI_TEMPORARILY_UNAVAILABLE");
  }

  const content = extractGeminiText(json);
  if (!content) {
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }

  let parsedJson: GeminiAttendanceResponse;

  try {
    parsedJson = geminiResponseSchema.parse(JSON.parse(content));
  } catch (error) {
    console.error("Failed to parse Gemini attendance JSON", { content, error });
    throw new Error("GEMINI_INVALID_JSON");
  }

  return parsedJson;
}

export async function scanAttendanceImagesWithAi(params: {
  images: AttendanceScanImageInput[];
  participants: ParticipantContext[];
  onProgress?: (progress: {
    pageNumber: number;
    totalPages: number;
    progress: number;
    message: string;
  }) => void;
}) {
  const attendees: DetectedAttendanceCandidate[] = [];
  const skipped: AttendanceAiScanResult["skipped"] = [];
  const notes: string[] = [];
  const totalPages = Math.max(params.images.length, 1);

  for (let index = 0; index < params.images.length; index += 1) {
    const image = params.images[index];
    const pageNumber = index + 1;
    const pageBaseProgress = 18 + (index / totalPages) * 46;

    params.onProgress?.({
      pageNumber,
      totalPages,
      progress: pageBaseProgress,
      message: `Menganalisis halaman ${pageNumber} dari ${totalPages}.`,
    });

    if (!image.mimeType.startsWith("image/")) {
      skipped.push({
        pageNumber,
        sourceName: image.name || `file-${pageNumber}`,
        reason: "File bukan gambar.",
      });
      continue;
    }

    const ocrResult = await safeExtractOcrText(image.base64Image, pageNumber);
    params.onProgress?.({
      pageNumber,
      totalPages,
      progress: pageBaseProgress + 8,
      message: `Membaca detail halaman ${pageNumber} dengan AI.`,
    });

    const geminiResult = await analyzeAttendanceImageWithGemini({
      base64Image: image.base64Image,
      mimeType: image.mimeType || "image/jpeg",
      ocrText: ocrResult.text,
      participants: params.participants,
      imageName: image.name,
      onRetry: ({ attempt, maxAttempts, delayMs, attemptedModel, nextModel }) => {
        params.onProgress?.({
          pageNumber,
          totalPages,
          progress: pageBaseProgress + 8,
          message:
            attemptedModel === nextModel
              ? `Model ${attemptedModel} sedang sibuk untuk halaman ${pageNumber}. Mencoba lagi ${attempt + 1}/${maxAttempts} dalam ${Math.ceil(delayMs / 1000)} detik...`
              : `Model ${attemptedModel} sedang sibuk untuk halaman ${pageNumber}. Beralih ke ${nextModel} dalam ${Math.ceil(delayMs / 1000)} detik...`,
        });
      },
    });

    if (ocrResult.note) {
      notes.push(ocrResult.note);
    }

    attendees.push(
      ...geminiResult.attendees.map((item) => ({
        pageNumber,
        sourceName: sanitizeDetectedName(item.sourceName),
        resolvedName: sanitizeDetectedName(item.resolvedName),
        matchedExistingParticipant: item.matchedExistingParticipant,
        confidence: item.confidence,
        reason: item.reason,
        addressHint: item.addressHint?.trim() || undefined,
      })),
    );

    skipped.push(
      ...geminiResult.skipped.map((item) => ({
        pageNumber,
        sourceName: sanitizeDetectedName(item.sourceName),
        reason: item.reason,
      })),
    );

    if (geminiResult.notes.length > 0) {
      notes.push(...geminiResult.notes.map((note) => `Halaman ${pageNumber}: ${note}`));
    }

    params.onProgress?.({
      pageNumber,
      totalPages,
      progress: 18 + ((index + 1) / totalPages) * 46,
      message: `Halaman ${pageNumber} selesai dianalisis.`,
    });
  }

  return {
    attendees,
    skipped,
    notes,
  } satisfies AttendanceAiScanResult;
}

export async function scanAttendanceSheetsWithAi(params: {
  files: File[];
  participants: ParticipantContext[];
  onProgress?: (progress: {
    pageNumber: number;
    totalPages: number;
    progress: number;
    message: string;
  }) => void;
}) {
  const images = await Promise.all(
    params.files.map(async (file) => ({
      name: file.name,
      mimeType: file.type || "image/jpeg",
      base64Image: toBase64(await file.arrayBuffer()),
    })),
  );

  return scanAttendanceImagesWithAi({
    images,
    participants: params.participants,
    onProgress: params.onProgress,
  });
}
