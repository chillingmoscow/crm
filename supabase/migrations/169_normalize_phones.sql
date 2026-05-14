-- 166_normalize_phones.sql
--
-- One-shot normalization of stored RU phone numbers into E.164
-- (`+7XXXXXXXXXX`). Going forward, the app writes phones in this
-- canonical form via the PhoneInput primitive (see
-- src/components/ui/phone-input.tsx + src/lib/format/phone.ts).
--
-- Scope: tables where users type their own phone via app forms.
--   - public.profiles  (личный телефон пользователя; редактируется на
--                       /profile и /people/staff/[id] — это одно и то
--                       же поле в БД, форма сотрудника пишет в профиль
--                       по userId)
--   - public.venues    (контактный телефон заведения, edited /org/venues)
--
-- Out of scope here (kept untouched, separate task):
--   - public.legal_entities  (DaData-sourced, formatting may vary by source)
--   - public.counterparties  (CRM partners — separate normalization sweep)
--
-- staff_account_details НЕ хранит phone — телефон сотрудника живёт в
-- profiles.phone (см. миграцию 132_staff_data_split.sql: tier-1+2
-- остались в profiles, в staff_account_details ушёл только tier-3
-- employment_date / medical_book_*).
--
-- Rows that don't yield a 10-digit RU subscriber stay unchanged; UI
-- falls back to raw value via formatPhoneDisplay's passthrough.

create or replace function pg_temp.normalize_ru_phone(p_input text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
  subscriber text;
begin
  if p_input is null then
    return null;
  end if;
  digits := regexp_replace(p_input, '\D', '', 'g');
  if digits = '' then
    return null;
  end if;
  if length(digits) = 11 and substr(digits, 1, 1) in ('7', '8') then
    subscriber := substr(digits, 2);
  elsif length(digits) = 10 then
    subscriber := digits;
  else
    return null;
  end if;
  if length(subscriber) <> 10 then
    return null;
  end if;
  return '+7' || subscriber;
end;
$$;

update public.profiles
set phone = pg_temp.normalize_ru_phone(phone)
where phone is not null
  and phone <> ''
  and pg_temp.normalize_ru_phone(phone) is not null
  and phone is distinct from pg_temp.normalize_ru_phone(phone);

update public.venues
set phone = pg_temp.normalize_ru_phone(phone)
where phone is not null
  and phone <> ''
  and pg_temp.normalize_ru_phone(phone) is not null
  and phone is distinct from pg_temp.normalize_ru_phone(phone);
