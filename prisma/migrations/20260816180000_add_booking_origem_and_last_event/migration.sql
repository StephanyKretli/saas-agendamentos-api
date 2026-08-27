-- CreateEnum
CREATE TYPE "BookingOrigem" AS ENUM ('PROFISSIONAL', 'CLIENTE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastProductEventAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "origem" "BookingOrigem" NOT NULL DEFAULT 'PROFISSIONAL';
