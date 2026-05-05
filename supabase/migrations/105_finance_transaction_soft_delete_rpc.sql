-- ============================================================
-- 105_finance_transaction_soft_delete_rpc.sql
-- Move transaction soft-delete / restore behind SECURITY DEFINER
-- functions so the effective permission is `finance.delete_transaction`,
-- not the generic UPDATE policy.
-- ============================================================

create or replace function public.finance_soft_delete_transaction(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_count      integer;
begin
  if v_uid is null then
    raise exception 'finance_soft_delete_transaction: не авторизован'
      using errcode = '28000';
  end if;

  if v_account_id is null then
    raise exception 'finance_soft_delete_transaction: нет активного account'
      using errcode = '28000';
  end if;

  if not public.has_permission('finance.delete_transaction') then
    raise exception 'finance_soft_delete_transaction: нет права finance.delete_transaction'
      using errcode = '42501';
  end if;

  update public.transactions
     set deleted_at = now(),
         deleted_by = v_uid
   where id = p_id
     and account_id = v_account_id
     and deleted_at is null
     and (
       legal_entity_id = public.get_active_legal_entity_id()
       or public.has_permission('finance.view_all_legal_entities')
     )
     and (
       venue_id is null
       or venue_id = public.get_active_venue_id()
       or public.has_permission('finance.view_all_venues')
     );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'finance_soft_delete_transaction: транзакция % не найдена / уже удалена', p_id
      using errcode = 'P0002';
  end if;

  return v_count;
end;
$$;

comment on function public.finance_soft_delete_transaction(uuid) is
  'Soft-deletes one transaction using finance.delete_transaction permission. '
  'SECURITY DEFINER bypasses update RLS, while preserving active account and visibility scope.';

grant execute on function public.finance_soft_delete_transaction(uuid) to authenticated;

create or replace function public.finance_restore_transaction(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_count      integer;
begin
  if v_uid is null then
    raise exception 'finance_restore_transaction: не авторизован'
      using errcode = '28000';
  end if;

  if v_account_id is null then
    raise exception 'finance_restore_transaction: нет активного account'
      using errcode = '28000';
  end if;

  if not public.has_permission('finance.delete_transaction') then
    raise exception 'finance_restore_transaction: нет права finance.delete_transaction'
      using errcode = '42501';
  end if;

  update public.transactions
     set deleted_at = null,
         deleted_by = null
   where id = p_id
     and account_id = v_account_id
     and deleted_at is not null
     and (
       legal_entity_id = public.get_active_legal_entity_id()
       or public.has_permission('finance.view_all_legal_entities')
     )
     and (
       venue_id is null
       or venue_id = public.get_active_venue_id()
       or public.has_permission('finance.view_all_venues')
     );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'finance_restore_transaction: транзакция % не найдена / не удалена', p_id
      using errcode = 'P0002';
  end if;

  return v_count;
end;
$$;

comment on function public.finance_restore_transaction(uuid) is
  'Restores one soft-deleted transaction using finance.delete_transaction permission. '
  'SECURITY DEFINER bypasses update RLS, while preserving active account and visibility scope.';

grant execute on function public.finance_restore_transaction(uuid) to authenticated;
