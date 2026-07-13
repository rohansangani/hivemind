import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Verify the server certificate in production. Neon presents a
    // publicly-trusted cert, so this succeeds — the old `rejectUnauthorized:
    // false` silently accepted any cert (MITM exposure) for no benefit.
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any);
  return new PrismaClient({ adapter });
}

// Standard Next.js singleton: cache on globalThis ONLY in dev so Fast Refresh
// reuses one client (and one pool) across reloads instead of leaking a new pool
// per edit. In production each lambda instance gets its own module-scoped client.
//
// The previous "staleness detection" hack recreated the client whenever a
// sentinel model was missing — but it abandoned the old pg.Pool without closing
// it (a connection leak), and the sentinel rotted as new models were added. The
// honest fix for "new model missing after `prisma generate`" is to restart the
// dev server.
export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
