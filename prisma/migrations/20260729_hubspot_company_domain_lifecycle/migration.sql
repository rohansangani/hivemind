-- AlterTable
ALTER TABLE "HubspotCompany" ADD COLUMN "domain" TEXT;
ALTER TABLE "HubspotCompany" ADD COLUMN "lifecycleStage" TEXT;
ALTER TABLE "HubspotCompany" ADD COLUMN "leadStatus" TEXT;

-- CreateIndex
CREATE INDEX "HubspotCompany_organizationId_domain_idx" ON "HubspotCompany"("organizationId", "domain");
