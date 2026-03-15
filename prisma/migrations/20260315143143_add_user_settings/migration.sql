-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maxBookingDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "minBookingNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
