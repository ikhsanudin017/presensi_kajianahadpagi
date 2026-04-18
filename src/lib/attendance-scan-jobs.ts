type ScanJobStatus = "queued" | "running" | "completed" | "failed";

export type AttendanceScanJobResult = {
  summary: {
    filesProcessed: number;
    detectedByOcr: number;
    createdAttendance: number;
    alreadyPresent: number;
    createdParticipants: number;
    duplicateInUpload: number;
    unresolved: number;
  };
  results: Array<{
    pageNumber: number;
    sourceName: string;
    participantName: string;
    participantId: string;
    participantStatus: "EXISTING" | "CREATED";
    attendanceStatus: "CREATED" | "ALREADY_PRESENT" | "DUPLICATE_IN_UPLOAD";
    confidence: "high" | "medium" | "low";
    resolutionMethod: "exact" | "phonetic" | "fuzzy" | "created";
    reason: string;
  }>;
  unresolved: Array<{
    pageNumber: number;
    sourceName: string;
    reason: string;
  }>;
  warnings: string[];
};

export type AttendanceScanJob = {
  id: string;
  status: ScanJobStatus;
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  result?: AttendanceScanJobResult;
  error?: string;
};

const JOB_TTL_MS = 1000 * 60 * 30;

declare global {
  var __attendanceScanJobs: Map<string, AttendanceScanJob> | undefined;
}

function getStore() {
  if (!globalThis.__attendanceScanJobs) {
    globalThis.__attendanceScanJobs = new Map<string, AttendanceScanJob>();
  }

  return globalThis.__attendanceScanJobs;
}

function cleanupExpiredJobs() {
  const store = getStore();
  const now = Date.now();

  for (const [id, job] of store.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      store.delete(id);
    }
  }
}

export function createAttendanceScanJob() {
  cleanupExpiredJobs();

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const job: AttendanceScanJob = {
    id,
    status: "queued",
    progress: 0,
    message: "Menunggu proses scan dimulai.",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  getStore().set(id, job);
  return job;
}

export function updateAttendanceScanJob(
  id: string,
  patch: Partial<Pick<AttendanceScanJob, "status" | "progress" | "message" | "result" | "error">>,
) {
  const store = getStore();
  const current = store.get(id);
  if (!current) {
    return null;
  }

  const next: AttendanceScanJob = {
    ...current,
    ...patch,
    progress:
      patch.progress !== undefined
        ? Math.max(0, Math.min(100, Math.round(patch.progress)))
        : current.progress,
    updatedAt: Date.now(),
  };

  store.set(id, next);
  return next;
}

export function getAttendanceScanJob(id: string) {
  cleanupExpiredJobs();
  return getStore().get(id) ?? null;
}
