-- Dashboard growth: get_growth_snapshots() recomputes + upserts today's row on EVERY call (20-50 s now — it made /api/radar/stats
-- exceed its 20 s limit: "Failed to load stats"). The dashboard now READS rows with this cheap function; the stats route refreshes
-- today's snapshot in the background (after()) at most every 30 min.
CREATE OR REPLACE FUNCTION public.read_growth_snapshots()
 RETURNS TABLE(out_snapshot_date date, out_vertical text, out_contacts integer, out_nonempty_domains integer, out_avg_per_domain numeric, out_verified integer, out_validated integer, out_total_accounts integer)
 LANGUAGE sql STABLE AS $f$
  SELECT g.snapshot_date, g.vertical, g.contacts, g.nonempty_domains, g.avg_per_domain, g.verified, g.validated, g.total_accounts
  FROM growth_snapshots g ORDER BY g.snapshot_date, g.vertical
$f$;
GRANT EXECUTE ON FUNCTION public.read_growth_snapshots() TO anon, authenticated, service_role;
