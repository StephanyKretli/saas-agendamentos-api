-- AlterTable
-- Verificacao do numero no WhatsApp. Tres campos anulaveis, sem default e sem
-- backfill: ninguem foi verificado ainda; a checagem roda quando o telefone e
-- gravado/alterado. null = nao verificado (distinto de false = nao tem).
ALTER TABLE "User"
  ADD COLUMN "whatsappNumberExists" BOOLEAN,
  ADD COLUMN "whatsappJid" TEXT,
  ADD COLUMN "whatsappCheckedAt" TIMESTAMP(3);
