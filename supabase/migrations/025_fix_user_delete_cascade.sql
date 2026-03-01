-- Allow deleting users from Supabase Studio without FK conflicts.
-- Previously accounts.owner_id and invitations.invited_by were RESTRICT,
-- which blocked auth.users deletion. We change them to CASCADE / SET NULL.

-- accounts.owner_id: CASCADE → deleting a user deletes their accounts
--   (accounts → venues → user_venue_roles, invitations, roles, etc. already CASCADE)
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_owner_id_fkey,
  ADD CONSTRAINT accounts_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- invitations.invited_by: SET NULL → keeps invitation records, clears the inviter ref
ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_invited_by_fkey,
  ADD CONSTRAINT invitations_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
