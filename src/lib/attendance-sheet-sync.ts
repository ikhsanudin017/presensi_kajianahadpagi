import { prisma } from "@/lib/prisma";
import { syncAttendanceSheetByDate } from "@/lib/googleSheets";

let syncQueue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSync() {
  const sheetName = process.env.GOOGLE_SHEETS_ATTENDANCE_SHEET_NAME ?? "Presensi";

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

  return syncAttendanceSheetByDate(
    sheetName,
    attendance.map((row) => ({
      createdAt: row.createdAt,
      eventDate: row.eventDate,
      name: row.participant.name,
      address: row.participant.address,
      gender: row.participant.gender ?? "",
      deviceId: row.deviceId,
    })),
  );
}

export async function syncAttendanceSheetFromDatabase() {
  const task = syncQueue
    .catch(() => null)
    .then(async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await runSync().catch((error) => {
          console.error("Attendance sheet sync attempt failed", { attempt, error });
          return { ok: false } as const;
        });

        if (result.ok) {
          return result;
        }

        if (attempt < 3) {
          await sleep(300 * attempt);
        }
      }

      return { ok: false } as const;
    });

  syncQueue = task.then(
    () => undefined,
    () => undefined,
  );

  return task;
}
