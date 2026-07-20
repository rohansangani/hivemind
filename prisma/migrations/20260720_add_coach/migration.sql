-- CreateTable
CREATE TABLE "CoachTrack" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetRole" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isGenerated" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachModule" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoachModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachLesson" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "whyItMatters" TEXT,
    "keyPoints" TEXT NOT NULL,
    "entityType" TEXT,
    "entityName" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachQuestion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "correctIndex" INTEGER,
    "expectedAnswer" TEXT,
    "explanation" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoachQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "score" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAnswers" JSONB,
    "completedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachTrack_organizationId_order_idx" ON "CoachTrack"("organizationId", "order");

-- CreateIndex
CREATE INDEX "CoachModule_trackId_order_idx" ON "CoachModule"("trackId", "order");

-- CreateIndex
CREATE INDEX "CoachLesson_moduleId_order_idx" ON "CoachLesson"("moduleId", "order");

-- CreateIndex
CREATE INDEX "CoachQuestion_lessonId_order_idx" ON "CoachQuestion"("lessonId", "order");

-- CreateIndex
CREATE INDEX "CoachProgress_organizationId_userId_idx" ON "CoachProgress"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProgress_userId_lessonId_key" ON "CoachProgress"("userId", "lessonId");

-- AddForeignKey
ALTER TABLE "CoachTrack" ADD CONSTRAINT "CoachTrack_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachModule" ADD CONSTRAINT "CoachModule_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "CoachTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachLesson" ADD CONSTRAINT "CoachLesson_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CoachModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachQuestion" ADD CONSTRAINT "CoachQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CoachLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProgress" ADD CONSTRAINT "CoachProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProgress" ADD CONSTRAINT "CoachProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CoachLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
