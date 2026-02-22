import fs from "fs";
import path from "path";
import { google } from "googleapis";

type SheetMeta = {
  properties?: {
    sheetId?: number;
    title?: string;
  };
  bandedRanges?: Array<{ bandedRangeId?: number }>;
  conditionalFormats?: unknown[];
};

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
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function createAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
  });
}

function makeDeleteBandingRequests(sheet: SheetMeta) {
  const requests: Array<Record<string, unknown>> = [];
  for (const banded of sheet.bandedRanges ?? []) {
    if (banded.bandedRangeId === undefined) {
      continue;
    }
    requests.push({
      deleteBanding: {
        bandedRangeId: banded.bandedRangeId,
      },
    });
  }
  return requests;
}

function makeDeleteConditionalRuleRequests(sheet: SheetMeta, sheetId: number) {
  const requests: Array<Record<string, unknown>> = [];
  const total = sheet.conditionalFormats?.length ?? 0;
  for (let index = total - 1; index >= 0; index -= 1) {
    requests.push({
      deleteConditionalFormatRule: {
        sheetId,
        index,
      },
    });
  }
  return requests;
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env"));
  loadEnvFile(path.join(process.cwd(), ".env.local"));

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const pesertaSheetTitle = process.env.GOOGLE_SHEETS_PARTICIPANTS_SHEET_NAME ?? "Peserta";
  const presensiSheetTitle = process.env.GOOGLE_SHEETS_ATTENDANCE_SHEET_NAME ?? "Presensi";

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID");
  }

  const auth = createAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title),bandedRanges(bandedRangeId),conditionalFormats)",
  });

  const allSheets = (metadata.data.sheets ?? []) as SheetMeta[];
  const pesertaSheet = allSheets.find((sheet) => sheet.properties?.title === pesertaSheetTitle);
  const presensiSheet = allSheets.find((sheet) => sheet.properties?.title === presensiSheetTitle);

  if (!pesertaSheet?.properties?.sheetId) {
    throw new Error(`Sheet '${pesertaSheetTitle}' tidak ditemukan`);
  }
  if (!presensiSheet?.properties?.sheetId) {
    throw new Error(`Sheet '${presensiSheetTitle}' tidak ditemukan`);
  }

  const pesertaSheetId = pesertaSheet.properties.sheetId;
  const presensiSheetId = presensiSheet.properties.sheetId;

  const requests: Array<Record<string, unknown>> = [];

  requests.push(...makeDeleteBandingRequests(pesertaSheet));
  requests.push(...makeDeleteConditionalRuleRequests(pesertaSheet, pesertaSheetId));
  requests.push(...makeDeleteBandingRequests(presensiSheet));
  requests.push(...makeDeleteConditionalRuleRequests(presensiSheet, presensiSheetId));

  // Sheet: Peserta
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: pesertaSheetId,
        gridProperties: { frozenRowCount: 1 },
        tabColor: { red: 0.16, green: 0.57, blue: 0.47 },
      },
      fields: "gridProperties.frozenRowCount,tabColor",
    },
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId: pesertaSheetId,
        startRowIndex: 0,
        endRowIndex: 2000,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          textFormat: {
            fontFamily: "Verdana",
            fontSize: 10,
            foregroundColor: { red: 0.1, green: 0.16, blue: 0.2 },
          },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
    },
  });

  requests.push({
    addBanding: {
      bandedRange: {
        range: {
          sheetId: pesertaSheetId,
          startRowIndex: 0,
          endRowIndex: 2000,
          startColumnIndex: 0,
          endColumnIndex: 4,
        },
        rowProperties: {
          headerColor: { red: 0.13, green: 0.49, blue: 0.41 },
          firstBandColor: { red: 0.96, green: 0.99, blue: 0.97 },
          secondBandColor: { red: 0.9, green: 0.97, blue: 0.93 },
        },
      },
    },
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId: pesertaSheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
            fontFamily: "Verdana",
            fontSize: 10,
          },
          horizontalAlignment: "CENTER",
        },
      },
      fields: "userEnteredFormat(textFormat,horizontalAlignment)",
    },
  });

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: pesertaSheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 220 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: pesertaSheetId,
        dimension: "COLUMNS",
        startIndex: 1,
        endIndex: 2,
      },
      properties: { pixelSize: 220 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: pesertaSheetId,
        dimension: "COLUMNS",
        startIndex: 2,
        endIndex: 3,
      },
      properties: { pixelSize: 180 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: pesertaSheetId,
        dimension: "COLUMNS",
        startIndex: 3,
        endIndex: 4,
      },
      properties: { pixelSize: 140 },
      fields: "pixelSize",
    },
  });

  requests.push({
    updateBorders: {
      range: {
        sheetId: pesertaSheetId,
        startRowIndex: 0,
        endRowIndex: 2000,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      top: { style: "SOLID", width: 1, color: { red: 0.67, green: 0.78, blue: 0.74 } },
      bottom: { style: "SOLID", width: 1, color: { red: 0.67, green: 0.78, blue: 0.74 } },
      left: { style: "SOLID", width: 1, color: { red: 0.67, green: 0.78, blue: 0.74 } },
      right: { style: "SOLID", width: 1, color: { red: 0.67, green: 0.78, blue: 0.74 } },
      innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.86, green: 0.92, blue: 0.89 } },
      innerVertical: { style: "SOLID", width: 1, color: { red: 0.86, green: 0.92, blue: 0.89 } },
    },
  });

  // Sheet: Presensi
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: presensiSheetId,
        gridProperties: { frozenRowCount: 0 },
        tabColor: { red: 0.17, green: 0.44, blue: 0.82 },
      },
      fields: "gridProperties.frozenRowCount,tabColor",
    },
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId: presensiSheetId,
        startRowIndex: 0,
        endRowIndex: 3000,
        startColumnIndex: 0,
        endColumnIndex: 5,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          textFormat: {
            fontFamily: "Verdana",
            fontSize: 10,
            foregroundColor: { red: 0.12, green: 0.16, blue: 0.21 },
          },
          backgroundColor: { red: 1, green: 1, blue: 1 },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor)",
    },
  });

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: presensiSheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 240 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: presensiSheetId,
        dimension: "COLUMNS",
        startIndex: 1,
        endIndex: 2,
      },
      properties: { pixelSize: 220 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: presensiSheetId,
        dimension: "COLUMNS",
        startIndex: 2,
        endIndex: 3,
      },
      properties: { pixelSize: 190 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: presensiSheetId,
        dimension: "COLUMNS",
        startIndex: 3,
        endIndex: 4,
      },
      properties: { pixelSize: 140 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: presensiSheetId,
        dimension: "COLUMNS",
        startIndex: 4,
        endIndex: 5,
      },
      properties: { pixelSize: 220 },
      fields: "pixelSize",
    },
  });

  requests.push({
    updateBorders: {
      range: {
        sheetId: presensiSheetId,
        startRowIndex: 0,
        endRowIndex: 3000,
        startColumnIndex: 0,
        endColumnIndex: 5,
      },
      top: { style: "SOLID", width: 1, color: { red: 0.71, green: 0.79, blue: 0.9 } },
      bottom: { style: "SOLID", width: 1, color: { red: 0.71, green: 0.79, blue: 0.9 } },
      left: { style: "SOLID", width: 1, color: { red: 0.71, green: 0.79, blue: 0.9 } },
      right: { style: "SOLID", width: 1, color: { red: 0.71, green: 0.79, blue: 0.9 } },
      innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.88, green: 0.92, blue: 0.97 } },
      innerVertical: { style: "SOLID", width: 1, color: { red: 0.88, green: 0.92, blue: 0.97 } },
    },
  });

  const presensiRange = {
    sheetId: presensiSheetId,
    startRowIndex: 0,
    endRowIndex: 3000,
    startColumnIndex: 0,
    endColumnIndex: 5,
  };

  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [presensiRange],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: '=REGEXMATCH($A1,"^Tanggal Kajian:")' }],
          },
          format: {
            backgroundColor: { red: 0.11, green: 0.43, blue: 0.74 },
            textFormat: {
              bold: true,
              foregroundColor: { red: 1, green: 1, blue: 1 },
            },
          },
        },
      },
    },
  });

  requests.push({
    addConditionalFormatRule: {
      index: 1,
      rule: {
        ranges: [presensiRange],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: '=$A1="waktu_input"' }],
          },
          format: {
            backgroundColor: { red: 0.77, green: 0.9, blue: 1 },
            textFormat: {
              bold: true,
              foregroundColor: { red: 0.05, green: 0.22, blue: 0.39 },
            },
          },
        },
      },
    },
  });

  requests.push({
    addConditionalFormatRule: {
      index: 2,
      rule: {
        ranges: [presensiRange],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [
              {
                userEnteredValue:
                  '=AND($A1<>"",$A1<>"waktu_input",NOT(REGEXMATCH($A1,"^Tanggal Kajian:")),ISEVEN(ROW()))',
              },
            ],
          },
          format: {
            backgroundColor: { red: 0.95, green: 0.98, blue: 1 },
          },
        },
      },
    },
  });

  requests.push({
    addConditionalFormatRule: {
      index: 3,
      rule: {
        ranges: [presensiRange],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [
              {
                userEnteredValue:
                  '=AND($A1<>"",$A1<>"waktu_input",NOT(REGEXMATCH($A1,"^Tanggal Kajian:")),ISODD(ROW()))',
              },
            ],
          },
          format: {
            backgroundColor: { red: 0.9, green: 0.95, blue: 1 },
          },
        },
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        spreadsheetId,
        styledSheets: [pesertaSheetTitle, presensiSheetTitle],
        message: "Sheet berhasil dirapikan dan diberi warna.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
