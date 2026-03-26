/*
  Warnings:

  - Added the required column `professionalId` to the `Appointment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'PRO', 'BUSINESS');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PROFESSIONAL';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "professionalId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "maxMembers" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'STARTER';

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
