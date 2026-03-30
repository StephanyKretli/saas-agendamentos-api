-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pixDepositPercentage" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "requirePixDeposit" BOOLEAN NOT NULL DEFAULT false;
