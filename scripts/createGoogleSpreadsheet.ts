import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

async function main() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (!clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
  });

  const sheets = google.sheets({ version: "v4", auth });
  const createResponse = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: "Presensi Kajian Ahad - Masjid Al Irsyad",
      },
      sheets: [
        { properties: { title: "Peserta" } },
        { properties: { title: "Presensi" } },
      ],
    },
  });

  const spreadsheetId = createResponse.data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Failed to create spreadsheet");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Peserta!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["dibuat_pada", "nama", "alamat", "jenis_kelamin"]],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Presensi!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["waktu_input", "tanggal_kajian", "nama", "alamat", "jenis_kelamin", "id_perangkat"]],
    },
  });

  console.log("SPREADSHEET_ID:", spreadsheetId);
  console.log("Set GOOGLE_SHEETS_SPREADSHEET_ID to this value in your env.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
