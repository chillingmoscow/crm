-- Правило автоисключения перестаёт перебивать решение проверяющего.
--
-- Что было. Строка акта хранила только факт «исключена из итогов», без ответа
-- на вопрос КЕМ. Импорт из Quick Resto применял активное правило безусловно:
--   exclusionRule ? {excluded_from_totals: true, ...} : {перенос старого состояния}
-- Поэтому «Учитывать в этом акте» жило ровно до следующего обновления данных —
-- проверяющий возвращал позицию в итоги, сумма росла, а любой импорт молча
-- откатывал её обратно. В журнале при этом ничего не появлялось: импорт событий
-- не пишет. Утверждали одно число, замораживали другое.
--
-- Вторая половина той же проблемы: снятие правила разисключало строку ТОЛЬКО в
-- текущем акте. В остальных актах позиция оставалась исключённой навсегда и уже
-- неотличимо от ручного решения — правила, которое её исключило, больше нет.
--
-- Что добавляем: происхождение исключения и явный отказ от правила.

alter table public.document_items
  add column if not exists exclusion_rule_id uuid,
  add column if not exists exclusion_rule_dismissed_at timestamptz;

comment on column public.document_items.exclusion_rule_id is
  'Правило автоисключения, которым исключена эта строка. NULL — исключено вручную или не исключено вовсе. Нужно, чтобы снятие правила разисключало ровно свои строки во всех актах.';
comment on column public.document_items.exclusion_rule_dismissed_at is
  'Проверяющий вернул строку в итоги («Учитывать в этом акте»), несмотря на активное правило. Импорт такую строку правилом больше не трогает — решение человека сильнее автоматики.';

-- Ссылка тенантная, по конвенции: (account_id, rule_id) → (account_id, id).
-- ON DELETE SET NULL по колонке — account_id NOT NULL (см. миграции 223, 230).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'document_items_exclusion_rule_tenant_fkey'
  ) then
    alter table public.document_items
      add constraint document_items_exclusion_rule_tenant_fkey
      foreign key (account_id, exclusion_rule_id)
      references public.inventory_result_exclusion_rules (account_id, id)
      on delete set null (exclusion_rule_id);
  end if;
end $$;

create index if not exists document_items_exclusion_rule_idx
  on public.document_items (account_id, exclusion_rule_id)
  where exclusion_rule_id is not null;

-- Бэкфилл: у строк, исключённых сейчас, проставляем правило, если оно активно и
-- подходит по ингредиенту или внешнему id позиции. Остальные исключения
-- считаем ручными — так и было задумано, просто это нигде не фиксировалось.
update public.document_items di
   set exclusion_rule_id = r.id
  from public.inventory_result_exclusion_rules r
 where r.account_id = di.account_id
   and r.status = 'active'
   and di.excluded_from_totals
   and di.exclusion_rule_id is null
   and (
     (r.ingredient_id is not null and r.ingredient_id = di.ingredient_id)
     or (r.ingredient_id is null and r.external_product_id is not null
         and r.external_product_id = di.external_product_id)
   );
