-- Radar DB — clean, categorised firmographics (applied 2026-11-04).
-- Raw industry/sub_industry/employee_range/revenue_range are left untouched; these stored generated
-- columns give the Filters panel a clean taxonomy and recompute automatically on every insert/update.
-- To change a rule: edit + re-run the function, then `UPDATE accounts SET industry = industry;` to recompute.

CREATE OR REPLACE FUNCTION radar_industry_path(p_industry text, p_sub text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
-- Clean 'Category|Subcategory' for an account's raw industry + sub_industry (rules: docs/sql/2026-11-04_firmographics_clean.sql).
DECLARE t text := lower(COALESCE(btrim(p_industry), '') || ' | ' || COALESCE(btrim(p_sub), ''));
BEGIN
  IF COALESCE(btrim(p_industry), '') = '' AND COALESCE(btrim(p_sub), '') = '' THEN RETURN NULL; END IF;
  IF t ~* $re$website not working|^\s*\|?\s*(uncategori[sz]ed|others?|n/?a|-|none|test)\s*(\||$)$re$ THEN RETURN $v$Other|Uncategorised$v$; END IF;
  IF t ~* $re$adult|sexual$re$ THEN RETURN $v$Other|Adult$v$; END IF;
  IF t ~* $re$smok|vap|tobacco|hookah|cigar$re$ THEN RETURN $v$Other|Smoking & Vaping$v$; END IF;
  IF t ~* $re$watch$re$ THEN RETURN $v$Jewellery & Luxury|Watches$v$; END IF;
  IF t ~* $re$jewel|jewelry|jewellery|gold|silver|diamond|gemstone$re$ THEN RETURN $v$Jewellery & Luxury|Jewellery$v$; END IF;
  IF t ~* $re$luxury$re$ THEN RETURN $v$Jewellery & Luxury|Luxury Goods$v$; END IF;
  IF t ~* $re$skin|face & body|facial|sunscreen|serum$re$ THEN RETURN $v$Beauty & Personal Care|Skincare$v$; END IF;
  IF t ~* $re$hair$re$ THEN RETURN $v$Beauty & Personal Care|Haircare$v$; END IF;
  IF t ~* $re$fragrance|perfume|attar|deodorant|scent$re$ THEN RETURN $v$Beauty & Personal Care|Fragrance$v$; END IF;
  IF t ~* $re$cosmetic|make-?up|nail|lipstick$re$ THEN RETURN $v$Beauty & Personal Care|Makeup & Cosmetics$v$; END IF;
  IF t ~* $re$(^|/|\|\s*)personal care|hygiene|grooming|shaving|beard|oral care|intimate|feminine|menstrual|period$re$ THEN RETURN $v$Beauty & Personal Care|Personal Care & Hygiene$v$; END IF;
  IF t ~* $re$(^|/|\|\s*)fitness|gym|yoga|exercise|workout$re$ THEN RETURN $v$Health & Wellness|Fitness$v$; END IF;
  IF t ~* $re$supplement|nutrition|protein|vitamin|nutraceutical$re$ THEN RETURN $v$Health & Wellness|Supplements & Nutrition$v$; END IF;
  IF t ~* $re$pharma|medical|hospital|health ?care|clinic|medicine|diagnostic|dental|optical|eye ?care$re$ THEN RETURN $v$Health & Wellness|Pharma & Medical$v$; END IF;
  IF t ~* $re$ayurved|herbal|alternative medicine|(^|/|\|\s*)wellness$re$ THEN RETURN $v$Health & Wellness|Ayurveda & Wellness$v$; END IF;
  IF t ~* $re$health$re$ THEN RETURN $v$Health & Wellness|General Health$v$; END IF;
  IF t ~* $re$beauty$re$ THEN RETURN $v$Beauty & Personal Care|General Beauty$v$; END IF;
  IF t ~* $re$footwear|shoe|sneaker|sandal|slipper|boot$re$ THEN RETURN $v$Apparel & Fashion|Footwear$v$; END IF;
  IF t ~* $re$bag|luggage|backpack|wallet|purse|handbag$re$ THEN RETURN $v$Apparel & Fashion|Bags & Luggage$v$; END IF;
  IF t ~* $re$eyewear|sunglass|spectacle$re$ THEN RETURN $v$Apparel & Fashion|Eyewear$v$; END IF;
  IF t ~* $re$lingerie|innerwear|underwear|intimates|(^|[^a-z])bras?([^a-z]|$)|sleepwear|loungewear|nightwear$re$ THEN RETURN $v$Apparel & Fashion|Innerwear & Lingerie$v$; END IF;
  IF t ~* $re$activewear|active wear|athletic|athleisure|sportswear|sports & active$re$ THEN RETURN $v$Apparel & Fashion|Activewear$v$; END IF;
  IF t ~* $re$ethnic|saree|sari|kurta|lehenga|traditional|handloom$re$ THEN RETURN $v$Apparel & Fashion|Ethnic Wear$v$; END IF;
  IF t ~* $re$kid|child|baby cloth|infant|toddler$re$ THEN RETURN $v$Apparel & Fashion|Kids' Clothing$v$; END IF;
  IF t ~* $re$women|ladies|female|maternity|dress$re$ THEN RETURN $v$Apparel & Fashion|Women's Clothing$v$; END IF;
  IF t ~* $re$men's|mens|menswear|menwear|male$re$ THEN RETURN $v$Apparel & Fashion|Men's Clothing$v$; END IF;
  IF t ~* $re$accessor|scarf|scarves|belts?([^a-z]|$)|(^|[^a-z])(caps|hats|socks)([^a-z]|$)$re$ THEN RETURN $v$Apparel & Fashion|Accessories$v$; END IF;
  IF t ~* $re$apparel|fashion|cloth|garment|textile|wear|t-?shirt|denim|streetwear|lifestyle|merch$re$ THEN RETURN $v$Apparel & Fashion|General Apparel$v$; END IF;
  IF t ~* $re$coffee|(^|[^a-z])teas?([^a-z]|$)|juice|wine|beer|spirits|alcohol|liquor|kombucha|soda|soft drink|energy drink|/beverages|/drinks|\|\s*beverages|\|\s*drinks$re$ THEN RETURN $v$Food & Beverage|Beverages$v$; END IF;
  IF t ~* $re$snack|chocolate|confection|sweet|bakery|dessert|namkeen|biscuit|chips$re$ THEN RETURN $v$Food & Beverage|Snacks & Packaged Food$v$; END IF;
  IF t ~* $re$grocer|staple|spice|masala|oil|ghee|dairy|organic food|farm|honey|dry fruit|nut$re$ THEN RETURN $v$Food & Beverage|Groceries & Staples$v$; END IF;
  IF t ~* $re$restaurant|food (and|&) beverage services|catering|cafe|cloud kitchen$re$ THEN RETURN $v$Food & Beverage|Restaurants & Food Services$v$; END IF;
  IF t ~* $re$food|f&b|fmcg|edible|meal$re$ THEN RETURN $v$Food & Beverage|General Food$v$; END IF;
  IF t ~* $re$kitchen|cookware|dining|tableware|appliance$re$ THEN RETURN $v$Home & Living|Kitchen & Dining$v$; END IF;
  IF t ~* $re$furniture|mattress|sofa|bedding|(^|[^a-z])beds?([^a-z]|$)$re$ THEN RETURN $v$Home & Living|Furniture$v$; END IF;
  IF t ~* $re$decor|interior|furnishing|lighting|candle|art & decor|wall$re$ THEN RETURN $v$Home & Living|Home Decor$v$; END IF;
  IF t ~* $re$gardening|garden (supplies|tools|decor)|(^|[^a-z])plants?([^a-z]|$)|planter|lawn|yard & patio|outdoor living$re$ THEN RETURN $v$Home & Living|Garden & Outdoor Living$v$; END IF;
  IF t ~* $re$home improvement|hardware|tools|building material|construction|plumbing|bath$re$ THEN RETURN $v$Home & Living|Home Improvement$v$; END IF;
  IF t ~* $re$home|living|household|cleaning$re$ THEN RETURN $v$Home & Living|General Home$v$; END IF;
  IF t ~* $re$audio|headphone|speaker|earphone|sound$re$ THEN RETURN $v$Electronics & Tech|Audio$v$; END IF;
  IF t ~* $re$mobile|phone|smartphone|charger|power bank|gadget$re$ THEN RETURN $v$Electronics & Tech|Mobile & Accessories$v$; END IF;
  IF t ~* $re$computer|laptop|information technology|it services|software|saas|internet|telecom|technology|tech$re$ THEN RETURN $v$Electronics & Tech|Computers & IT$v$; END IF;
  IF t ~* $re$electronic|electrical|appliance|camera|drone$re$ THEN RETURN $v$Electronics & Tech|Consumer Electronics$v$; END IF;
  IF t ~* $re$bike|bicycle|cycl|scooter|e-?bike$re$ THEN RETURN $v$Sports & Outdoors|Cycling & Mobility$v$; END IF;
  IF t ~* $re$outdoor|camping|hiking|adventure|safety & survival|fishing|hunting$re$ THEN RETURN $v$Sports & Outdoors|Outdoor & Adventure$v$; END IF;
  IF t ~* $re$sport|cricket|football|golf|tennis|badminton$re$ THEN RETURN $v$Sports & Outdoors|Sporting Goods$v$; END IF;
  IF t ~* $re$toy|game|hobb|puzzle$re$ THEN RETURN $v$Toys, Kids & Baby|Toys & Games$v$; END IF;
  IF t ~* $re$baby|kids|mom|parenting|maternity$re$ THEN RETURN $v$Toys, Kids & Baby|Baby & Kids$v$; END IF;
  IF t ~* $re$(^|[^a-z])pets?([^a-z]|$)|petcare|pet care|animal|(^|[^a-z])dogs?([^a-z]|$)|cat food$re$ THEN RETURN $v$Pets|Pet Supplies$v$; END IF;
  IF t ~* $re$wedding|bridal$re$ THEN RETURN $v$Gifts & Occasions|Weddings$v$; END IF;
  IF t ~* $re$gift|special event|holiday|seasonal|festive|party$re$ THEN RETURN $v$Gifts & Occasions|Gifts$v$; END IF;
  IF t ~* $re$book|literature|education|learning|school|jobs & education$re$ THEN RETURN $v$Arts, Books & Media|Books & Education$v$; END IF;
  IF t ~* $re$stationery|office supplies|paper$re$ THEN RETURN $v$Arts, Books & Media|Stationery & Office$v$; END IF;
  IF t ~* $re$(^|[^a-z])arts?([^a-z]|$)|craft|design|handmade|antique|collectible$re$ THEN RETURN $v$Arts, Books & Media|Arts & Crafts$v$; END IF;
  IF t ~* $re$music|entertainment|media|publishing|film|photograph$re$ THEN RETURN $v$Arts, Books & Media|Music & Entertainment$v$; END IF;
  IF t ~* $re$auto|vehicle|car |cars|motor|tyre|tire$re$ THEN RETURN $v$Automotive|Auto & Vehicles$v$; END IF;
  IF t ~* $re$chemical$re$ THEN RETURN $v$Business & Industrial|Chemicals$v$; END IF;
  IF t ~* $re$packag|container$re$ THEN RETURN $v$Business & Industrial|Packaging$v$; END IF;
  IF t ~* $re$machiner|engineering|industrial|mechanical|aerospace|aviation$re$ THEN RETURN $v$Business & Industrial|Machinery & Engineering$v$; END IF;
  IF t ~* $re$manufactur|production|plastic|metal|steel$re$ THEN RETURN $v$Business & Industrial|Manufacturing$v$; END IF;
  IF t ~* $re$wholesale|import|export|trading|distribut|b2b$re$ THEN RETURN $v$Business & Industrial|Wholesale & Trading$v$; END IF;
  IF t ~* $re$agri|farming|seed$re$ THEN RETURN $v$Business & Industrial|Agriculture$v$; END IF;
  IF t ~* $re$business$re$ THEN RETURN $v$Business & Industrial|General Business$v$; END IF;
  IF t ~* $re$logistic|courier|shipping|supply chain|delivery|freight|warehous$re$ THEN RETURN $v$Services|Logistics & Shipping$v$; END IF;
  IF t ~* $re$financ|bank|insurance|fintech|payment|invest$re$ THEN RETURN $v$Services|Finance & Insurance$v$; END IF;
  IF t ~* $re$marketing|advertis|agency$re$ THEN RETURN $v$Services|Marketing & Advertising$v$; END IF;
  IF t ~* $re$travel|hospitality|hotel|tourism$re$ THEN RETURN $v$Services|Travel & Hospitality$v$; END IF;
  IF t ~* $re$legal|consult|professional|staffing|recruit$re$ THEN RETURN $v$Services|Legal & Professional$v$; END IF;
  IF t ~* $re$service$re$ THEN RETURN $v$Services|Consumer Services$v$; END IF;
  IF t ~* $re$retail|e-?commerce|marketplace|store|shop|consumer goods|d2c$re$ THEN RETURN $v$Retail & Marketplaces|Retail & E-commerce$v$; END IF;
  IF t ~* $re$religio|belief|people & society|civic|social|non-?profit|ngo|spiritual$re$ THEN RETURN $v$Other|Society & Religion$v$; END IF;
  IF t ~* $re$science|research$re$ THEN RETURN $v$Other|Science & Research$v$; END IF;
  RETURN 'Other|Uncategorised';
END $fn$;

CREATE OR REPLACE FUNCTION radar_employee_bucket(p_count integer, p_range text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
-- Standard LinkedIn-style headcount bucket from employee_count, else the raw employee_range text
-- ("11-50", "10 - 50", "10K+", "10001-None", "5"…), using the range's UPPER bound.
DECLARE t text := lower(replace(COALESCE(p_range, ''), ',', '')); m text[]; n numeric;
BEGIN
  IF p_count IS NOT NULL AND p_count > 0 THEN n := p_count;
  ELSE
    m := regexp_match(t, '([0-9]+(\.[0-9]+)?)\s*(k?)\s*(-|–|to)\s*([0-9]+(\.[0-9]+)?)\s*(k?)');
    IF m IS NOT NULL THEN n := m[5]::numeric * CASE WHEN m[7] = 'k' THEN 1000 ELSE 1 END;
    ELSE
      m := regexp_match(t, '([0-9]+(\.[0-9]+)?)\s*(k?)');
      IF m IS NULL THEN RETURN NULL; END IF;
      n := m[1]::numeric * CASE WHEN m[3] = 'k' THEN 1000 ELSE 1 END;
      IF t LIKE '%+%' THEN n := n + 1; END IF;   -- "10K+" means more than 10,000
    END IF;
  END IF;
  IF n IS NULL OR n <= 0 THEN RETURN NULL; END IF;
  RETURN CASE WHEN n <= 10 THEN '1-10' WHEN n <= 50 THEN '11-50' WHEN n <= 200 THEN '51-200' WHEN n <= 500 THEN '201-500'
              WHEN n <= 1000 THEN '501-1,000' WHEN n <= 5000 THEN '1,001-5,000' WHEN n <= 10000 THEN '5,001-10,000' ELSE '10,001+' END;
END $fn$;

CREATE OR REPLACE FUNCTION radar_revenue_usd(p_range text, p_annual text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $fn$
-- Best-effort USD value from the mixed revenue formats ("₹1.2K", "5M - 10M", "₹50–100 Cr", "10M+", "1.5B").
-- ₹ / crore values convert at ₹95 = $1. Ranges use their lower bound. Unparseable -> NULL.
DECLARE t text := lower(replace(COALESCE(p_range, ''), ',', '')); m text[]; num numeric; mult numeric; inr boolean;
BEGIN
  IF p_annual ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND p_annual::numeric > 0 THEN RETURN p_annual::numeric; END IF;
  IF t = '' THEN RETURN NULL; END IF;
  inr := t LIKE '%₹%' OR t ~ '(^|[^a-z])cr([^a-z]|$)';
  m := regexp_match(t, '([0-9]+(\.[0-9]+)?)\s*(k|m|b|t|cr)?([^a-z]|$)');
  IF m IS NULL THEN RETURN NULL; END IF;
  num := m[1]::numeric;
  mult := CASE m[3] WHEN 'k' THEN 1e3 WHEN 'm' THEN 1e6 WHEN 'b' THEN 1e9 WHEN 't' THEN 1e12 WHEN 'cr' THEN 1e7 END;
  IF mult IS NULL THEN
    IF t ~ '(^|[^a-z])cr([^a-z]|$)' THEN mult := 1e7;                                  -- "₹50–100 Cr"
    ELSIF t ~ '[0-9.]+\s*(-|–|to)\s*[0-9.]+\s*m' THEN mult := 1e6;                     -- "5 - 10M"
    ELSIF num >= 1000 THEN mult := 1;                                                  -- raw amount
    ELSE RETURN NULL;                                                                  -- bare "5": unit unknown
    END IF;
  END IF;
  RETURN CASE WHEN inr THEN num * mult / 95 ELSE num * mult END;
END $fn$;

CREATE OR REPLACE FUNCTION radar_revenue_bucket(p_range text, p_annual text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN v IS NULL THEN NULL WHEN v < 1e6 THEN 'Under $1M' WHEN v < 1e7 THEN '$1M-$10M' WHEN v < 5e7 THEN '$10M-$50M'
              WHEN v < 1e8 THEN '$50M-$100M' WHEN v < 5e8 THEN '$100M-$500M' WHEN v < 1e9 THEN '$500M-$1B' ELSE '$1B+' END
  FROM (SELECT radar_revenue_usd(p_range, p_annual) AS v) x
$fn$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS industry_category text GENERATED ALWAYS AS (split_part(radar_industry_path(industry, sub_industry), '|', 1)) STORED,
  ADD COLUMN IF NOT EXISTS industry_subcategory text GENERATED ALWAYS AS (split_part(radar_industry_path(industry, sub_industry), '|', 2)) STORED,
  ADD COLUMN IF NOT EXISTS employee_bucket text GENERATED ALWAYS AS (radar_employee_bucket(employee_count, employee_range)) STORED,
  ADD COLUMN IF NOT EXISTS revenue_bucket text GENERATED ALWAYS AS (radar_revenue_bucket(revenue_range, annual_revenue)) STORED;
CREATE INDEX IF NOT EXISTS idx_accounts_industry_cat ON accounts (industry_category, industry_subcategory);
CREATE INDEX IF NOT EXISTS idx_accounts_employee_bucket ON accounts (employee_bucket);
CREATE INDEX IF NOT EXISTS idx_accounts_revenue_bucket ON accounts (revenue_bucket);

-- contacts_view: appended a.industry_category, a.industry_subcategory, a.employee_bucket, a.revenue_bucket (at the end).
