-- Add extra profile fields for employee onboarding
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender      text CHECK (gender IN ('male', 'female', 'other')),
  ADD COLUMN IF NOT EXISTS birth_date  date,
  ADD COLUMN IF NOT EXISTS telegram_id text,
  ADD COLUMN IF NOT EXISTS address     text;
