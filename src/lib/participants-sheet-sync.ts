import { prisma } from "@/lib/prisma";
import { readSheetValues } from "@/lib/googleSheets";

const NAME_HEADERS = new Set(["nama", "name"]);
const ADDRESS_HEADERS = new Set(["alamat", "address"]);
const GENDER_HEADERS = new Set(["jenis_kelamin", "gender"]);
const SKIP_NAME_VALUES = new Set(["dibuat_pada", "createdat", "nama", "name"]);

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function normalizeGender(raw: string | undefined) {
  const value = (raw ?? "").trim().toUpperCase();
  if (!value) {
    return null;
  }
  if (value === "L" || value === "LAKI-LAKI" || value === "LAKI LAKI") {
    return "L" as const;
  }
  if (value === "P" || value === "PEREMPUAN") {
    return "P" as const;
  }
  return null;
}

function findIndex(headers: string[], accepted: Set<string>) {
  const index = headers.findIndex((header) => accepted.has(header));
  return index >= 0 ? index : null;
}

function pickNameFromRow(row: string[], primaryIndex: number) {
  const candidates = [primaryIndex, 1, 0];

  for (const index of candidates) {
    if (index < 0 || index >= row.length) {
      continue;
    }
    const value = String(row[index] ?? "").trim();
    if (!value) {
      continue;
    }
    const lowered = normalize(value);
    if (SKIP_NAME_VALUES.has(lowered)) {
      continue;
    }
    // Skip obvious timestamps/dates.
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      continue;
    }
    return value;
  }

  return "";
}

export async function syncParticipantsFromSheetToDatabase() {
  const sheetName = process.env.GOOGLE_SHEETS_PARTICIPANTS_SHEET_NAME ?? "Peserta";
  const readResult = await readSheetValues(sheetName, "A:Z");
  if (!readResult.ok) {
    return readResult;
  }

  const rows = readResult.values;
  if (rows.length === 0) {
    return { ok: true, created: 0, updated: 0 } as const;
  }

  const headers = (rows[0] ?? []).map((item) => normalize(String(item ?? "")));
  const nameIndex = findIndex(headers, NAME_HEADERS) ?? 1;
  const addressIndex = findIndex(headers, ADDRESS_HEADERS);
  const genderIndex = findIndex(headers, GENDER_HEADERS);

  const existingParticipants = await prisma.participant.findMany({
    select: {
      id: true,
      name: true,
      address: true,
      gender: true,
    },
  });

  const existingByName = new Map(existingParticipants.map((item) => [normalize(item.name), item]));
  let created = 0;
  let updated = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const name = pickNameFromRow(row, nameIndex);
    if (!name) {
      continue;
    }

    const addressRaw = addressIndex !== null ? String(row[addressIndex] ?? "").trim() : "";
    const genderRaw = genderIndex !== null ? String(row[genderIndex] ?? "").trim() : "";
    const normalizedGender = normalizeGender(genderRaw);
    const key = normalize(name);
    const existing = existingByName.get(key);

    if (!existing) {
      const createdParticipant = await prisma.participant.create({
        data: {
          name,
          address: addressRaw || null,
          gender: normalizedGender,
        },
        select: {
          id: true,
          name: true,
          address: true,
          gender: true,
        },
      });
      existingByName.set(key, createdParticipant);
      created += 1;
      continue;
    }

    const nextAddress = addressRaw || existing.address;
    const nextGender = normalizedGender ?? existing.gender;
    if (nextAddress !== existing.address || nextGender !== existing.gender) {
      await prisma.participant.update({
        where: { id: existing.id },
        data: {
          address: nextAddress,
          gender: nextGender,
        },
      });
      existingByName.set(key, {
        ...existing,
        address: nextAddress,
        gender: nextGender,
      });
      updated += 1;
    }
  }

  return { ok: true, created, updated } as const;
}
