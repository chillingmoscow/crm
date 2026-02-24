-- ============================================================
-- 008_fix_rls_recursion.sql
-- Исправление бесконечной рекурсии в RLS-политиках accounts/venues
--
-- Проблема:
--   accounts_select_staff -> JOIN venues -> venues_select_account_owner
--   -> EXISTS accounts -> accounts_select_staff -> ...
--
-- Решение:
--   Заменяем прямые запросы к accounts внутри venues-политик
--   на security definer функцию, которая обходит RLS.
-- ============================================================

-- Функция: проверяет, является ли текущий пользователь владельцем аккаунта
-- security definer = выполняется от имени postgres, обходит RLS на accounts
create or replace function public.is_account_owner(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.accounts
    where id = p_account_id
      and owner_id = auth.uid()
  );
$$;

-- ============================================================
-- venues — пересоздаём политики, использующие JOIN на accounts
-- ============================================================

drop policy if exists "venues_select_account_owner" on public.venues;
drop policy if exists "venues_insert"               on public.venues;
drop policy if exists "venues_delete"               on public.venues;

-- SELECT: владелец видит все заведения своего аккаунта
create policy "venues_select_account_owner"
  on public.venues for select
  using (public.is_account_owner(venues.account_id));

-- INSERT: только владелец аккаунта может добавлять заведения
create policy "venues_insert"
  on public.venues for insert
  with check (public.is_account_owner(venues.account_id));

-- DELETE: только владелец аккаунта может удалять заведения
create policy "venues_delete"
  on public.venues for delete
  using (public.is_account_owner(venues.account_id));
