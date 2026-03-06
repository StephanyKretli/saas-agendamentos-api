/*
  Warnings:

  - A unique constraint covering the columns `[userId,phone]` on the table `Client` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_phone_key" ON "Client"("userId", "phone");
