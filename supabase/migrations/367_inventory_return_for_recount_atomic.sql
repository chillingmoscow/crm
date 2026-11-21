-- «Вернуть на пересчёт» одной транзакцией.
--
-- Экшен returnDocumentForRecount читал статус акта, затем по одной строке
-- писал снимок «было» (recount_previous_amount), а в конце безусловно ставил
-- status = 'recount_pending'. Параллельное «Подвести итоги» между чтением и
-- записью давало акт на пересчёте с финализированными итогами, а сбой посреди
-- цикла — половину строк со снимком и акт в прежнем статусе.
--
-- Функция делает то же самое атомарно: блокирует строку акта (FOR UPDATE),
-- проверяет статус и финализацию, пишет снимок всем отмеченным строкам одним
-- UPDATE и переводит акт. Проигравший гонку получает outcome = 'changed'.
--
-- Снимок «было»: actual_amount, а если его нет — submitted_amount. Для
-- обычного акта actual_amount — это и есть сданное исполнителем число:
-- отправка акта не завершается, пока Quick Resto не подтвердил, что применил
-- значения (постусловие в submitInventoryDocumentDraft), а при проведении QR
-- сам фиксирует факт. Поэтому приоритет у actual_amount, и смысл снимка для
-- таких актов не меняется. Но у акта без расчёта Quick Resto (results_blocked)
-- actual_amount бывает null — тогда снимок пропадал вместе с «было → стало» и
-- фильтром «Был на пересчёте»; для них берём сохранённое у нас submitted_amount.
--
-- Проверяющий по умолчанию: тот, кто вернул акт, если поле пустое, — но не
-- исполнитель акта (исполнитель и проверяющий — разные люди).
--
-- Вызывает только сервер (admin-клиент, service_role) — права отзываются у
-- anon/authenticated явно (см. CLAUDE.md, прецедент 361). SECURITY INVOKER:
-- service_role и так обходит RLS, повышать права незачем.
--
-- Применять от supabase_admin, без `psql -1` (свои begin/commit).

begin;

create or replace function public.inventory_return_document_for_recount(
  p_account_id uuid,
  p_document_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_doc record;
  v_flagged uuid[];
  v_recount_count integer;
  v_reviewer_id uuid;
begin
  select d.id, d.status, d.results_finalized_at, d.recount_count, d.assigned_to, d.reviewer_id
    into v_doc
    from public.documents d
   where d.id = p_document_id
     and d.account_id = p_account_id
   for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_doc.results_finalized_at is not null
     or v_doc.status not in ('ready_for_review', 'results_blocked') then
    return jsonb_build_object('outcome', 'changed', 'status', v_doc.status);
  end if;

  select coalesce(array_agg(di.id order by di.sort_order, di.id), '{}'::uuid[])
    into v_flagged
    from public.document_items di
   where di.document_id = p_document_id
     and di.account_id = p_account_id
     and di.needs_recount;

  if cardinality(v_flagged) = 0 then
    return jsonb_build_object('outcome', 'no_flagged');
  end if;

  update public.document_items di
     set recount_previous_amount = coalesce(di.actual_amount, di.submitted_amount)
   where di.id = any (v_flagged)
     and di.account_id = p_account_id;

  v_recount_count := coalesce(v_doc.recount_count, 0) + 1;
  v_reviewer_id := coalesce(
    v_doc.reviewer_id,
    case when p_actor_id is distinct from v_doc.assigned_to then p_actor_id end
  );

  update public.documents d
     set status = 'recount_pending',
         recount_count = v_recount_count,
         last_returned_at = now(),
         reviewer_id = v_reviewer_id
   where d.id = p_document_id
     and d.account_id = p_account_id;

  return jsonb_build_object(
    'outcome', 'applied',
    'recount_count', v_recount_count,
    'flagged_item_ids', to_jsonb(v_flagged),
    'reviewer_id', v_reviewer_id
  );
end;
$fn$;

revoke all on function public.inventory_return_document_for_recount(uuid, uuid, uuid) from public;
revoke execute on function public.inventory_return_document_for_recount(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.inventory_return_document_for_recount(uuid, uuid, uuid) to service_role;

-- Проверяем результат, а не надеемся на него: от роли-не-владельца REVOKE
-- выдаёт только WARNING.
do $$
begin
  if has_function_privilege('anon', 'public.inventory_return_document_for_recount(uuid, uuid, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.inventory_return_document_for_recount(uuid, uuid, uuid)', 'EXECUTE')
  then
    raise exception 'inventory_return_document_for_recount доступна anon/authenticated: применяйте от supabase_admin';
  end if;
  if not has_function_privilege('service_role', 'public.inventory_return_document_for_recount(uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'inventory_return_document_for_recount недоступна service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
