-- AlterEnum
ALTER TYPE "JobSource" ADD VALUE 'GOTFRIENDS';

-- AlterTable
ALTER TABLE "CareerSource" ADD COLUMN     "addedByUserId" TEXT,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastError" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "careerSourceId" TEXT;

-- CreateIndex
CREATE INDEX "Job_careerSourceId_idx" ON "Job"("careerSourceId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_careerSourceId_fkey" FOREIGN KEY ("careerSourceId") REFERENCES "CareerSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerSource" ADD CONSTRAINT "CareerSource_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
