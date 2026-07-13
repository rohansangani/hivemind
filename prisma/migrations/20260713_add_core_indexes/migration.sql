-- CreateIndex
CREATE INDEX "ContentAsset_organizationId_createdAt_idx" ON "ContentAsset"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentAsset_organizationId_fileHash_idx" ON "ContentAsset"("organizationId", "fileHash");

-- CreateIndex
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "GeneratedContent_organizationId_createdAt_idx" ON "GeneratedContent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedContent_generatedById_createdAt_idx" ON "GeneratedContent"("generatedById", "createdAt");

-- CreateIndex
CREATE INDEX "IndustryInsight_organizationId_createdAt_idx" ON "IndustryInsight"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_organizationId_source_createdAt_idx" ON "KnowledgeEntry"("organizationId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_organizationId_category_idx" ON "KnowledgeEntry"("organizationId", "category");

-- CreateIndex
CREATE INDEX "LearningLog_organizationId_createdAt_idx" ON "LearningLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Skill_organizationId_isActive_idx" ON "Skill"("organizationId", "isActive");
