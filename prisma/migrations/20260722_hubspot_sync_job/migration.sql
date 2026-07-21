-- NOTE: `prisma migrate diff` also emitted `DROP TABLE "UserPermission"` (raw
-- non-Prisma table) — deliberately removed so per-user permission overrides survive.

CREATE TABLE "HubspotSyncJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "phase" TEXT NOT NULL DEFAULT 'contacts',
    "state" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HubspotSyncJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HubspotSyncJob_status_idx" ON "HubspotSyncJob"("status");
CREATE INDEX "HubspotSyncJob_organizationId_createdAt_idx" ON "HubspotSyncJob"("organizationId", "createdAt");
ALTER TABLE "HubspotSyncJob" ADD CONSTRAINT "HubspotSyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
