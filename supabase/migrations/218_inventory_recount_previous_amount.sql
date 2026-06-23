-- Снимок фактического значения позиции на момент отправки на пересчёт.
-- Заполняется в returnDocumentForRecount для отмеченных строк (= их actual_amount
-- перед пересчётом). Переживает повторное проведение акта (cleanup recount-флагов
-- его НЕ трогает), поэтому служит и постоянной пометкой «строка была на
-- пересчёте», и зафиксированным «было», которое можно сравнить с новым фактом.
alter table public.document_items
  add column if not exists recount_previous_amount numeric;

comment on column public.document_items.recount_previous_amount is
  'Факт (actual_amount) на момент последней отправки строки на пересчёт. Для сравнения «было → стало» и постоянной пометки «была на пересчёте». Не очищается при повторном проведении.';
