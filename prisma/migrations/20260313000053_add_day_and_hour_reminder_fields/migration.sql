/*
  Warnings:

  - You are about to drop the column `reminderProcessingAt` on the `Appointment` table. All the data in the column will be lost.
  - You are about to drop the column `reminderSentAt` on the `Appointment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Appointment" DROP COLUMN "reminderProcessingAt",
DROP COLUMN "reminderSentAt",
ADD COLUMN     "dayReminderProcessingAt" TIMESTAMP(3),
ADD COLUMN     "dayReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "hourReminderProcessingAt" TIMESTAMP(3),
ADD COLUMN     "hourReminderSentAt" TIMESTAMP(3);
