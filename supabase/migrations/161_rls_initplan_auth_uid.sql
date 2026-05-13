-- ============================================================
-- 161_rls_initplan_auth_uid.sql
--
-- Закрывает Supabase Advisor warning `auth_rls_initplan` (~49 policies).
-- Postgres переоценивает `auth.uid()` на каждой строке таблицы, даже
-- если это invariant в рамках одного запроса. Обёртка `(select auth.uid())`
-- хоистит вызов в InitPlan и считается один раз.
--
-- Семантика политик не меняется — это перформанс-патч.
--
-- Реализовано через DO-block: вытаскиваем актуальный текст qual/with_check
-- из pg_policies, делаем двойной replace (нормализация → обёртка) для
-- идемпотентности, ALTER POLICY с новым выражением.
-- ============================================================

do $migration$
declare
  r record;
  new_qual text;
  new_wc   text;
  sql      text;
  -- Список политик из advisor (tablename, policyname).
  targets text[][] := array[
    ['account_files','account_files_insert'],
    ['account_files','account_files_select'],
    ['accounts','accounts_insert_owner'],
    ['accounts','accounts_select_owner'],
    ['accounts','accounts_select_staff'],
    ['accounts','accounts_update_owner'],
    ['departments','dep_select_member'],
    ['email_change_requests','email_change_requests_select_own'],
    ['external_entity_links','external_entity_links_owner_insert'],
    ['external_entity_links','external_entity_links_owner_select'],
    ['external_entity_links','external_entity_links_owner_update'],
    ['hall_layouts','hall_layouts_insert'],
    ['hall_layouts','hall_layouts_select'],
    ['hall_layouts','hall_layouts_update'],
    ['integration_connections','integration_connections_owner_insert'],
    ['integration_connections','integration_connections_owner_select'],
    ['integration_connections','integration_connections_owner_update'],
    ['integration_external_snapshots','integration_external_snapshots_owner_insert'],
    ['integration_external_snapshots','integration_external_snapshots_owner_select'],
    ['integration_external_snapshots','integration_external_snapshots_owner_update'],
    ['integration_import_runs','integration_import_runs_owner_insert'],
    ['integration_import_runs','integration_import_runs_owner_select'],
    ['integration_import_runs','integration_import_runs_owner_update'],
    ['kb_collection_views','kb_collection_views_delete'],
    ['kb_collection_views','kb_collection_views_insert'],
    ['kb_collection_views','kb_collection_views_update'],
    ['kb_collections','kb_collections_insert'],
    ['kb_collections','kb_collections_update'],
    ['kb_comment_user_mentions','kb_comment_user_mentions_select_own'],
    ['kb_page_user_mentions','kb_page_user_mentions_select_own'],
    ['notifications','notifications_select_own'],
    ['notifications','notifications_update_own'],
    ['permissions','permissions_select_all'],
    ['profiles','profiles_insert_own'],
    ['profiles','profiles_select_own'],
    ['profiles','profiles_select_venue_staff'],
    ['profiles','profiles_update_own'],
    ['profiles','profiles_update_venue_staff'],
    ['role_permissions','role_permissions_select'],
    ['roles','roles_select_account'],
    ['roles','roles_select_system'],
    ['staff_account_details','sad_select_member'],
    ['transactions','transactions_update'],
    ['user_venue_roles','user_venue_roles_select_own'],
    ['venue_halls','venue_halls_delete'],
    ['venue_halls','venue_halls_insert'],
    ['venue_halls','venue_halls_select'],
    ['venue_halls','venue_halls_update'],
    ['venues','venues_select_member']
  ];
  i int;
  v_table text;
  v_policy text;
  v_found int := 0;
begin
  for i in 1 .. array_length(targets, 1) loop
    v_table  := targets[i][1];
    v_policy := targets[i][2];

    for r in
      select schemaname, tablename, policyname, cmd, qual, with_check
        from pg_policies
       where schemaname = 'public'
         and tablename  = v_table
         and policyname = v_policy
    loop
      v_found := v_found + 1;

      -- Двойной replace = идемпотентность. Сначала "разворачиваем"
      -- уже-обёрнутые вызовы обратно в auth.uid(), затем оборачиваем
      -- все auth.uid() в (select auth.uid()). Повторный прогон
      -- даст тот же результат.
      new_qual := case
        when r.qual is null then null
        else replace(
               replace(r.qual, '(SELECT auth.uid() AS uid)', 'auth.uid()'),
               'auth.uid()', '(select auth.uid())'
             )
      end;
      new_wc := case
        when r.with_check is null then null
        else replace(
               replace(r.with_check, '(SELECT auth.uid() AS uid)', 'auth.uid()'),
               'auth.uid()', '(select auth.uid())'
             )
      end;

      sql := 'alter policy ' || quote_ident(r.policyname)
          || ' on '  || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);

      if r.cmd in ('SELECT', 'DELETE') then
        sql := sql || ' using (' || new_qual || ')';
      elsif r.cmd = 'INSERT' then
        sql := sql || ' with check (' || new_wc || ')';
      else
        -- UPDATE / ALL — оба клауза при наличии.
        if r.qual is not null then
          sql := sql || ' using (' || new_qual || ')';
        end if;
        if r.with_check is not null then
          sql := sql || ' with check (' || new_wc || ')';
        end if;
      end if;

      execute sql;
    end loop;
  end loop;

  raise notice 'auth_rls_initplan: переписано % policies', v_found;
end
$migration$;
