-- CreateTable
CREATE TABLE "HubspotContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hubspotId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "jobTitle" TEXT,
    "lifecycleStage" TEXT,
    "leadSource" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "hubspotCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubspotContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HubspotContact_organizationId_email_key" ON "HubspotContact"("organizationId", "email");

-- CreateIndex
CREATE INDEX "HubspotContact_organizationId_lifecycleStage_idx" ON "HubspotContact"("organizationId", "lifecycleStage");

-- CreateIndex
CREATE INDEX "HubspotContact_organizationId_company_idx" ON "HubspotContact"("organizationId", "company");

-- AddForeignKey
ALTER TABLE "HubspotContact" ADD CONSTRAINT "HubspotContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
