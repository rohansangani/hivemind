import path from "node:path";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrate: {
    async adapter() {
      // Migrations need a direct (non-pooled) connection — pgbouncer breaks the
      // advisory locks Prisma Migrate takes. Neon provides DATABASE_URL_UNPOOLED.
      return new PrismaPg({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL! });
    },
  },
});
