-- Monthly revenue brackets: "Under $10K" is split into "Under $5K" and "$5K-$10K". Applied 2026-11-12.
-- The bucket columns are STORED generated columns, so after replacing the function the values are recomputed with SET EXPRESSION (PG17 rewrite).
CREATE OR REPLACE FUNCTION public.radar_monthly_revenue_bucket(p_range text, p_annual text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN v IS NULL THEN 'Unknown' WHEN v < 5e3 THEN 'Under $5K' WHEN v < 1e4 THEN '$5K-$10K' WHEN v < 2.5e4 THEN '$10K-$25K' WHEN v < 5e4 THEN '$25K-$50K'
              WHEN v < 1e5 THEN '$50K-$100K' WHEN v < 2.5e5 THEN '$100K-$250K' WHEN v < 5e5 THEN '$250K-$500K'
              WHEN v < 1e6 THEN '$500K-$1M' WHEN v < 5e6 THEN '$1M-$5M' ELSE '$5M+' END
  FROM (SELECT radar_revenue_usd(p_range, p_annual) / 12 AS v) x
$f$;
ALTER TABLE accounts ALTER COLUMN monthly_revenue_bucket SET EXPRESSION AS (radar_monthly_revenue_bucket(revenue_range, annual_revenue));
ALTER TABLE tam_india ALTER COLUMN monthly_revenue_bucket SET EXPRESSION AS (radar_monthly_revenue_bucket(NULL, annual_revenue));
