-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trialExpiredSentAt" TIMESTAMP(3),
ADD COLUMN     "trialWarningSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "isVIP" BOOLEAN NOT NULL DEFAULT false;
