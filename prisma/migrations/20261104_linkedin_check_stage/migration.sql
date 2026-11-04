-- Live progress text for Check LinkedIn jobs (which provider/step is running right now).
ALTER TABLE "LinkedinCheckJob" ADD COLUMN "stage" TEXT;
