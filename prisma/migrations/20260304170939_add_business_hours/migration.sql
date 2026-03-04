-- CreateTable
CREATE TABLE "BusinessHour" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessHour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessHour_userId_idx" ON "BusinessHour"("userId");

-- CreateIndex
CREATE INDEX "BusinessHour_weekday_idx" ON "BusinessHour"("weekday");

-- AddForeignKey
ALTER TABLE "BusinessHour" ADD CONSTRAINT "BusinessHour_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
