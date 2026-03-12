/*
  Warnings:

  - A unique constraint covering the columns `[publicCancelToken]` on the table `Appointment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "publicCancelToken" TEXT,
ADD COLUMN     "publicCancelTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_publicCancelToken_key" ON "Appointment"("publicCancelToken");
