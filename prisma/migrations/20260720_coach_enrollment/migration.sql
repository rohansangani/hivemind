-- NOTE: `prisma migrate diff` also emitted `DROP TABLE "UserPermission"` because
-- that table is created at runtime via raw SQL (team permissions route) and isn't
-- part of the Prisma schema. Dropping it would delete every per-user permission
-- override — deliberately removed. This migration only adds CoachEnrollment.

-- CreateTable
CREATE TABLE "CoachEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoachEnrollment_userId_key" ON "CoachEnrollment"("userId");

-- CreateIndex
CREATE INDEX "CoachEnrollment_organizationId_idx" ON "CoachEnrollment"("organizationId");

-- AddForeignKey
ALTER TABLE "CoachEnrollment" ADD CONSTRAINT "CoachEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachEnrollment" ADD CONSTRAINT "CoachEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
