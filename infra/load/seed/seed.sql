\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'onemarketplace_load' THEN
    RAISE EXCEPTION 'seed.sql only runs against onemarketplace_load, not %', current_database();
  END IF;
END
$$;

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'onemarketplace_load' THEN
    RAISE EXCEPTION 'seed.sql only runs against onemarketplace_load, not %', current_database();
  END IF;
END
$$;

CREATE TEMP TABLE load_vocab (
  idx integer PRIMARY KEY,
  word text NOT NULL,
  freelancer_title text NOT NULL,
  country_code text NOT NULL,
  country_name text NOT NULL,
  city text NOT NULL
) ON COMMIT DROP;

INSERT INTO load_vocab (idx, word, freelancer_title, country_code, country_name, city) VALUES
  (0, 'react', 'React Frontend Developer', 'US', 'United States', 'New York'),
  (1, 'node', 'Node Backend Engineer', 'GB', 'United Kingdom', 'London'),
  (2, 'python', 'Python Developer', 'DE', 'Germany', 'Berlin'),
  (3, 'design', 'Product Design Specialist', 'IN', 'India', 'Bengaluru'),
  (4, 'marketing', 'Growth Marketing Consultant', 'CA', 'Canada', 'Toronto'),
  (5, 'data', 'Data Analyst', 'AU', 'Australia', 'Sydney'),
  (6, 'mobile', 'Mobile App Developer', 'BR', 'Brazil', 'Curitiba'),
  (7, 'devops', 'DevOps Engineer', 'PL', 'Poland', 'Warsaw');

INSERT INTO accounts (
  id, auth_id, email, display_name, role,
  "identityVerified", "paymentMethodVerified", "isOnboardingComplete",
  created_at, updated_at
)
SELECT
  md5('load-client-' || g)::uuid,
  'load-client-' || g,
  'load-client-' || g || '@load.test',
  'Load Client ' || g,
  'CLIENT',
  g % 3 <> 0,
  g % 4 <> 0,
  true,
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => g * 31100),
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => g * 31100)
FROM generate_series(1, 500) AS g
ON CONFLICT DO NOTHING;

INSERT INTO accounts (
  id, auth_id, email, display_name, role,
  "identityVerified", "paymentMethodVerified", "isOnboardingComplete",
  created_at, updated_at
)
SELECT
  md5('load-freelancer-' || g)::uuid,
  'load-freelancer-' || g,
  'load-freelancer-' || g || '@load.test',
  'Load Freelancer ' || g,
  'FREELANCER',
  g % 3 <> 0,
  g % 5 <> 0,
  true,
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => g * 3110),
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => g * 3110)
FROM generate_series(1, 5000) AS g
ON CONFLICT DO NOTHING;

INSERT INTO client_metadata (
  id, auth_id, role, company_name, company_website, company_size,
  industry, company_description, country, created_at, updated_at
)
SELECT
  md5('load-client-metadata-' || s.g)::uuid,
  'load-client-' || s.g,
  'Hiring manager',
  'Load ' || initcap(v.word) || ' Company ' || s.g,
  'https://load-client-' || s.g || '.example.com',
  (ARRAY['1-10', '11-50', '51-200', '201-500'])[(s.g % 4) + 1],
  'Technology',
  'Load test client hiring for ' || v.word || ' work.',
  v.country_code,
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => s.g * 31100),
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => s.g * 31100)
FROM generate_series(1, 500) AS s(g)
JOIN load_vocab v ON v.idx = s.g % 8
ON CONFLICT DO NOTHING;

INSERT INTO client_spents (
  id, client_id, total_spent_cents, completed_contracts, ongoing_contracts,
  review_count, rating, created_at, updated_at
)
SELECT
  md5('load-client-spents-' || g)::uuid,
  'load-client-' || g,
  ((g * 7919) % 500000) * 100,
  (g * 7) % 60,
  g % 5,
  (g * 5) % 50,
  round(3 + ((g * 13) % 201) / 100.0, 2),
  timestamptz '2026-06-01 00:00:00+00',
  timestamptz '2026-06-01 00:00:00+00'
FROM generate_series(1, 500) AS g
ON CONFLICT DO NOTHING;

INSERT INTO freelancer_metadata (
  id, auth_id, professional_title, professional_description, hourly_rate_cents,
  country, city, availability_status, weekly_availability, experience_level,
  skills, languages, search_text, location_text, created_at, updated_at
)
SELECT
  md5('load-freelancer-metadata-' || s.g)::uuid,
  'load-freelancer-' || s.g,
  v.freelancer_title,
  'Experienced ' || v.word || ' freelancer who also works on ' || v2.word || ' projects. Load profile ' || s.g || '.',
  (15 + (s.g * 37) % 186) * 100,
  v.country_code,
  v.city,
  CASE WHEN s.g % 4 = 0 THEN 'NOT_AVAILABLE' ELSE 'AVAILABLE' END,
  (ARRAY['Less than 30 hrs/week', 'More than 30 hrs/week', 'As needed'])[(s.g % 3) + 1],
  (ARRAY['Entry level', 'Intermediate', 'Expert'])[(s.g % 3) + 1],
  sk.skills,
  jsonb_build_array(jsonb_build_object('language', 'English', 'proficiency', 'Fluent')),
  lower(concat_ws(' ', 'Load Freelancer ' || s.g, v.freelancer_title, v.city, v.country_name, array_to_string(sk.skills, ' '))),
  lower(concat_ws(' ', v.city, v.country_name)),
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => s.g * 3110),
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => s.g * 3110)
FROM generate_series(1, 5000) AS s(g)
JOIN load_vocab v ON v.idx = s.g % 8
JOIN load_vocab v2 ON v2.idx = (s.g / 8) % 8
CROSS JOIN LATERAL (
  SELECT CASE WHEN v.word = v2.word THEN ARRAY[v.word] ELSE ARRAY[v.word, v2.word] END AS skills
) AS sk
ON CONFLICT DO NOTHING;

INSERT INTO freelancer_earning (
  id, freelancer_id, total_earning_cents, completed_jobs, ongoing_jobs,
  review_count, job_success_score, rating, created_at, updated_at
)
SELECT
  md5('load-freelancer-earning-' || g)::uuid,
  'load-freelancer-' || g,
  ((g * 7919) % 200000) * 100,
  (g * 7) % 120,
  g % 4,
  (g * 5) % 90,
  60 + (g * 17) % 41,
  round(3 + ((g * 13) % 201) / 100.0, 2),
  timestamptz '2026-06-01 00:00:00+00',
  timestamptz '2026-06-01 00:00:00+00'
FROM generate_series(1, 5000) AS g
ON CONFLICT DO NOTHING;

INSERT INTO agency_metadata (
  id, owner_id, name, professional_title, size, specialty, website, overview,
  tags, is_onboarded, search_text, created_at, updated_at
)
SELECT
  md5('load-agency-' || s.g)::uuid,
  'load-freelancer-' || s.g,
  a.name,
  a.title,
  (ARRAY['2–5 members', '6–10 members', '11–25 members', '26+ members'])[(s.g % 4) + 1],
  a.specialty,
  'https://load-agency-' || s.g || '.example.com',
  'Load agency ' || s.g || ' delivering ' || v.word || ' and ' || v2.word || ' projects for clients.',
  a.tags,
  true,
  lower(concat_ws(' ', a.name, a.title, a.specialty, array_to_string(a.tags, ' '))),
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => s.g * 15550),
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => s.g * 15550)
FROM generate_series(1, 1000) AS s(g)
JOIN load_vocab v ON v.idx = (s.g * 3) % 8
JOIN load_vocab v2 ON v2.idx = (s.g / 8) % 8
CROSS JOIN LATERAL (
  SELECT
    'Load ' || initcap(v.word) || ' Studio ' || s.g AS name,
    initcap(v.word) || ' and ' || v2.word || ' agency' AS title,
    (ARRAY['Web & software development', 'Design & creative', 'Data & AI', 'Marketing'])[(s.g % 4) + 1] AS specialty,
    CASE WHEN v.word = v2.word THEN ARRAY[v.word] ELSE ARRAY[v.word, v2.word] END AS tags
) AS a
ON CONFLICT DO NOTHING;

INSERT INTO agency_earning (
  id, agency_id, total_earning_cents, completed_jobs, ongoing_jobs,
  review_count, job_success_score, rating, created_at, updated_at
)
SELECT
  md5('load-agency-earning-' || g)::uuid,
  md5('load-agency-' || g)::uuid,
  ((g * 7919) % 900000) * 100,
  (g * 11) % 300,
  g % 6,
  (g * 7) % 150,
  70 + (g * 19) % 31,
  round(3.5 + ((g * 13) % 151) / 100.0, 2),
  timestamptz '2026-06-01 00:00:00+00',
  timestamptz '2026-06-01 00:00:00+00'
FROM generate_series(1, 1000) AS g
ON CONFLICT DO NOTHING;

INSERT INTO agency_members (id, agency_id, freelancer_id, role, created_at)
SELECT
  md5('load-agency-member-' || g)::uuid,
  md5('load-agency-' || g)::uuid,
  'load-freelancer-' || g,
  'Founder',
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => g * 15550)
FROM generate_series(1, 1000) AS g
ON CONFLICT DO NOTHING;

INSERT INTO agency_members (id, agency_id, freelancer_id, role, created_at)
SELECT
  md5('load-agency-member-' || g)::uuid,
  md5('load-agency-' || (((g - 1001) % 1000) + 1))::uuid,
  'load-freelancer-' || g,
  CASE WHEN g % 10 = 0 THEN 'Business manager' ELSE 'Agency member' END,
  timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => g * 3110)
FROM generate_series(1001, 3000) AS g
ON CONFLICT DO NOTHING;

INSERT INTO job_posts (
  id, client_id, title, description, expertise_level, expected_duration,
  skills, total_budget_cents, milestones, screening_questions, attachments,
  status, published_at, created_at, updated_at
)
SELECT
  md5('load-job-' || s.g)::uuid,
  'load-client-' || (((s.g - 1) % 500) + 1),
  initcap(v.word) || ' specialist needed for ' || v2.word || ' project ' || s.g,
  'We are looking for an experienced ' || v.word || ' freelancer to help with ' || v2.word || ' work. Load job ' || s.g || '.',
  (ARRAY['Entry level', 'Intermediate', 'Expert'])[(s.g % 3) + 1],
  (ARRAY['Less than 1 month', '1 to 3 months', '3 to 6 months', 'More than 6 months'])[(s.g % 4) + 1],
  CASE WHEN v.word = v2.word THEN ARRAY[v.word] ELSE ARRAY[v.word, v2.word] END,
  j.budget_cents,
  jsonb_build_array(jsonb_build_object(
    'id', 'load-milestone-' || s.g,
    'title', 'Milestone 1',
    'budgetCents', j.budget_cents,
    'dueDate', to_char(j.published_at + interval '30 days', 'YYYY-MM-DD')
  )),
  ARRAY[]::text[],
  '[]'::jsonb,
  'PUBLISHED',
  j.published_at,
  j.published_at - interval '1 hour',
  j.published_at
FROM generate_series(1, 10000) AS s(g)
JOIN load_vocab v ON v.idx = s.g % 8
JOIN load_vocab v2 ON v2.idx = (s.g / 8) % 8
CROSS JOIN LATERAL (
  SELECT
    ((s.g * 7919) % 996 + 5) * 1000 AS budget_cents,
    timestamptz '2026-06-01 00:00:00+00' - make_interval(secs => s.g * 1555) AS published_at
) AS j
ON CONFLICT DO NOTHING;

COMMIT;
