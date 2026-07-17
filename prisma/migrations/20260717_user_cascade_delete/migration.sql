-- DropForeignKey
ALTER TABLE "ContentAsset" DROP CONSTRAINT "ContentAsset_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_userId_fkey";

-- DropForeignKey
ALTER TABLE "DesignBrief" DROP CONSTRAINT "DesignBrief_createdById_fkey";

-- DropForeignKey
ALTER TABLE "EmailSequenceJob" DROP CONSTRAINT "EmailSequenceJob_userId_fkey";

-- DropForeignKey
ALTER TABLE "GeneratedContent" DROP CONSTRAINT "GeneratedContent_generatedById_fkey";

-- DropForeignKey
ALTER TABLE "LinkedinCheckJob" DROP CONSTRAINT "LinkedinCheckJob_userId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "RadarActivityLog" DROP CONSTRAINT "RadarActivityLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "RadarExportLog" DROP CONSTRAINT "RadarExportLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "TourProgress" DROP CONSTRAINT "TourProgress_userId_fkey";

-- AddForeignKey
ALTER TABLE "RadarExportLog" ADD CONSTRAINT "RadarExportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarActivityLog" ADD CONSTRAINT "RadarActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSequenceJob" ADD CONSTRAINT "EmailSequenceJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedinCheckJob" ADD CONSTRAINT "LinkedinCheckJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignBrief" ADD CONSTRAINT "DesignBrief_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourProgress" ADD CONSTRAINT "TourProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
