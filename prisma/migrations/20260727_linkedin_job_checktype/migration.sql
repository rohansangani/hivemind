-- Splits Check LinkedIn into two scraper types sharing one job/history system: "profile"
-- (existing harvestapi/linkedin-profile-scraper, matched against contacts) and "company" (new
-- harvestapi/linkedin-company, matched against accounts). Existing rows default to "profile" so
-- past jobs keep working unchanged.
ALTER TABLE "LinkedinCheckJob" ADD COLUMN "checkType" TEXT NOT NULL DEFAULT 'profile';
