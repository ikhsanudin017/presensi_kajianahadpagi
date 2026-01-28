import fs from "node:fs";
import path from "node:path";
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
    if (fs.existsSync(candidate)) return candidate;
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

  // Count occurrences in Excel
  const excelCounts = new Map<string, number>();
  const excelRows: { name: string; address: string; gender: Gender | null }[] = [];

  for (const row of rows) {
    for (const nameKey of nameColumns) {
      const suffix = nameKey.substring("NAMA".length);
      const addressKey = `ALAMAT${suffix}`;
      const genderKey = `L/P${suffix}`;

      const nameValue = String(row[nameKey] ?? "").trim();
      if (!nameValue) continue;

      const addressValue = String(row[addressKey] ?? "").trim();
      const genderValue = normalizeGender(String(row[genderKey] ?? ""));

      excelRows.push({ name: nameValue, address: addressValue, gender: genderValue });
      const key = nameValue.toLowerCase();
      excelCounts.set(key, (excelCounts.get(key) ?? 0) + 1);
    }
  }

  // Count occurrences in DB
  const dbCounts = new Map<string, number>();
  const participants = await prisma.participant.findMany({ select: { name: true } });
  for (const p of participants) {
    const key = p.name.toLowerCase();
    dbCounts.set(key, (dbCounts.get(key) ?? 0) + 1);
  }

  let inserted = 0;
  for (const row of excelRows) {
    const key = row.name.toLowerCase();
    const excelCount = excelCounts.get(key) ?? 0;
    const dbCount = dbCounts.get(key) ?? 0;
    if (dbCount >= excelCount) continue; // already have enough copies

    // Need to insert one copy
    await prisma.participant.create({
      data: {
        name: row.name,
        address: row.address || null,
        gender: row.gender,
      },
    });
    dbCounts.set(key, dbCount + 1);
    inserted += 1;
  }

  console.log(`Inserted missing duplicates: ${inserted}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
