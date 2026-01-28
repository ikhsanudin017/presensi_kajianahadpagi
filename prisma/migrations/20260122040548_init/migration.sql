-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('L', 'P');

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" VARCHAR(255),
    "gender" "Gender",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Participant_name_idx" ON "Participant"("name");

-- CreateIndex
CREATE INDEX "Attendance_eventDate_idx" ON "Attendance"("eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_participantId_eventDate_key" ON "Attendance"("participantId", "eventDate");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
