-- CreateTable
CREATE TABLE "WebsiteInsightCache" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "insights" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteInsightCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteInsightCache_key_key" ON "WebsiteInsightCache"("key");
