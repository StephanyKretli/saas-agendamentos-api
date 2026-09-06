-- AlterTable
-- Flag manual/retroativa de conta de teste. Sem backfill aqui: o codigo nao
-- tem como saber quais contas sao de teste. Marcacao vem por SQL depois do deploy.
ALTER TABLE "User" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
