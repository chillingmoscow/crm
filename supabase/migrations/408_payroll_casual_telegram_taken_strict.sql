-- 408: проверка «Telegram ID уже у другого сотрудника» (406) строже.
--
-- По замечаниям ревью безопасности к 406:
-- * ID в профиле сравниваем только по цифрам: «@ 123 456» в карточке и
--   «123456» в окне увольнения — один человек;
-- * профили берём по любой связи с заведениями аккаунта, не только по
--   действующей: бывшего сотрудника тоже не исключаем из чатов под видом
--   разового;
-- * две одновременные записи одного ID не проходят обе: функция берёт
--   транзакционную блокировку по (аккаунт, ID), и вторая запись видит первую.
-- Вызывающие функции (payroll_casual_set_telegram_id, payroll_casual_dismiss)
-- не меняются: сигнатура и смысл те же.
begin;

create or replace function private.payroll_casual_telegram_taken(p_account uuid, p_employee uuid, p_telegram_id text)
returns boolean language plpgsql volatile security definer
set search_path = public, pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('casual_telegram:' || p_account::text || ':' || p_telegram_id, 0));
  return exists(select 1 from public.payroll_employees x
                 where x.account_id = p_account and x.id <> p_employee and x.telegram_id = p_telegram_id
                   and (x.active or exists(select 1 from public.payroll_casual_dismissals d
                                            where d.employee_id = x.id and d.state <> 'complete')))
      or exists(select 1 from public.profiles p
                 where regexp_replace(coalesce(p.telegram_id, ''), '[^0-9]', '', 'g') = p_telegram_id
                   and exists(select 1 from public.user_venue_roles u
                                join public.venues v on v.id = u.venue_id
                               where u.user_id = p.id and v.account_id = p_account));
end $$;
revoke all on function private.payroll_casual_telegram_taken(uuid, uuid, text) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'private.payroll_casual_telegram_taken(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'private.payroll_casual_telegram_taken(uuid, uuid, text)', 'execute') then
    raise exception '408: проверка Telegram ID доступна пользователям';
  end if;
end $$;

commit;
