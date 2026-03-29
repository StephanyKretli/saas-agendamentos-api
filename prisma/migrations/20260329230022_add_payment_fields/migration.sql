/*
  Warnings:

  - A unique constraint covering the columns `[transactionId]` on the table `Appointment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "depositCents" INTEGER,
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "pixPayload" TEXT,
ADD COLUMN     "transactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_transactionId_key" ON "Appointment"("transactionId");
