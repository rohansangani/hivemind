// Self-heals a recurring build failure: `prisma migrate deploy` acquires Postgres's session-level
// advisory lock 72707369 to serialize migrations, then something interrupts it (a build timeout, a
// race between concurrent deploys) before the matching unlock runs. Because advisory locks are
// tied to the connection, not the transaction, the lock stays held — and since Neon/Prisma pools
// connections, that same connection gets recycled back into ordinary app traffic instead of
// dying. Every subsequent migrate deploy then hangs 10s waiting on the lock and fails with P1002,
// even though nothing is actually running a migration. Confirmed live three times this session:
// the "stuck" backend always shows some unrelated app SELECT as its last query, never the lock
// call itself, because pg_stat_activity.query only reflects the MOST RECENT query on that
// connection.
//
// Runs as a pre-step to `prisma migrate deploy` in package.json's build script. Only ever
// terminates a connection that is BOTH holding this exact lock (Prisma's fixed migrate-lock key,
// identified via pg_locks' classid/objid encoding for the single-bigint advisory lock form) AND
// currently idle — a connection actively running the real migration shows state='active' and is
// left alone, so this can't cannibalize a genuinely in-progress deploy.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[clear-stale-migrate-lock] no DATABASE_URL, skipping");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
// Terminating a backend can land on the SAME pooled connection that issued the terminate call
// (confirmed live: Neon's pooler routed it that way), which fires an unhandled 'error' event on
// the pool and crashes this script with a non-zero exit — which then aborts the `&&`-chained
// `prisma migrate deploy` step entirely, turning this self-heal into a NEW build failure. This
// script must never be the reason a build fails, so every connection-level error is swallowed here.
pool.on("error", (e) => {
  console.log(`[clear-stale-migrate-lock] pool error (expected when self-terminating), ignoring: ${e.message}`);
});

try {
  const { rows } = await pool.query(`
    SELECT l.pid
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory'
      AND l.classid = 0 AND l.objid = 72707369 AND l.objsubid = 1
      AND l.granted = true
      AND a.state = 'idle'
  `);
  if (!rows.length) {
    console.log("[clear-stale-migrate-lock] no stale lock holder found");
  }
  for (const r of rows) {
    console.log(`[clear-stale-migrate-lock] terminating stale idle migrate-lock holder pid=${r.pid}`);
    try {
      await pool.query("SELECT pg_terminate_backend($1)", [r.pid]);
    } catch (e) {
      // Expected in the self-terminate case above — the pid got cleared either way.
      console.log(`[clear-stale-migrate-lock] terminate call errored (likely self-termination), continuing: ${e.message}`);
    }
  }
} catch (e) {
  // Non-fatal by design — if this check itself fails, fall through to the real migrate deploy
  // and let it fail with its own (already-diagnosable) error rather than blocking the build here.
  console.log(`[clear-stale-migrate-lock] check failed, continuing anyway: ${e.message}`);
} finally {
  try { await pool.end(); } catch { /* pool may already be dead — fine, we're exiting anyway */ }
}

// Always succeed — this script's own job is best-effort cleanup, never a build gate.
process.exit(0);
