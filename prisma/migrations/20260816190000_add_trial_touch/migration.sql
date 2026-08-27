-- CreateTable
CREATE TABLE "TrialTouch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "touch" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialTouch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialTouch_userId_idx" ON "TrialTouch"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialTouch_userId_touch_key" ON "TrialTouch"("userId", "touch");

-- AddForeignKey
ALTER TABLE "TrialTouch" ADD CONSTRAINT "TrialTouch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
