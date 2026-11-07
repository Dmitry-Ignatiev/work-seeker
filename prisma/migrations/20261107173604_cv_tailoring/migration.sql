-- AlterEnum
ALTER TYPE "AiRunKind" ADD VALUE 'TAILOR_CV';

-- AlterTable
ALTER TABLE "Cv" ADD COLUMN     "structure" JSONB,
ADD COLUMN     "structureVersion" TEXT;

-- AlterTable
ALTER TABLE "JobRequirement" ADD COLUMN     "keyword" TEXT;

-- CreateTable
CREATE TABLE "TailoredCv" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cvId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "rejected" JSONB NOT NULL DEFAULT '[]',
    "missing" TEXT[],
    "keywordTotal" INTEGER NOT NULL,
    "coverageBefore" INTEGER NOT NULL,
    "coverageAfter" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TailoredCv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmedExperience" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "keywordKey" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfirmedExperience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TailoredCv_userId_createdAt_idx" ON "TailoredCv"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmedExperience_userId_keywordKey_key" ON "ConfirmedExperience"("userId", "keywordKey");

-- AddForeignKey
ALTER TABLE "TailoredCv" ADD CONSTRAINT "TailoredCv_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailoredCv" ADD CONSTRAINT "TailoredCv_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "Cv"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailoredCv" ADD CONSTRAINT "TailoredCv_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmedExperience" ADD CONSTRAINT "ConfirmedExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
