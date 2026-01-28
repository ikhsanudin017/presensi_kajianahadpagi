# Presensi Kajian Ahad Pagi - Masjid Al Irsyad

Aplikasi presensi multi-perangkat berbasis Next.js App Router + Prisma + Vercel Postgres. Integrasi otomatis ke Google Sheets menggunakan Service Account.

## Fitur Utama
- Presensi multi perangkat dengan deviceId dan anti-duplicate per tanggal.
- Combobox searchable untuk peserta + tambah peserta baru via dialog.
- Leaderboard top total hadir dan best streak (Ahad berturut-turut).
- Sinkronisasi otomatis ke Google Sheets (Participants & Attendance).
- Proteksi PIN sederhana untuk halaman presensi/admin (localStorage).

## Prasyarat
- Node.js 18+
- Database Vercel Postgres
- Google Service Account dengan akses Sheets + Drive

## Setup Lokal
1) Install dependencies:
   ```bash
   npm install
   ```
2) Salin env contoh:
   ```bash
   cp .env.example .env
   ```
3) Atur DATABASE_URL dan env Google Service Account di `.env`.
4) Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
5) Jalankan migrasi (setelah DATABASE_URL siap):
   ```bash
   npm run db:migrate
   ```
6) Buat Google Spreadsheet baru:
   ```bash
   npm run gsheet:create
   ```
   Salin SPREADSHEET_ID ke `GOOGLE_SHEETS_SPREADSHEET_ID`.
7) Seed peserta dari Excel (lokal):
   ```bash
   npm run db:seed:excel
   ```
8) Jalankan dev server:
   ```bash
   npm run dev
   ```

## Deployment ke Vercel
1) Buat Vercel Postgres & set `POSTGRES_PRISMA_URL` (non-pooling) atau `DATABASE_URL` (pastikan non-pooling untuk Prisma).
2) Jalankan `prisma migrate deploy` (via `npm run db:migrate` di CI atau manual).
3) Siapkan Google Service Account dan enable API:
   - Google Sheets API
   - Google Drive API
4) Set env berikut di Vercel:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
   - `GOOGLE_SHEETS_SPREADSHEET_ID`
   - `GOOGLE_SHEETS_PARTICIPANTS_SHEET_NAME`
   - `GOOGLE_SHEETS_ATTENDANCE_SHEET_NAME`
   - `ADMIN_PIN`
5) Deploy ke Vercel.

## Google Sheets - Service Account
- Scope minimal:
  - `https://www.googleapis.com/auth/spreadsheets`
  - `https://www.googleapis.com/auth/drive.file`
- Script `npm run gsheet:create` membuat spreadsheet baru dan otomatis dimiliki oleh service account.
- Jika spreadsheet dibuat manual, pastikan share ke email service account dengan akses Editor.

## Struktur Folder
- `src/app/page.tsx` - halaman Presensi
- `src/app/admin/page.tsx` - halaman Admin
- `src/app/leaderboard/page.tsx` - halaman Leaderboard
- `src/app/api/*` - API Routes
- `src/lib/googleSheets.ts` - helper Sheets
- `prisma/schema.prisma` - schema database
- `scripts/createGoogleSpreadsheet.ts` - buat spreadsheet baru
- `scripts/seedFromExcel.ts` - seed peserta dari Excel

## Catatan PIN
- Env `ADMIN_PIN` default diset ke `54321` di `.env.example`.
- Jika `ADMIN_PIN` kosong/tidak diset, PIN otomatis nonaktif.

## Troubleshooting
- Jika Google Sheets tidak sinkron, data tetap tersimpan di database dan akan menampilkan warning toast.
- Private key: pastikan `\n` diganti menjadi newline saat disimpan di env (sudah ditangani di code).
