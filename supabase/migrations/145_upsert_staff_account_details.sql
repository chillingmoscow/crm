-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 145_upsert_staff_account_details.sql
--
-- Atomic partial upsert для staff_account_details. Заменяет client-side
-- паттерн «UPDATE-first + fallback INSERT» который страдал от двух
-- проблем:
--
--   1. Race condition (Codex P2 на #260): когда строки ещё нет и две
--      вкладки одновременно сохраняют, обе видят `updated = null` и
--      обе пытаются INSERT — одна получает unique-violation и юзер
--      видит ошибку при первом сохранении HR-данных.
--
--   2. supabase-js `.upsert()` v2.48 при partial-данных дополняет
--      payload до full-row и проставляет null для отсутствующих
--      колонок — затирало другие поля при partial saves (мы ушли от
--      него к UPDATE+INSERT именно поэтому).
--
-- Решение: одно атомарное INSERT...ON CONFLICT DO UPDATE, где для
-- каждой колонки проверяем наличие ключа в jsonb-payload'е. Если ключа
-- нет — оставляем старое значение в ON CONFLICT branch'е (новые ряды
-- получают NULL/default). Это снимает оба ограничения.
--
-- security definer + явный permission check: повторяет RLS-политику
-- sad_insert_manage / sad_update_manage (account_id = active + право
-- people.edit_staff). Без этого можно было бы сохранить в чужой
-- аккаунт через service-role, что мы не хотим.
--
-- АВТОРИЗАЦИЯ: миграция 021 grant'ает execute на все routines в public
-- для anon, authenticated. Если бы мы пропускали auth-check при
-- auth.uid()=null (как было в первой версии этого файла), анонимный
-- caller мог бы написать в произвольный staff_account_details через
-- security-definer bypass RLS. Поэтому ниже — `raise exception` если
-- auth.uid() null (Codex P0 на #264). Дополнительно делаем revoke на
-- anon, чтобы grant из 021 не мог сам пробить (defense in depth).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.upsert_staff_account_details(
  p_account_id uuid,
  p_user_id    uuid,
  p_data       jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  -- Auth обязательна. Без auth.uid() это либо анон (которому миграция
  -- 021 дала grant execute на public.*), либо service-role. В обоих
  -- случаях security-definer + bypass RLS = дыра. Service-role-flow
  -- который реально хочет писать в чужой аккаунт должен пользоваться
  -- прямыми INSERT/UPDATE с явной RLS-bypass семантикой, не этой RPC.
  if v_caller is null then
    raise exception 'Не авторизован';
  end if;

  -- Тот же гард что в RLS: только active account + people.edit_staff.
  if p_account_id <> public.get_active_account_id() then
    raise exception 'Нет прав: account_id не совпадает с активным аккаунтом';
  end if;
  if not public.has_permission('people.edit_staff') then
    raise exception 'Нет права people.edit_staff';
  end if;

  insert into public.staff_account_details (
    account_id,
    user_id,
    employment_date,
    medical_book_number,
    medical_book_date,
    passport_photos,
    comment
  )
  values (
    p_account_id,
    p_user_id,
    -- Для новой строки: если ключа в payload'е нет → ставим NULL
    -- (default колонки). Если есть — приводим из jsonb к нужному типу.
    case when p_data ? 'employment_date'
         then nullif(p_data->>'employment_date','')::date
         else null end,
    case when p_data ? 'medical_book_number'
         then nullif(p_data->>'medical_book_number','')
         else null end,
    case when p_data ? 'medical_book_date'
         then nullif(p_data->>'medical_book_date','')::date
         else null end,
    -- passport_photos — это text[]; jsonb array → text[] через
    -- array(select jsonb_array_elements_text). При отсутствии ключа
    -- ставим пустой массив (это default колонки).
    case when p_data ? 'passport_photos'
         then array(select jsonb_array_elements_text(p_data->'passport_photos'))
         else array[]::text[] end,
    case when p_data ? 'comment'
         then nullif(p_data->>'comment','')
         else null end
  )
  on conflict (account_id, user_id) do update set
    -- Для существующей строки: если ключ есть в payload'е → перезаписываем,
    -- иначе оставляем старое значение (sad.column из существующей строки).
    -- Это и есть «atomic partial update»: один SQL, без race condition.
    employment_date = case
      when p_data ? 'employment_date'
      then nullif(p_data->>'employment_date','')::date
      else staff_account_details.employment_date end,
    medical_book_number = case
      when p_data ? 'medical_book_number'
      then nullif(p_data->>'medical_book_number','')
      else staff_account_details.medical_book_number end,
    medical_book_date = case
      when p_data ? 'medical_book_date'
      then nullif(p_data->>'medical_book_date','')::date
      else staff_account_details.medical_book_date end,
    passport_photos = case
      when p_data ? 'passport_photos'
      then array(select jsonb_array_elements_text(p_data->'passport_photos'))
      else staff_account_details.passport_photos end,
    comment = case
      when p_data ? 'comment'
      then nullif(p_data->>'comment','')
      else staff_account_details.comment end;
end;
$$;

-- Сначала revoke default-grant (миграция 021) для anon, чтобы анон
-- не мог вызвать RPC даже теоретически. Затем явно grant на
-- authenticated. Defense-in-depth: даже если auth-check внутри
-- функции бы пропускал null caller'а (был bug в первой версии — Codex
-- P0), сам call не достигал бы тела.
revoke execute on function public.upsert_staff_account_details(uuid, uuid, jsonb) from anon, public;
grant execute on function public.upsert_staff_account_details(uuid, uuid, jsonb) to authenticated;
