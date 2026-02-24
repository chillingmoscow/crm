-- ============================================================
-- 007_venue_delete_policy.sql
-- Политика удаления заведений для владельца аккаунта
-- ============================================================

create policy "venues_delete"
  on public.venues for delete
  using (
    exists (
      select 1 from public.accounts a
      where a.id = venues.account_id
        and a.owner_id = auth.uid()
    )
  );
