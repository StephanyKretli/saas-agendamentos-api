-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDENTE', 'PROCESSADO', 'FALHOU');

-- AlterTable
-- Linhas historicas ja foram processadas pelo fluxo antigo (a linha so era
-- criada apos o processamento no switch). Nascem como PROCESSADO para nao
-- serem reprocessadas; o default volta para PENDENTE em seguida, que e o que
-- o codigo novo grava explicitamente ao reservar.
ALTER TABLE "ProcessedWebhookEvent"
  ADD COLUMN "erro" TEXT,
  ADD COLUMN "tentativas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" "WebhookEventStatus" NOT NULL DEFAULT 'PROCESSADO';

ALTER TABLE "ProcessedWebhookEvent" ALTER COLUMN "status" SET DEFAULT 'PENDENTE';
