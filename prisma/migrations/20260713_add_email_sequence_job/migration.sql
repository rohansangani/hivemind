-- CreateTable
CREATE TABLE "EmailSequenceJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "prospects" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSequenceJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailSequenceJob_organizationId_status_idx" ON "EmailSequenceJob"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "EmailSequenceJob" ADD CONSTRAINT "EmailSequenceJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
