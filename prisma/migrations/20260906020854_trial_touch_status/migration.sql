-- CreateEnum
CREATE TYPE "TrialTouchStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'FALHOU');

-- AlterTable
ALTER TABLE "TrialTouch" ADD COLUMN     "erro" TEXT,
ADD COLUMN     "status" "TrialTouchStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN     "tentativas" INTEGER NOT NULL DEFAULT 0;
