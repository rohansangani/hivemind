-- Add a stable per-lesson identity so regeneration can match & preserve lessons
-- (and their CoachProgress) instead of deleting/recreating them.

-- 1. Add the column (all existing rows default to '').
ALTER TABLE "CoachLesson" ADD COLUMN "key" TEXT NOT NULL DEFAULT '';

-- 2. Backfill BEFORE the unique index so existing rows don't collide on ''.
--    Matches the key the app computes: "<entityType>:<lower(entityName)>" for
--    entity lessons, else "domain:<module domain>".
UPDATE "CoachLesson" cl
SET "key" = CASE
  WHEN cl."entityType" IS NOT NULL AND cl."entityName" IS NOT NULL
    THEN cl."entityType" || ':' || lower(cl."entityName")
  ELSE 'domain:' || COALESCE((SELECT cm."domain" FROM "CoachModule" cm WHERE cm."id" = cl."moduleId"), cl."id")
END
WHERE "key" = '';

-- 3. Now the unique constraint is safe.
CREATE UNIQUE INDEX "CoachLesson_moduleId_key_key" ON "CoachLesson"("moduleId", "key");
