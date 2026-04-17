CREATE TABLE public."Account" (
    id text NOT NULL,
    "userId" text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text
);

CREATE TABLE public."BrandProfile" (
    id text NOT NULL,
    traits text[],
    archetype text,
    "toneFormal" integer DEFAULT 30 NOT NULL,
    "toneTechnical" integer DEFAULT 25 NOT NULL,
    "toneSerious" integer DEFAULT 35 NOT NULL,
    "toneCorporate" integer DEFAULT 45 NOT NULL,
    "voiceDescription" text,
    "wordsWeUse" text[],
    "wordsWeAvoid" text[],
    "competitiveMoat" text,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."Competitor" (
    id text NOT NULL,
    name text NOT NULL,
    website text,
    "marketOverlap" text[],
    positioning text,
    differentiator text,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."ContentAsset" (
    id text NOT NULL,
    name text NOT NULL,
    "fileName" text,
    "fileUrl" text,
    "fileType" text,
    "fileSize" integer,
    "contentType" text,
    "linkedUrl" text,
    "productTags" text[],
    "marketTags" text[],
    "personaTags" text[],
    "customTags" text[],
    "brandScore" double precision,
    "scoreVoice" double precision,
    "scoreTerminology" double precision,
    "scoreMessaging" double precision,
    "scorePersonality" double precision,
    "scoreCompleteness" double precision,
    "scoreSuggestions" text[],
    "scoreStatus" text DEFAULT 'pending' NOT NULL,
    "aiSummary" text,
    "uploadedById" text NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."Conversation" (
    id text NOT NULL,
    title text,
    "userId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."GeneratedContent" (
    id text NOT NULL,
    topic text NOT NULL,
    formats text[],
    "targetProduct" text,
    "targetMarket" text,
    "targetPersona" text,
    "positionAgainst" text,
    "toneOverride" text,
    "keyPoints" text,
    "referenceAssets" text[],
    outputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    "generatedById" text NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."IndustryInsight" (
    id text NOT NULL,
    "signalType" text NOT NULL,
    priority text DEFAULT 'medium' NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    "sourceUrl" text,
    "sourceName" text,
    takeaway text,
    tags text[],
    "addedToKB" boolean DEFAULT false NOT NULL,
    "kbCategories" text[],
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "relevanceScore" integer DEFAULT 50 NOT NULL
);

CREATE TABLE public."KnowledgeDocument" (
    id text NOT NULL,
    name text NOT NULL,
    "fileName" text NOT NULL,
    "fileUrl" text NOT NULL,
    "fileType" text NOT NULL,
    "fileSize" integer,
    status text DEFAULT 'processing' NOT NULL,
    "learningsCount" integer DEFAULT 0 NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."KnowledgeEntry" (
    id text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    source text DEFAULT 'wizard' NOT NULL,
    "isAIGenerated" boolean DEFAULT false NOT NULL,
    "isApproved" boolean DEFAULT true NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."LearningLog" (
    id text NOT NULL,
    "sourceType" text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    takeaway text,
    "kbCategories" text[],
    tags text[],
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "sourceDocumentId" text
);

CREATE TABLE public."Market" (
    id text NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'primary' NOT NULL,
    notes text,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."Message" (
    id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    citations jsonb,
    "conversationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."Organization" (
    id text NOT NULL,
    name text NOT NULL,
    website text,
    industry text,
    "subIndustry" text,
    description text,
    size text,
    "hqCity" text,
    "hqCountry" text,
    "yearFounded" integer,
    mission text,
    vision text,
    "setupComplete" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "insightLastRefreshedAt" timestamp without time zone,
    "allowedDomains" text[] DEFAULT ARRAY[]::text[] NOT NULL
);

CREATE TABLE public."Persona" (
    id text NOT NULL,
    title text NOT NULL,
    department text,
    seniority text,
    kras text[],
    kpis text[],
    "painPoints" text,
    "howWeHelp" text,
    "contentPrefs" text[],
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."Product" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    classification text,
    scope text DEFAULT 'global' NOT NULL,
    features text[],
    "useCases" text,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."ProductMarket" (
    "productId" text NOT NULL,
    "marketId" text NOT NULL
);

CREATE TABLE public."Session" (
    id text NOT NULL,
    "sessionToken" text NOT NULL,
    "userId" text NOT NULL,
    expires timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."Skill" (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    "linkedFeature" text NOT NULL,
    instructions text NOT NULL,
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    password text,
    image text,
    role text DEFAULT 'member' NOT NULL,
    department text,
    "jobTitle" text,
    "jobRole" text,
    onboarded boolean DEFAULT false NOT NULL,
    "inviteStatus" text,
    "lastActiveAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text,
    "inviteToken" text
);

CREATE TABLE public."UserPermission" (
    id text NOT NULL,
    "userId" text NOT NULL,
    permissions jsonb DEFAULT '{}' NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

-- Primary keys
ALTER TABLE ONLY public."Account" ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."BrandProfile" ADD CONSTRAINT "BrandProfile_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Competitor" ADD CONSTRAINT "Competitor_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."ContentAsset" ADD CONSTRAINT "ContentAsset_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Conversation" ADD CONSTRAINT "Conversation_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."GeneratedContent" ADD CONSTRAINT "GeneratedContent_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."IndustryInsight" ADD CONSTRAINT "IndustryInsight_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."LearningLog" ADD CONSTRAINT "LearningLog_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Market" ADD CONSTRAINT "Market_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Message" ADD CONSTRAINT "Message_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Organization" ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Persona" ADD CONSTRAINT "Persona_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."ProductMarket" ADD CONSTRAINT "ProductMarket_pkey" PRIMARY KEY ("productId", "marketId");
ALTER TABLE ONLY public."Product" ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Session" ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."Skill" ADD CONSTRAINT "Skill_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."UserPermission" ADD CONSTRAINT "UserPermission_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."UserPermission" ADD CONSTRAINT "UserPermission_userId_key" UNIQUE ("userId");
ALTER TABLE ONLY public."User" ADD CONSTRAINT "User_inviteToken_key" UNIQUE ("inviteToken");
ALTER TABLE ONLY public."User" ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);

-- Unique indexes
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON public."Account" USING btree (provider, "providerAccountId");
CREATE UNIQUE INDEX "BrandProfile_organizationId_key" ON public."BrandProfile" USING btree ("organizationId");
CREATE UNIQUE INDEX "Session_sessionToken_key" ON public."Session" USING btree ("sessionToken");
CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);

-- Foreign keys
ALTER TABLE ONLY public."BrandProfile" ADD CONSTRAINT "BrandProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."Competitor" ADD CONSTRAINT "Competitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."ContentAsset" ADD CONSTRAINT "ContentAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."ContentAsset" ADD CONSTRAINT "ContentAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."GeneratedContent" ADD CONSTRAINT "GeneratedContent_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."GeneratedContent" ADD CONSTRAINT "GeneratedContent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."IndustryInsight" ADD CONSTRAINT "IndustryInsight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."LearningLog" ADD CONSTRAINT "LearningLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."Market" ADD CONSTRAINT "Market_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."Conversation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."Persona" ADD CONSTRAINT "Persona_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."ProductMarket" ADD CONSTRAINT "ProductMarket_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES public."Market"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."ProductMarket" ADD CONSTRAINT "ProductMarket_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."Skill" ADD CONSTRAINT "Skill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public."UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;
