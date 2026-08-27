-- AlterTable
ALTER TABLE "User" ADD COLUMN     "whatsappOptin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappOptinAt" TIMESTAMP(3),
ADD COLUMN     "whatsappOptinOrigem" TEXT,
ADD COLUMN     "whatsappOptinTexto" TEXT,
ADD COLUMN     "whatsappOptinIp" TEXT,
ADD COLUMN     "optOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optOutAt" TIMESTAMP(3);
