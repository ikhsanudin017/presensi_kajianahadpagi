type ParticipantLike = {
  id: string;
  name: string;
};

const TITLE_TOKENS = new Set([
  "ibu", "bu", "bapak", "pak", "bpk", "ustadz", "ustad", "ust", "hj", "h",
]);

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// --- NORMALISASI OCR ---
export function sanitizeDetectedName(value: string) {
  let cleaned = value.toLowerCase();
  
  // Hapus nomor urut di awal baris (misal: "1.", "2)", "12.", "33-")
  cleaned = cleaned.replace(/^\d{1,3}\s*[.)\-:]*\s*/, "");

  // Hanya ganti angka yang berdiri sendiri di tengah kata (bukan nomor urut)
  // Ini lebih aman dari versi sebelumnya yang mengganti semua angka secara global
  cleaned = cleaned
    .replace(/(?<=[a-z])5(?=[a-z])/g, "s")
    .replace(/(?<=[a-z])1(?=[a-z])/g, "i")
    .replace(/(?<=[a-z])0(?=[a-z])/g, "o")
    .replace(/(?<=[a-z])4(?=[a-z])/g, "a")
    .replace(/(?<=[a-z])8(?=[a-z])/g, "b");

  return cleaned
    .replace(/^[^a-z0-9]+/, "") // Bersihkan karakter aneh di awal
    .replace(/^\d{1,3}\s*[.)\-:]*\s*/, "") // Hapus nomor urut (contoh: 1. , 2) )
    .replace(/[^a-z\s']/g, " ") // Sisakan huruf, spasi, dan apostrof
    .replace(/\s+/g, " ") // Hapus spasi ganda
    .trim();
}

export function normalizePersonName(value: string) {
  const normalized = stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !TITLE_TOKENS.has(token));

  return tokens.join(" ");
}

function compactName(value: string) {
  return normalizePersonName(value).replace(/\s+/g, "");
}

export function toPhoneticNameKey(value: string) {
  return compactName(value)
    .replace(/kh/g, "h")
    .replace(/sy|sh/g, "s")
    .replace(/ts/g, "s")
    .replace(/dz/g, "z")
    .replace(/dh/g, "d")
    .replace(/th/g, "t")
    .replace(/ph/g, "f")
    .replace(/q/g, "k")
    .replace(/v/g, "f")
    .replace(/x/g, "s")
    .replace(/y/g, "i")
    .replace(/h/g, "")
    .replace(/([a-z])\1+/g, "$1");
}

function levenshteinDistance(a: string, b: string) {
  if (!a) return b.length;
  if (!b) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) { dp[i][0] = i; }
  for (let j = 0; j <= b.length; j += 1) { dp[0][j] = j; }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[a.length][b.length];
}

function similarityScore(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

export function looksLikeHumanName(value: string) {
  const cleaned = sanitizeDetectedName(value);
  const alphaOnly = cleaned.replace(/\s+/g, "");
  // Minimal 2 huruf (untuk nama pendek seperti "Ari", "Ida", dll)
  // dan wajib dimulai dengan huruf
  return alphaOnly.length >= 2 && /^[a-z]/.test(alphaOnly);
}

export function toDisplayPersonName(value: string) {
  return sanitizeDetectedName(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type ParticipantNameMatch<T extends ParticipantLike> = {
  participant: T;
  score: number;
  reason: "exact" | "phonetic" | "fuzzy";
  ambiguous: boolean;
  comparedFrom: string;
};

export function findBestParticipantMatch<T extends ParticipantLike>(
  rawName: string,
  participants: T[],
): ParticipantNameMatch<T> | null {
  const source = sanitizeDetectedName(rawName);
  const normalizedSource = compactName(source);
  const phoneticSource = toPhoneticNameKey(source);

  if (!normalizedSource) {
    return null;
  }

  const ranked = participants
    .map((participant) => {
      const normalizedCandidate = compactName(participant.name);
      const phoneticCandidate = toPhoneticNameKey(participant.name);
      let bestScore = similarityScore(normalizedSource, normalizedCandidate);
      let reason: ParticipantNameMatch<T>["reason"] = "fuzzy";

      if (normalizedSource === normalizedCandidate) {
        bestScore = 1;
        reason = "exact";
      } else if (phoneticSource && phoneticSource === phoneticCandidate) {
        bestScore = 0.975;
        reason = "phonetic";
      } else {
        const phoneticScore = similarityScore(phoneticSource, phoneticCandidate) - 0.02;
        // Bonus jika satu nama mengandung yang lain (misal: "Ahmad" di dalam "Ahmad Syauqi")
        const containsScore =
          normalizedCandidate.includes(normalizedSource) || normalizedSource.includes(normalizedCandidate)
            ? Math.min(normalizedSource.length, normalizedCandidate.length) /
                Math.max(normalizedSource.length, normalizedCandidate.length)
            : 0;
        
        // Tambahan: cek apakah semua token exist di candidate (toleran terhadap urutan)
        const sourceTokens = normalizedSource.replace(/\s+/g, " ").split("");
        const candidateStr = normalizedCandidate;
        let tokenMatchRatio = 0;
        if (sourceTokens.length > 0) {
          const matched = sourceTokens.filter((ch) => candidateStr.includes(ch)).length;
          tokenMatchRatio = matched / Math.max(sourceTokens.length, candidateStr.length);
        }

        bestScore = Math.max(bestScore, phoneticScore, containsScore, tokenMatchRatio * 0.85);
      }

      return {
        participant,
        score: Number(bestScore.toFixed(4)),
        reason,
        comparedFrom: source,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];

  // Turunkan threshold ke 0.60 agar OCR tulisan tangan yang agak kotor masih bisa cocok
  if (!best || best.score < 0.60) { 
    return null;
  }

  return {
    ...best,
    ambiguous:
      best.score < 0.92 &&
      !!second &&
      second.score >= best.score - 0.04,
  };
}