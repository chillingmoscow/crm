-- 170_normalize_counterparty_phones.sql
--
-- Продолжение миграции 169: нормализуем телефоны контрагентов
-- (CRM-партнёров) в E.164. Сама колонка `counterparties.phone`
-- создаётся в миграции 039_finance_counterparties.sql.
--
-- В скоупе 169 этого не было — теперь форма контрагента использует
-- общий <PhoneInput> с маской, новые записи приходят уже в E.164,
-- осталось пройтись по существующим.
--
-- legal_entities.phone — out of scope: телефон может приходить из
-- DaData в виде, который мы намеренно не трогаем (источник истины
-- внешний). При необходимости — отдельная миграция.

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

update public.counterparties
set phone = pg_temp.normalize_ru_phone(phone)
where phone is not null
  and phone <> ''
  and pg_temp.normalize_ru_phone(phone) is not null
  and phone is distinct from pg_temp.normalize_ru_phone(phone);
