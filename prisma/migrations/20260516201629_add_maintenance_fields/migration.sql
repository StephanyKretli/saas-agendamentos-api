/*
  Warnings:

  - You are about to drop the `_ProfessionalServices` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updatedAt` to the `Service` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "_ProfessionalServices" DROP CONSTRAINT "_ProfessionalServices_A_fkey";

-- DropForeignKey
ALTER TABLE "_ProfessionalServices" DROP CONSTRAINT "_ProfessionalServices_B_fkey";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "commissionValueCents" INTEGER,
ADD COLUMN     "netRevenueCents" INTEGER,
ADD COLUMN     "pixFeeCents" INTEGER;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "hasMaintenance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maintenanceDurationMinutes" INTEGER,
ADD COLUMN     "maintenancePriceCents" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "absorbPixFee" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "commissionType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "defaultCommissionRate" DOUBLE PRECISION,
ADD COLUMN     "document" TEXT;

-- DropTable
DROP TABLE "_ProfessionalServices";

-- CreateTable
CREATE TABLE "ProfessionalService" (
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "commissionRate" DOUBLE PRECISION,
    "commissionType" TEXT,

    CONSTRAINT "ProfessionalService_pkey" PRIMARY KEY ("professionalId","serviceId")
);

-- CreateIndex
CREATE INDEX "ProfessionalService_professionalId_idx" ON "ProfessionalService"("professionalId");

-- CreateIndex
CREATE INDEX "ProfessionalService_serviceId_idx" ON "ProfessionalService"("serviceId");

-- CreateIndex
CREATE INDEX "Service_userId_idx" ON "Service"("userId");

-- AddForeignKey
ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
