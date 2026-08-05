-- CreateTable
CREATE TABLE "RadarCsvExportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "type" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "emailStatuses" JSONB,
    "groupCap" JSONB,
    "status" TEXT NOT NULL DEFAULT 'running',
    "csv" TEXT,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "exported" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarCsvExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RadarCsvExportJob_organizationId_status_idx" ON "RadarCsvExportJob"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "RadarCsvExportJob" ADD CONSTRAINT "RadarCsvExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
