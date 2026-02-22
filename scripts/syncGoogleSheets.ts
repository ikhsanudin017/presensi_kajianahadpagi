import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { prisma } from "../src/lib/prisma";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function ensureSheetTitles(spreadsheetId: string, pesertaTitle: string, presensiTitle: string) {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });

  const sheets = google.sheets({ version: "v4", auth });
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });

  const currentSheets = metadata.data.sheets ?? [];
  const titleToSheet = new Map(
    currentSheets.map((sheet) => [sheet.properties?.title, sheet.properties?.sheetId] as const),
  );

  const requests: Array<Record<string, unknown>> = [];

  const participantsLegacyId = titleToSheet.get("Participants");
  const attendanceLegacyId = titleToSheet.get("Attendance");
  const pesertaExistingId = titleToSheet.get(pesertaTitle);
  const presensiExistingId = titleToSheet.get(presensiTitle);

  if (participantsLegacyId !== undefined && pesertaExistingId === undefined) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: participantsLegacyId, title: pesertaTitle },
        fields: "title",
      },
    });
  } else if (pesertaExistingId === undefined) {
    requests.push({ addSheet: { properties: { title: pesertaTitle } } });
  } else if (participantsLegacyId !== undefined && participantsLegacyId !== pesertaExistingId) {
    requests.push({ deleteSheet: { sheetId: participantsLegacyId } });
  }

  if (attendanceLegacyId !== undefined && presensiExistingId === undefined) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: attendanceLegacyId, title: presensiTitle },
        fields: "title",
      },
    });
  } else if (presensiExistingId === undefined) {
    requests.push({ addSheet: { properties: { title: presensiTitle } } });
  } else if (attendanceLegacyId !== undefined && attendanceLegacyId !== presensiExistingId) {
    requests.push({ deleteSheet: { sheetId: attendanceLegacyId } });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  return sheets;
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env"));
  loadEnvFile(path.join(process.cwd(), ".env.local"));

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const pesertaTitle = process.env.GOOGLE_SHEETS_PARTICIPANTS_SHEET_NAME ?? "Peserta";
  const presensiTitle = process.env.GOOGLE_SHEETS_ATTENDANCE_SHEET_NAME ?? "Presensi";

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID");
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  }

  const sheets = await ensureSheetTitles(spreadsheetId, pesertaTitle, presensiTitle);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${pesertaTitle}!A:Z`,
    requestBody: {},
  });
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${presensiTitle}!A:Z`,
    requestBody: {},
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${pesertaTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["dibuat_pada", "nama", "alamat", "jenis_kelamin"]],
    },
  });

  const participants = await prisma.participant.findMany({
    select: {
      createdAt: true,
      name: true,
      address: true,
      gender: true,
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });

  if (participants.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${pesertaTitle}!A2`,
      valueInputOption: "RAW",
      requestBody: {
        values: participants.map((participant) => [
          participant.createdAt.toISOString(),
          participant.name,
          participant.address ?? "",
          participant.gender ?? "",
        ]),
      },
    });
  }

  const attendance = await prisma.attendance.findMany({
    select: {
      createdAt: true,
      eventDate: true,
      deviceId: true,
      participant: {
        select: {
          name: true,
          address: true,
          gender: true,
        },
      },
    },
    orderBy: [{ eventDate: "desc" }, { createdAt: "asc" }, { participant: { name: "asc" } }],
  });

  const groupedAttendance = new Map<string, Array<(typeof attendance)[number]>>();
  for (const row of attendance) {
    const dateKey = getDateKey(row.eventDate);
    const list = groupedAttendance.get(dateKey) ?? ([] as Array<(typeof attendance)[number]>);
    list.push(row);
    groupedAttendance.set(dateKey, list);
  }

  const attendanceValues: string[][] = [];
  const sessionDates = Array.from(groupedAttendance.keys()).sort((a, b) => b.localeCompare(a));
  for (const dateKey of sessionDates) {
    attendanceValues.push([`Tanggal Kajian: ${dateKey}`]);
    attendanceValues.push(["waktu_input", "nama", "alamat", "jenis_kelamin", "id_perangkat"]);

    const rowsInDate = (groupedAttendance.get(dateKey) ?? []).sort((a, b) =>
      a.createdAt.toISOString().localeCompare(b.createdAt.toISOString()),
    );
    for (const row of rowsInDate) {
      attendanceValues.push([
        row.createdAt.toISOString(),
        row.participant.name,
        row.participant.address ?? "",
        row.participant.gender ?? "",
        row.deviceId ?? "",
      ]);
    }

    attendanceValues.push([]);
  }

  if (attendanceValues.length === 0) {
    attendanceValues.push(["Belum ada data presensi"]);
  } else if (attendanceValues[attendanceValues.length - 1]?.length === 0) {
    attendanceValues.pop();
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${presensiTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: attendanceValues,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        spreadsheetId,
        sheetPeserta: pesertaTitle,
        sheetPresensi: presensiTitle,
        participantsSynced: participants.length,
        attendanceSynced: attendance.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
