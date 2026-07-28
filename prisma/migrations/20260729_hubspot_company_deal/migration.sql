-- CreateTable
CREATE TABLE "HubspotCompany" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hubspotId" TEXT NOT NULL,
    "name" TEXT,
    "industry" TEXT,
    "annualRevenue" DOUBLE PRECISION,
    "numberOfEmployees" INTEGER,
    "country" TEXT,
    "city" TEXT,
    "website" TEXT,
    "description" TEXT,
    "companyType" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "hubspotCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubspotCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubspotDeal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hubspotId" TEXT NOT NULL,
    "dealName" TEXT,
    "dealStage" TEXT,
    "amount" DOUBLE PRECISION,
    "pipeline" TEXT,
    "closeDate" TIMESTAMP(3),
    "probability" DOUBLE PRECISION,
    "dealType" TEXT,
    "description" TEXT,
    "hubspotCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubspotDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HubspotCompany_organizationId_hubspotId_key" ON "HubspotCompany"("organizationId", "hubspotId");
CREATE INDEX "HubspotCompany_organizationId_industry_idx" ON "HubspotCompany"("organizationId", "industry");
CREATE INDEX "HubspotCompany_organizationId_name_idx" ON "HubspotCompany"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HubspotDeal_organizationId_hubspotId_key" ON "HubspotDeal"("organizationId", "hubspotId");
CREATE INDEX "HubspotDeal_organizationId_dealStage_idx" ON "HubspotDeal"("organizationId", "dealStage");

-- AddForeignKey
ALTER TABLE "HubspotCompany" ADD CONSTRAINT "HubspotCompany_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HubspotDeal" ADD CONSTRAINT "HubspotDeal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
