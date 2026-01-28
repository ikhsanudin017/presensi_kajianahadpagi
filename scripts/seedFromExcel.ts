import path from "node:path";
import fs from "node:fs";
import * as xlsx from "xlsx";
import { PrismaClient, Gender } from "@prisma/client";

const prisma = new PrismaClient();

function resolveExcelPath() {
  const candidates = [
    process.env.SEED_EXCEL_PATH,
    path.join(process.cwd(), "data peserta ahad pagi.xlsx"),
    "/mnt/data/data peserta ahad pagi.xlsx",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeGender(value: string | undefined) {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  if (upper === "L" || upper === "P") return upper as Gender;
  return null;
}

async function main() {
  const excelPath = resolveExcelPath();
  if (!excelPath) {
    throw new Error("Excel file not found. Set SEED_EXCEL_PATH or place file in project root.");
  }

  const workbook = xlsx.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });

  const headers = Object.keys(rows[0] ?? {});
  const nameColumns = headers.filter((header) => header.toUpperCase().startsWith("NAMA"));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    for (const nameKey of nameColumns) {
      const suffix = nameKey.substring("NAMA".length);
      const addressKey = `ALAMAT${suffix}`;
      const genderKey = `L/P${suffix}`;

      const nameValue = String(row[nameKey] ?? "").trim();
      if (!nameValue) {
        continue;
      }

      const addressValue = String(row[addressKey] ?? "").trim();
      const genderValue = normalizeGender(String(row[genderKey] ?? ""));

      const existing = await prisma.participant.findFirst({
        where: { name: { equals: nameValue, mode: "insensitive" } },
      });

      if (!existing) {
        await prisma.participant.create({
          data: {
            name: nameValue,
            address: addressValue || null,
            gender: genderValue ?? null,
          },
        });
        created += 1;
        continue;
      }

      const nextAddress = existing.address ?? (addressValue || null);
      const nextGender = existing.gender ?? (genderValue ?? null);
      if (nextAddress !== existing.address || nextGender !== existing.gender) {
        await prisma.participant.update({
          where: { id: existing.id },
          data: {
            address: nextAddress,
            gender: nextGender,
          },
        });
        updated += 1;
      } else {
        skipped += 1;
      }
    }
  }

  console.log(`Seed selesai. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
