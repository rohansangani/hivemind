-- (2026-11-08 later: contacts created by Enrich are sourced 'BlitzAPI'.)
-- Radar DB — Enrich "use Radar first": people reused from existing Radar contacts + ISO country codes saved as names. Applied 2026-11-08.
-- Pipeline code: src/lib/radar/enrichPipeline.ts (phase "reuse").

ALTER TABLE enrich2_people ADD COLUMN IF NOT EXISTS from_radar boolean NOT NULL DEFAULT false;

-- ISO-2 code → the country name Radar stores everywhere else ("IN" → "India"); names pass through unchanged.
CREATE OR REPLACE FUNCTION public.country_name(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT COALESCE((SELECT n FROM (VALUES
  ('AD','Andorra'),
  ('AE','United Arab Emirates'),
  ('AF','Afghanistan'),
  ('AG','Antigua and Barbuda'),
  ('AI','Anguilla'),
  ('AL','Albania'),
  ('AM','Armenia'),
  ('AO','Angola'),
  ('AQ','Antarctica'),
  ('AR','Argentina'),
  ('AS','American Samoa'),
  ('AT','Austria'),
  ('AU','Australia'),
  ('AW','Aruba'),
  ('AX','Åland Islands'),
  ('AZ','Azerbaijan'),
  ('BA','Bosnia and Herzegovina'),
  ('BB','Barbados'),
  ('BD','Bangladesh'),
  ('BE','Belgium'),
  ('BF','Burkina Faso'),
  ('BG','Bulgaria'),
  ('BH','Bahrain'),
  ('BI','Burundi'),
  ('BJ','Benin'),
  ('BL','Saint Barthélemy'),
  ('BM','Bermuda'),
  ('BN','Brunei'),
  ('BO','Bolivia'),
  ('BQ','Caribbean Netherlands'),
  ('BR','Brazil'),
  ('BS','Bahamas'),
  ('BT','Bhutan'),
  ('BV','Bouvet Island'),
  ('BW','Botswana'),
  ('BY','Belarus'),
  ('BZ','Belize'),
  ('CA','Canada'),
  ('CC','Cocos (Keeling) Islands'),
  ('CD','Congo (DRC)'),
  ('CF','Central African Republic'),
  ('CG','Congo'),
  ('CH','Switzerland'),
  ('CI','Côte d''Ivoire'),
  ('CK','Cook Islands'),
  ('CL','Chile'),
  ('CM','Cameroon'),
  ('CN','China'),
  ('CO','Colombia'),
  ('CR','Costa Rica'),
  ('CU','Cuba'),
  ('CV','Cape Verde'),
  ('CW','Curaçao'),
  ('CX','Christmas Island'),
  ('CY','Cyprus'),
  ('CZ','Czech Republic'),
  ('DE','Germany'),
  ('DJ','Djibouti'),
  ('DK','Denmark'),
  ('DM','Dominica'),
  ('DO','Dominican Republic'),
  ('DZ','Algeria'),
  ('EC','Ecuador'),
  ('EE','Estonia'),
  ('EG','Egypt'),
  ('EH','Western Sahara'),
  ('ER','Eritrea'),
  ('ES','Spain'),
  ('ET','Ethiopia'),
  ('FI','Finland'),
  ('FJ','Fiji'),
  ('FK','Falkland Islands'),
  ('FM','Micronesia'),
  ('FO','Faroe Islands'),
  ('FR','France'),
  ('GA','Gabon'),
  ('GB','United Kingdom'),
  ('GD','Grenada'),
  ('GE','Georgia'),
  ('GF','French Guiana'),
  ('GG','Guernsey'),
  ('GH','Ghana'),
  ('GI','Gibraltar'),
  ('GL','Greenland'),
  ('GM','Gambia'),
  ('GN','Guinea'),
  ('GP','Guadeloupe'),
  ('GQ','Equatorial Guinea'),
  ('GR','Greece'),
  ('GS','South Georgia and the South Sandwich Islands'),
  ('GT','Guatemala'),
  ('GU','Guam'),
  ('GW','Guinea-Bissau'),
  ('GY','Guyana'),
  ('HK','Hong Kong'),
  ('HM','Heard Island and McDonald Islands'),
  ('HN','Honduras'),
  ('HR','Croatia'),
  ('HT','Haiti'),
  ('HU','Hungary'),
  ('ID','Indonesia'),
  ('IE','Ireland'),
  ('IL','Israel'),
  ('IM','Isle of Man'),
  ('IN','India'),
  ('IO','British Indian Ocean Territory'),
  ('IQ','Iraq'),
  ('IR','Iran'),
  ('IS','Iceland'),
  ('IT','Italy'),
  ('JE','Jersey'),
  ('JM','Jamaica'),
  ('JO','Jordan'),
  ('JP','Japan'),
  ('KE','Kenya'),
  ('KG','Kyrgyzstan'),
  ('KH','Cambodia'),
  ('KI','Kiribati'),
  ('KM','Comoros'),
  ('KN','Saint Kitts and Nevis'),
  ('KP','North Korea'),
  ('KR','South Korea'),
  ('KW','Kuwait'),
  ('KY','Cayman Islands'),
  ('KZ','Kazakhstan'),
  ('LA','Laos'),
  ('LB','Lebanon'),
  ('LC','Saint Lucia'),
  ('LI','Liechtenstein'),
  ('LK','Sri Lanka'),
  ('LR','Liberia'),
  ('LS','Lesotho'),
  ('LT','Lithuania'),
  ('LU','Luxembourg'),
  ('LV','Latvia'),
  ('LY','Libya'),
  ('MA','Morocco'),
  ('MC','Monaco'),
  ('MD','Moldova'),
  ('ME','Montenegro'),
  ('MF','Saint Martin'),
  ('MG','Madagascar'),
  ('MH','Marshall Islands'),
  ('MK','North Macedonia'),
  ('ML','Mali'),
  ('MM','Myanmar'),
  ('MN','Mongolia'),
  ('MO','Macau'),
  ('MP','Northern Mariana Islands'),
  ('MQ','Martinique'),
  ('MR','Mauritania'),
  ('MS','Montserrat'),
  ('MT','Malta'),
  ('MU','Mauritius'),
  ('MV','Maldives'),
  ('MW','Malawi'),
  ('MX','Mexico'),
  ('MY','Malaysia'),
  ('MZ','Mozambique'),
  ('NA','Namibia'),
  ('NC','New Caledonia'),
  ('NE','Niger'),
  ('NF','Norfolk Island'),
  ('NG','Nigeria'),
  ('NI','Nicaragua'),
  ('NL','Netherlands'),
  ('NO','Norway'),
  ('NP','Nepal'),
  ('NR','Nauru'),
  ('NU','Niue'),
  ('NZ','New Zealand'),
  ('OM','Oman'),
  ('PA','Panama'),
  ('PE','Peru'),
  ('PF','French Polynesia'),
  ('PG','Papua New Guinea'),
  ('PH','Philippines'),
  ('PK','Pakistan'),
  ('PL','Poland'),
  ('PM','Saint Pierre and Miquelon'),
  ('PR','Puerto Rico'),
  ('PS','Palestine'),
  ('PT','Portugal'),
  ('PW','Palau'),
  ('PY','Paraguay'),
  ('QA','Qatar'),
  ('RE','Réunion'),
  ('RO','Romania'),
  ('RS','Serbia'),
  ('RU','Russia'),
  ('RW','Rwanda'),
  ('SA','Saudi Arabia'),
  ('SB','Solomon Islands'),
  ('SC','Seychelles'),
  ('SD','Sudan'),
  ('SE','Sweden'),
  ('SG','Singapore'),
  ('SH','Saint Helena'),
  ('SI','Slovenia'),
  ('SK','Slovakia'),
  ('SL','Sierra Leone'),
  ('SM','San Marino'),
  ('SN','Senegal'),
  ('SO','Somalia'),
  ('SR','Suriname'),
  ('SS','South Sudan'),
  ('ST','São Tomé and Príncipe'),
  ('SV','El Salvador'),
  ('SX','Sint Maarten'),
  ('SY','Syria'),
  ('SZ','Eswatini'),
  ('TC','Turks and Caicos Islands'),
  ('TD','Chad'),
  ('TF','French Southern Territories'),
  ('TG','Togo'),
  ('TH','Thailand'),
  ('TJ','Tajikistan'),
  ('TL','Timor-Leste'),
  ('TM','Turkmenistan'),
  ('TN','Tunisia'),
  ('TO','Tonga'),
  ('TR','Türkiye'),
  ('TT','Trinidad and Tobago'),
  ('TV','Tuvalu'),
  ('TW','Taiwan'),
  ('TZ','Tanzania'),
  ('UA','Ukraine'),
  ('UG','Uganda'),
  ('UM','U.S. Minor Outlying Islands'),
  ('US','United States'),
  ('UY','Uruguay'),
  ('UZ','Uzbekistan'),
  ('VA','Vatican City'),
  ('VC','Saint Vincent and the Grenadines'),
  ('VE','Venezuela'),
  ('VG','British Virgin Islands'),
  ('VI','U.S. Virgin Islands'),
  ('VN','Vietnam'),
  ('VU','Vanuatu'),
  ('WF','Wallis and Futuna'),
  ('WS','Samoa'),
  ('XK','Kosovo'),
  ('YE','Yemen'),
  ('YT','Mayotte'),
  ('ZA','South Africa'),
  ('ZM','Zambia'),
  ('ZW','Zimbabwe'),
  ('ZZ','Unknown')
  ) AS t(c, n) WHERE t.c = upper(btrim(p)) AND length(btrim(p)) = 2), NULLIF(btrim(p), ''))
$f$;

-- save_enrich2_job: (1) a person reused from Radar carries contact_id → that exact contact is updated (blanks filled,
-- never re-dated if it already had a status); (2) country is saved as a name, not an ISO code.
CREATE OR REPLACE FUNCTION save_enrich2_job(p_job bigint) RETURNS TABLE(saved_contacts int, saved_accounts int)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_vert text; r enrich2_people%ROWTYPE; v_id uuid; v_acc uuid; v_li text; v_email text;
  n_c int := 0; n_a int := 0;
BEGIN
  SELECT vertical INTO v_vert FROM enrich2_jobs WHERE id = p_job;
  IF v_vert NOT IN ('B2B','D2C','US','Crossborder') THEN RAISE EXCEPTION 'job % has no valid vertical', p_job; END IF;

  INSERT INTO accounts (name, domain, vertical, linkedin_url, source)
  SELECT DISTINCT ON (c.domain) COALESCE(NULLIF(c.company_name,''), NULLIF(c.brand,''), c.domain), c.domain, v_vert, c.company_linkedin_url, 'Blitz Enrich'
  FROM enrich2_companies c
  WHERE c.job_id = p_job AND c.status <> 'from_radar' AND EXISTS (SELECT 1 FROM enrich2_people p WHERE p.company_id = c.id AND p.dropped_reason IS NULL)
  ON CONFLICT (domain, vertical) DO UPDATE SET
    linkedin_url = COALESCE(accounts.linkedin_url, EXCLUDED.linkedin_url),
    name = COALESCE(NULLIF(accounts.name,''), EXCLUDED.name);
  GET DIAGNOSTICS n_a = ROW_COUNT;

  FOR r IN SELECT * FROM enrich2_people WHERE job_id = p_job AND NOT saved AND dropped_reason IS NULL ORDER BY id LOOP
    v_id := r.contact_id;  -- reused from Radar → update that exact contact
    v_email := NULLIF(lower(btrim(COALESCE(r.email,''))), '');
    v_li := public.norm_li(NULLIF(r.linkedin_url,''));
    SELECT id INTO v_acc FROM accounts WHERE domain = r.domain AND vertical = v_vert LIMIT 1;
    IF v_id IS NULL AND v_email IS NOT NULL THEN
      SELECT id INTO v_id FROM contacts WHERE email = v_email AND vertical = v_vert LIMIT 1;
    END IF;
    IF v_id IS NULL AND v_li IS NOT NULL THEN
      SELECT id INTO v_id FROM contacts WHERE linkedin_url = v_li AND COALESCE(vertical,'') = v_vert LIMIT 1;
    END IF;

    IF v_id IS NOT NULL THEN
      BEGIN
        UPDATE contacts SET
          email = COALESCE(email, v_email),
          email_status = CASE WHEN r.from_radar AND COALESCE(email_status,'') <> '' THEN email_status WHEN v_email IS NOT NULL AND (email IS NULL OR email = v_email) AND r.final_status IS NOT NULL THEN r.final_status ELSE email_status END,
          validated_at = CASE WHEN r.from_radar AND COALESCE(email_status,'') <> '' THEN validated_at WHEN v_email IS NOT NULL AND (email IS NULL OR email = v_email) AND r.final_status IS NOT NULL THEN now() ELSE validated_at END,
          first_name = COALESCE(NULLIF(first_name,''), r.first_name),
          last_name = COALESCE(NULLIF(last_name,''), r.last_name),
          full_name = COALESCE(NULLIF(full_name,''), r.full_name),
          title = COALESCE(NULLIF(title,''), r.title),
          linkedin_url = COALESCE(NULLIF(linkedin_url,''), v_li),
          phone = COALESCE(NULLIF(phone,''), r.phone),
          company_name = COALESCE(NULLIF(company_name,''), r.company_name),
          domain = COALESCE(NULLIF(domain,''), r.domain),
          country = COALESCE(NULLIF(country,''), public.country_name(r.country_code)),
          location = COALESCE(NULLIF(location,''), r.city),
          account_id = COALESCE(account_id, v_acc)
        WHERE id = v_id;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    ELSE
      BEGIN
        INSERT INTO contacts (first_name, last_name, full_name, email, email_status, validated_at, title, linkedin_url, phone,
                              company_name, domain, country, location, vertical, account_id, source)
        VALUES (r.first_name, r.last_name, r.full_name, v_email, CASE WHEN v_email IS NOT NULL THEN r.final_status END,
                CASE WHEN v_email IS NOT NULL AND r.final_status IS NOT NULL THEN now() END, r.title, v_li, r.phone,
                r.company_name, r.domain, public.country_name(r.country_code), r.city, v_vert, v_acc, 'BlitzAPI')
        RETURNING id INTO v_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_id FROM contacts WHERE (v_email IS NOT NULL AND email = v_email AND vertical = v_vert)
           OR (v_li IS NOT NULL AND linkedin_url = v_li AND COALESCE(vertical,'') = v_vert) LIMIT 1;
      END;
    END IF;

    UPDATE enrich2_people SET saved = true, contact_id = v_id WHERE id = r.id;
    n_c := n_c + 1;
  END LOOP;

  RETURN QUERY SELECT n_c, n_a;
END $fn$;
