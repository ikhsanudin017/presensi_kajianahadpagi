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
        { properties: { title: "Participants" } },
        { properties: { title: "Attendance" } },
      ],
    },
  });

  const spreadsheetId = createResponse.data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Failed to create spreadsheet");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Participants!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["createdAt", "name", "address", "gender"]],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Attendance!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["timestamp", "eventDate", "name", "address", "gender", "deviceId"]],
    },
  });

  console.log("SPREADSHEET_ID:", spreadsheetId);
  console.log("Set GOOGLE_SHEETS_SPREADSHEET_ID to this value in your env.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
