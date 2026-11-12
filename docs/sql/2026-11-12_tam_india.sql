-- Radar DB — "ClickPost TAM" dashboard tab: India StoreLeads file accounts with monthly sales >= INR 10 lakh.
-- Loaded from IndiaStoreLeadsOct26.csv (domain-deduped; sales are StoreLeads' USD estimates; threshold = INR 1,000,000 / 88 INR per USD ≈ $11,364/mo).
-- Bucket/category columns reuse the exact functions accounts uses, so the TAM analysis is directly comparable to the India tab.
CREATE TABLE IF NOT EXISTS tam_india (
  domain text PRIMARY KEY,
  name text, platform text, city text, state text, country text NOT NULL DEFAULT 'India',
  linkedin_url text, has_description boolean NOT NULL DEFAULT false,
  employee_count integer, annual_revenue text, monthly_sales_usd numeric,
  industry text, sub_industry text,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  industry_category text GENERATED ALWAYS AS (split_part(radar_industry_path(industry, sub_industry), '|', 1)) STORED,
  industry_subcategory text GENERATED ALWAYS AS (split_part(radar_industry_path(industry, sub_industry), '|', 2)) STORED,
  employee_bucket text GENERATED ALWAYS AS (radar_employee_bucket(employee_count, NULL)) STORED,
  revenue_bucket text GENERATED ALWAYS AS (radar_revenue_bucket(NULL, annual_revenue)) STORED,
  monthly_revenue_bucket text GENERATED ALWAYS AS (radar_monthly_revenue_bucket(NULL, annual_revenue)) STORED
);
CREATE INDEX IF NOT EXISTS idx_tam_india_sales ON tam_india (monthly_sales_usd);
