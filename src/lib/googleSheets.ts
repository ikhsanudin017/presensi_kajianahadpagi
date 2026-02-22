import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

const SHEET_ALIASES: Record<string, string[]> = {
  Peserta: ["Participants"],
  Participants: ["Peserta"],
  Presensi: ["Attendance"],
  Attendance: ["Presensi"],
};

function getAuthClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (!clientEmail || !privateKey) {
    return null;
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
  });
}

function getSheetsContext() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const auth = getAuthClient();
  if (!spreadsheetId || !auth) {
    return null;
  }
  return {
    spreadsheetId,
    sheets: google.sheets({ version: "v4", auth }),
  };
}

async function resolveSheetName(
  context: NonNullable<ReturnType<typeof getSheetsContext>>,
  preferredSheetName: string,
) {
  const aliases = SHEET_ALIASES[preferredSheetName] ?? [];
  const candidates = [preferredSheetName, ...aliases];

  try {
    const metadata = await context.sheets.spreadsheets.get({
      spreadsheetId: context.spreadsheetId,
      fields: "sheets(properties(title))",
    });
    const titles = new Set((metadata.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? ""));

    for (const name of candidates) {
      if (titles.has(name)) {
        return name;
      }
    }
  } catch (error) {
    console.error("Failed to inspect spreadsheet sheets", error);
  }

  try {
    await context.sheets.spreadsheets.batchUpdate({
      spreadsheetId: context.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: preferredSheetName } } }],
      },
    });
    return preferredSheetName;
  } catch (error) {
    console.error("Failed to create fallback sheet", error);
  }

  return preferredSheetName;
}

function toDateKey(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function toIsoTimestamp(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
}

export async function appendRow(sheetName: string, values: Array<string | number | null>) {
  const context = getSheetsContext();
  if (!context) {
    return { ok: false, reason: "missing_config" } as const;
  }

  const resolvedSheetName = await resolveSheetName(context, sheetName);
  await context.sheets.spreadsheets.values.append({
    spreadsheetId: context.spreadsheetId,
    range: `${resolvedSheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [values],
    },
  });
  return { ok: true } as const;
}

export async function ensureHeaders(sheetName: string, headers: string[]) {
  const context = getSheetsContext();
  if (!context) {
    return { ok: false, reason: "missing_config" } as const;
  }

  const resolvedSheetName = await resolveSheetName(context, sheetName);
  await context.sheets.spreadsheets.values.update({
    spreadsheetId: context.spreadsheetId,
    range: `${resolvedSheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [headers],
    },
  });
  return { ok: true } as const;
}

export async function readSheetValues(sheetName: string, range = "A:Z") {
  const context = getSheetsContext();
  if (!context) {
    return { ok: false, reason: "missing_config", values: [] as string[][] } as const;
  }

  try {
    const resolvedSheetName = await resolveSheetName(context, sheetName);
    const res = await context.sheets.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: `${resolvedSheetName}!${range}`,
    });

    return {
      ok: true,
      values: (res.data.values ?? []) as string[][],
    } as const;
  } catch (error) {
    console.error("Failed to read sheet values", error);
    return {
      ok: false,
      reason: "sheet_error",
      values: [] as string[][],
    } as const;
  }
}

export async function replaceSheetValues(sheetName: string, values: Array<Array<string | number | null>>) {
  const context = getSheetsContext();
  if (!context) {
    return { ok: false, reason: "missing_config" } as const;
  }

  try {
    const resolvedSheetName = await resolveSheetName(context, sheetName);
    await context.sheets.spreadsheets.values.clear({
      spreadsheetId: context.spreadsheetId,
      range: `${resolvedSheetName}!A:Z`,
      requestBody: {},
    });

    if (values.length > 0) {
      await context.sheets.spreadsheets.values.update({
        spreadsheetId: context.spreadsheetId,
        range: `${resolvedSheetName}!A1`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
    }

    return { ok: true } as const;
  } catch (error) {
    console.error("Failed to replace sheet values", error);
    return { ok: false, reason: "sheet_error" } as const;
  }
}

export type AttendanceSheetRow = {
  createdAt: Date | string;
  eventDate: Date | string;
  name: string;
  address?: string | null;
  gender?: string | null;
  deviceId?: string | null;
};

export async function syncAttendanceSheetByDate(sheetName: string, rows: AttendanceSheetRow[]) {
  const byDate = new Map<string, AttendanceSheetRow[]>();

  for (const row of rows) {
    const dateKey = toDateKey(row.eventDate);
    if (!dateKey) {
      continue;
    }
    const existing = byDate.get(dateKey) ?? [];
    existing.push(row);
    byDate.set(dateKey, existing);
  }

  const orderedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));
  const values: Array<Array<string | number | null>> = [];

  for (const dateKey of orderedDates) {
    values.push([`Tanggal Kajian: ${dateKey}`]);
    values.push(["waktu_input", "nama", "alamat", "jenis_kelamin", "id_perangkat"]);

    const rowsInDate = (byDate.get(dateKey) ?? []).sort((a, b) =>
      toIsoTimestamp(a.createdAt).localeCompare(toIsoTimestamp(b.createdAt)),
    );

    for (const row of rowsInDate) {
      values.push([
        toIsoTimestamp(row.createdAt),
        row.name,
        row.address ?? "",
        row.gender ?? "",
        row.deviceId ?? "",
      ]);
    }

    values.push([]);
  }

  if (values.length === 0) {
    values.push(["Belum ada data presensi"]);
  } else if (values[values.length - 1]?.length === 0) {
    values.pop();
  }

  const result = await replaceSheetValues(sheetName, values);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    sessions: orderedDates.length,
    rows: rows.length,
  } as const;
}
