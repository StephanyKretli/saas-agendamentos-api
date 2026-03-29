-- CreateTable
CREATE TABLE "_ProfessionalServices" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProfessionalServices_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ProfessionalServices_B_index" ON "_ProfessionalServices"("B");

-- AddForeignKey
ALTER TABLE "_ProfessionalServices" ADD CONSTRAINT "_ProfessionalServices_A_fkey" FOREIGN KEY ("A") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProfessionalServices" ADD CONSTRAINT "_ProfessionalServices_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
