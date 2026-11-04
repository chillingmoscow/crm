-- Виды цели правил исключений (миграция 310). Нужна локальная БД с seed.
-- Всё откатывается в конце.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/exclusion_rule_targets.sql
begin;

do $t$
declare
  a uuid := 'cccccccc-0000-0000-0000-000000000001';
  g uuid;
  ok boolean;
begin
  insert into public.ingredient_groups(account_id, external_id, name)
    values (a, 'ERT-QA-G1', 'ERT QA группа') returning id into g;

  -- 1. group без ingredient_group_id — падает.
  begin
    insert into public.inventory_result_exclusion_rules(account_id, target_kind, product_name)
      values (a, 'group', 'ERT QA');
    raise exception 'FAIL: group without ingredient_group_id was accepted';
  exception when check_violation then null; end;

  -- 2. group корректно — проходит; второй активный на ту же группу — падает.
  insert into public.inventory_result_exclusion_rules(account_id, target_kind, ingredient_group_id, product_name)
    values (a, 'group', g, 'ERT QA группа');
  begin
    insert into public.inventory_result_exclusion_rules(account_id, target_kind, ingredient_group_id, product_name)
      values (a, 'group', g, 'ERT QA группа 2');
    raise exception 'FAIL: duplicate active group rule was accepted';
  exception when unique_violation then null; end;

  -- 3. legacy_name с id — падает.
  begin
    insert into public.inventory_result_exclusion_rules(account_id, target_kind, ingredient_group_id, product_name)
      values (a, 'legacy_name', g, 'ERT QA legacy');
    raise exception 'FAIL: legacy_name with ids was accepted';
  exception when check_violation then null; end;

  -- 4. legacy_name без id — проходит; дубль по lower(name) — падает.
  insert into public.inventory_result_exclusion_rules(account_id, target_kind, product_name)
    values (a, 'legacy_name', 'ERT QA Legacy');
  begin
    insert into public.inventory_result_exclusion_rules(account_id, target_kind, product_name)
      values (a, 'legacy_name', 'ert qa legacy');
    raise exception 'FAIL: duplicate legacy_name was accepted';
  exception when unique_violation then null; end;

  -- 5. product без товара — падает.
  begin
    insert into public.inventory_result_exclusion_rules(account_id, product_name)
      values (a, 'ERT QA product');
    raise exception 'FAIL: product without ids was accepted';
  exception when check_violation then null; end;

  -- 6. удалённое правило не мешает новому активному.
  update public.inventory_result_exclusion_rules set status = 'deleted'
    where account_id = a and target_kind = 'group' and ingredient_group_id = g;
  insert into public.inventory_result_exclusion_rules(account_id, target_kind, ingredient_group_id, product_name)
    values (a, 'group', g, 'ERT QA группа');

  raise notice 'exclusion_rule_targets: OK';
end
$t$;

rollback;
