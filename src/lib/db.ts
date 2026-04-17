import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any);
  return new PrismaClient({ adapter });
}

// In dev, stale clients (created before `prisma generate`) won't have new models.
// Detect by checking for a recently added model and recreate if missing.
function getOrCreateClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && "knowledgeDocument" in cached) return cached;
  // Cached client is stale or missing — create a fresh one
  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const db = getOrCreateClient();
