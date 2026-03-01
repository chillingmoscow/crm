-- Migration 027: restrict gender to male/female only (remove 'other')
-- First update any existing 'other' rows to NULL, then tighten the check

UPDATE profiles
SET gender = NULL
WHERE gender = 'other';

-- Drop old constraint and recreate with only two values
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_gender_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_gender_check
    CHECK (gender IN ('male', 'female'));
