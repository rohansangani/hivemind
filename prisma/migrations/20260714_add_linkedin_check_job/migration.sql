-- CreateTable
CREATE TABLE "LinkedinCheckJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "urls" JSONB NOT NULL,
    "scrapeMode" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "mismatched" INTEGER NOT NULL DEFAULT 0,
    "notFound" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "uncertain" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedinCheckJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkedinCheckJob_organizationId_status_idx" ON "LinkedinCheckJob"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "LinkedinCheckJob" ADD CONSTRAINT "LinkedinCheckJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
