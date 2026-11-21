-- ============================================================
-- 372_finance_rls_legal_entity_initplan.sql
--
-- transactions_select и bank_accounts_select вызывали
-- get_active_legal_entity_id() на КАЖДОЙ строке: в отличие от соседних
-- get_active_account_id() / has_permission(...), его не обернули в
-- (select ...), и Postgres не выносил вызов в InitPlan. Функция —
-- SECURITY DEFINER и делает два запроса (профиль + роль в заведении).
--
-- Замер на 50 000 операций: count(*) по таблице под RLS — 340 мс только на
-- эту проверку, а список «Транзакции» сканирует таблицу трижды (строки,
-- «N из M», число удалённых) — ~0,75–1,5 с на открытие страницы.
--
-- Смысл политик не меняется: тот же набор условий, что в 046, только
-- каждый вызов обёрнут в (select ...). Политики пересоздаются целиком,
-- а не правкой текста через replace(), поэтому разница в хранении
-- `auth.uid()` / `uid()` между локальной базой и продом здесь не важна.
-- ============================================================

begin;

alter policy "transactions_select" on public.transactions
  using (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_transactions'))
    and (
      deleted_at is null
      or (select public.has_permission('finance.delete_transaction'))
    )
  );

alter policy "bank_accounts_select" on public.bank_accounts
  using (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_bank_accounts'))
    and (
      deleted_at is null
      or (select public.has_permission('finance.manage_bank_accounts'))
    )
  );

-- От роли, которая не владеет таблицей, ALTER POLICY падает с ошибкой, но
-- проверяем и результат: голого вызова на строку остаться не должно.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and policyname in ('transactions_select', 'bank_accounts_select')
       and qual ~ '= (public\.)?get_active_legal_entity_id\(\)'
  ) then
    raise exception 'get_active_legal_entity_id() всё ещё вызывается на каждую строку';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and policyname in ('transactions_select', 'bank_accounts_select')) <> 2 then
    raise exception 'Политики transactions_select / bank_accounts_select не найдены';
  end if;
end $$;

commit;
