-- AlterTable
ALTER TABLE "HubspotContact" ADD COLUMN "leadStatus" TEXT;

-- CreateIndex
CREATE INDEX "HubspotContact_organizationId_leadStatus_idx" ON "HubspotContact"("organizationId", "leadStatus");
