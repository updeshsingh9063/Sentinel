-- Demo seed. Loaded after the migrations by docker compose.
--
-- Deliberately tiny: the real cohort comes from scripts/generate_cohort.py so
-- it is reproducible and documented. This exists only so the four frontend
-- surfaces have something to render before the generator lands.

-- Seed users are created through Supabase Auth, not here, because app_users
-- references auth.users. See docs/ARCHITECTURE.md for the demo account setup.

insert into seniors (display_name, age, sex, city, language) values
  ('Senior A', 72, 'female', 'Pune',      'hi'),
  ('Senior B', 68, 'male',   'Jaipur',    'hi'),
  ('Senior C', 81, 'female', 'Kochi',     'en'),
  ('Senior D', 75, 'male',   'Lucknow',   'hi');

-- Consent defaults to absent, not granted. A family summary is unreadable
-- until someone records consent explicitly.
