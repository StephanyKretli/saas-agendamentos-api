/*
  Warnings:

  - A unique constraint covering the columns `[userId,weekday,start,end]` on the table `BusinessHour` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "BusinessHour_userId_idx";

-- DropIndex
DROP INDEX "BusinessHour_weekday_idx";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHour_userId_weekday_start_end_key" ON "BusinessHour"("userId", "weekday", "start", "end");
