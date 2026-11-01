begin;
-- Payment allocations describe existing expenses. They never post money.
create table private.supply_payment_links (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null, venue_id uuid not null,
 document_id uuid not null references private.supply_documents(id) on delete restrict,
 transaction_id uuid not null references public.transactions(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 1 and 999999999999999),
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete restrict
);
create unique index supply_payment_pair on private.supply_payment_links(document_id,transaction_id) where deleted_at is null;
create index supply_payment_transaction on private.supply_payment_links(transaction_id) where deleted_at is null;
create index supply_payment_document on private.supply_payment_links(account_id,venue_id,document_id);
create index supply_payment_creator on private.supply_payment_links(created_by);
create table private.supply_payment_requests (
 id uuid primary key, account_id uuid not null, venue_id uuid not null,
 actor_id uuid not null, input jsonb not null, result jsonb not null,
 created_at timestamptz not null default now()
);
alter table private.supply_payment_links enable row level security;
alter table private.supply_payment_requests enable row level security;
revoke all on private.supply_payment_links,private.supply_payment_requests from public,anon,authenticated,service_role;

-- A changed/cancelled expense keeps its allocation history, but cannot prove payment.
create function private.supply_payment_summary(p_document uuid) returns jsonb
language sql stable set search_path='' as $$
 with doc as(select * from private.supply_documents where id=p_document),
 links as (
  select l.amount_cents,
   t.id is not null and t.deleted_at is null and t.type='expense' and t.currency='RUB'
   and t.account_id=d.account_id and t.venue_id=d.venue_id
   and (select sum(x.amount_cents) from private.supply_payment_links x where x.transaction_id=l.transaction_id and x.deleted_at is null)<=round(t.amount*100)::bigint valid
  from doc d join private.supply_payment_links l on l.document_id=d.id and l.deleted_at is null
  left join public.transactions t on t.id=l.transaction_id
 ), totals as(select coalesce(sum(amount_cents),0)::bigint allocated,coalesce(sum(amount_cents)filter(where valid),0)::bigint paid,coalesce(bool_or(not valid),false) invalid from links)
 select jsonb_build_object(
  'state',case when invalid or allocated>(d.data->>'amountCents')::bigint then 'review' when allocated=0 then 'unlinked' when allocated=(d.data->>'amountCents')::bigint then 'paid' else 'partial' end,
  'allocatedCents',allocated,'paidCents',case when invalid or allocated>(d.data->>'amountCents')::bigint then 0 else paid end,
  'remainingCents',case when invalid or allocated>(d.data->>'amountCents')::bigint then null else (d.data->>'amountCents')::bigint-paid end,
  'sourceMismatch',not invalid and allocated>0 and allocated=(d.data->>'amountCents')::bigint and not(d.data->>'paid')::boolean
 ) from doc d cross join totals
$$;
revoke all on function private.supply_payment_summary(uuid) from public,anon,authenticated,service_role;

create function public.supply_payment_candidates(p_venue uuid,p_document uuid,p_search text default '',p_page integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid:=private.supply_scope(p_venue); result jsonb;begin
 if p_search is null or length(p_search)>120 or p_page is null or p_page not between 0 and 100000 then raise exception 'Проверьте поиск платежей';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('supply-publish:'||p_venue,0));
 if not exists(select 1 from private.supply_documents where id=p_document and venue_id=p_venue and account_id=a) then raise exception 'Накладная недоступна';end if;
 with candidates as (
  select t.id,t.public_id,t.date,t.amount,round(t.amount*100)::bigint amount_cents,t.description,b.name bank,c.name counterparty,
   round(t.amount*100)::bigint-coalesce((select sum(l.amount_cents)from private.supply_payment_links l where l.transaction_id=t.id and l.deleted_at is null),0)::bigint available
  from public.transactions t join public.bank_accounts b on b.account_id=a and b.id=t.bank_account_id
  left join public.counterparties c on c.account_id=a and c.id=t.counterparty_id
  where t.account_id=a and t.venue_id=p_venue and t.type='expense' and t.currency='RUB' and t.deleted_at is null
   and(public.has_permission('finance.update_any_transaction')or(t.created_by=auth.uid()and public.has_permission('finance.update_transaction')))
   and not exists(select 1 from private.supply_payment_links l where l.document_id=p_document and l.transaction_id=t.id and l.deleted_at is null)
   and(p_search=''or position(lower(trim(p_search))in lower(coalesce(t.description,'')||' '||coalesce(c.name,'')||' '||t.public_id::text))>0)
 ), usable as(select *from candidates where available>0), ordered as(select *,row_number()over(order by date desc,id) rn from usable)
 select jsonb_build_object('total',(select count(*)from usable),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'publicId',public_id,'date',date,'amountCents',amount_cents,'availableCents',available,'description',description,'bank',bank,'counterparty',counterparty)order by rn)from ordered where rn>p_page*20 and rn<=(p_page+1)*20),'[]')) into result;
 return result;
end $$;
revoke all on function public.supply_payment_candidates(uuid,uuid,text,integer) from public,anon,service_role;
grant execute on function public.supply_payment_candidates(uuid,uuid,text,integer) to authenticated;

create function public.supply_set_payment(p_venue uuid,p_document uuid,p_transaction uuid,p_amount_cents bigint,p_revision integer,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid:=private.supply_scope(p_venue);t public.transactions;d private.supply_documents;l private.supply_payment_links;
 cached private.supply_payment_requests;body jsonb;result jsonb;other_tx bigint;other_doc bigint;actor text;action text;before_data jsonb;after_data jsonb;
begin
 if p_request is null or p_amount_cents is null or p_amount_cents not between 0 and 999999999999999 or p_revision is null or p_revision<1 or p_reason is null or length(trim(p_reason))not between 1 and 1000 then raise exception 'Укажите сумму и основание связи платежа';end if;
 perform pg_advisory_xact_lock(hashtextextended('supply-payment-request:'||p_request,0));
 -- Lock the expense before the publication lock: ordinary financial edits use this order too.
 select *into t from public.transactions where id=p_transaction and account_id=a for update;
 if t.id is null or not(public.has_permission('finance.update_any_transaction')or(t.created_by=auth.uid()and t.venue_id=p_venue and public.has_permission('finance.update_transaction'))) then raise exception 'Нет доступа к изменению связи платежа';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('supply-publish:'||p_venue,0));
 select *into d from private.supply_documents where id=p_document and account_id=a and venue_id=p_venue for update;
 if d.id is null then raise exception 'Накладная недоступна';end if;
 body:=jsonb_build_object('document',p_document,'transaction',p_transaction,'amountCents',p_amount_cents,'revision',p_revision,'reason',trim(p_reason));
 select *into cached from private.supply_payment_requests where id=p_request;
 if found then
  if cached.account_id<>a or cached.venue_id<>p_venue or cached.actor_id<>auth.uid() or cached.input<>body then raise exception 'Запрос уже использован для другого действия';end if;
  return cached.result;
 end if;
 if d.revision<>p_revision then raise exception 'Накладная изменилась. Обновите карточку';end if;
 select *into l from private.supply_payment_links where document_id=d.id and transaction_id=t.id and deleted_at is null;
 if p_amount_cents>0 then
  if t.venue_id is distinct from p_venue or t.deleted_at is not null or t.type<>'expense' or t.currency<>'RUB' then raise exception 'Выберите действующий рублёвый расход этого заведения';end if;
  if d.source_missing or not(d.data->>'processed')::boolean then raise exception 'Сначала проверьте накладную в Quick Resto';end if;
  select coalesce(sum(amount_cents),0)into other_tx from private.supply_payment_links where transaction_id=t.id and deleted_at is null and id is distinct from l.id;
  select coalesce(sum(amount_cents),0)into other_doc from private.supply_payment_links where document_id=d.id and deleted_at is null and id is distinct from l.id;
  if other_tx+p_amount_cents>round(t.amount*100)::bigint then raise exception 'Сумма превышает нераспределённую часть расхода';end if;
  if other_doc+p_amount_cents>(d.data->>'amountCents')::bigint then raise exception 'Сумма превышает остаток накладной';end if;
 elsif l.id is null then raise exception 'Связь платежа уже отсутствует';
 end if;
 if l.id is not null and l.amount_cents=p_amount_cents then raise exception 'Сумма связи не изменилась';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь')into actor from public.profiles where id=auth.uid();
 action:=case when p_amount_cents=0 then 'payment_unlinked' when l.id is null then 'payment_linked' else 'payment_updated' end;
 before_data:=case when l.id is null then null else jsonb_build_object('transactionId',t.id,'publicId',t.public_id,'amountCents',l.amount_cents)end;
 if p_amount_cents=0 then update private.supply_payment_links set deleted_at=now(),updated_at=now()where id=l.id;
 elsif l.id is null then insert into private.supply_payment_links(account_id,venue_id,document_id,transaction_id,amount_cents,created_by)values(a,p_venue,d.id,t.id,p_amount_cents,auth.uid());
 else update private.supply_payment_links set amount_cents=p_amount_cents,updated_at=now()where id=l.id;end if;
 after_data:=jsonb_build_object('transactionId',t.id,'publicId',t.public_id,'amountCents',p_amount_cents);
 update private.supply_documents set revision=revision+1,updated_at=now()where id=d.id;
 insert into private.supply_history(document_id,account_id,venue_id,revision,action,before_data,after_data,actor_name,reason)values(d.id,a,p_venue,d.revision+1,action,before_data,after_data,actor,trim(p_reason));
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)values(a,p_venue,auth.uid(),'finance.supply.'||action,'transaction',t.id,jsonb_build_object('number',d.data->>'number','invoiceId',d.id,'amountCents',p_amount_cents,'beforeCents',l.amount_cents,'reason',trim(p_reason)));
 result:=jsonb_build_object('revision',d.revision+1,'payment',private.supply_payment_summary(d.id));
 insert into private.supply_payment_requests(id,account_id,venue_id,actor_id,input,result)values(p_request,a,p_venue,auth.uid(),body,result);
 return result;
end $$;
revoke all on function public.supply_set_payment(uuid,uuid,uuid,bigint,integer,uuid,text) from public,anon,service_role;
grant execute on function public.supply_set_payment(uuid,uuid,uuid,bigint,integer,uuid,text) to authenticated;

create function private.supply_payment_transaction_changed()returns trigger language plpgsql security definer set search_path=''as $$
declare d private.supply_documents;actor text;begin
 if not exists(select 1 from private.supply_payment_links where transaction_id=new.id and deleted_at is null)then return new;end if;
 if row(new.amount,new.type,new.currency,new.venue_id,new.deleted_at,new.bank_account_id,new.date,new.description,new.counterparty_id) is not distinct from row(old.amount,old.type,old.currency,old.venue_id,old.deleted_at,old.bank_account_id,old.date,old.description,old.counterparty_id)then return new;end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь')into actor from public.profiles where id=auth.uid();
 for d in select x.*from private.supply_documents x where exists(select 1 from private.supply_payment_links l where l.document_id=x.id and l.transaction_id=new.id and l.deleted_at is null)order by x.venue_id,x.id loop
  perform pg_advisory_xact_lock_shared(hashtextextended('supply-publish:'||d.venue_id,0));
  update private.supply_documents set revision=revision+1,updated_at=now()where id=d.id returning *into d;
  insert into private.supply_history(document_id,account_id,venue_id,revision,action,before_data,after_data,actor_name,reason)values(d.id,d.account_id,d.venue_id,d.revision,'payment_changed',
   jsonb_build_object('publicId',old.public_id,'amountCents',round(old.amount*100),'cancelled',old.deleted_at is not null),
   case when new.account_id=d.account_id and new.venue_id=d.venue_id then jsonb_build_object('publicId',new.public_id,'amountCents',round(new.amount*100),'cancelled',new.deleted_at is not null)else jsonb_build_object('publicId',old.public_id,'unavailable',true)end,
   coalesce(actor,'Система'),'Связанный расход изменён. Состояние оплаты пересчитано.');
 end loop;
 return new;
end $$;
revoke all on function private.supply_payment_transaction_changed()from public,anon,authenticated,service_role;
create trigger supply_payment_transaction_changed after update on public.transactions for each row execute function private.supply_payment_transaction_changed();

create or replace function public.supply_detail(p_venue uuid,p_document uuid,p_before bigint default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid:=private.supply_scope(p_venue);d private.supply_documents;history jsonb;payments jsonb;begin
 perform pg_advisory_xact_lock_shared(hashtextextended('supply-publish:'||p_venue,0));
 select *into d from private.supply_documents where account_id=a and venue_id=p_venue and id=p_document;if not found then raise exception 'Накладная недоступна';end if;
 select coalesce(jsonb_agg(to_jsonb(h)order by id desc),'[]')into history from(select id,revision,action,before_data,after_data,actor_name,reason,created_at from private.supply_history where document_id=d.id and account_id=a and venue_id=p_venue and(p_before is null or id<p_before)order by id desc limit 21)h;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'transactionId',t.id,'publicId',t.public_id,'amountCents',l.amount_cents,'transactionCents',round(t.amount*100),'date',t.date,'bank',b.name,'description',t.description,'cancelled',t.deleted_at is not null,'unavailable',t.id is null,'canManage',public.has_permission('finance.update_any_transaction')or(t.created_by=auth.uid()and public.has_permission('finance.update_transaction')),'reference',l.transaction_id)order by l.created_at,l.id),'[]')into payments
 from private.supply_payment_links l left join public.transactions t on t.id=l.transaction_id and t.account_id=a and t.venue_id=p_venue
 left join public.bank_accounts b on b.id=t.bank_account_id and b.account_id=a where l.document_id=d.id and l.deleted_at is null;
 return jsonb_build_object('id',d.id,'revision',d.revision,'data',d.data,'missing',d.source_missing,'history',history,'payment',private.supply_payment_summary(d.id),'payments',payments,'canLink',public.has_permission('finance.update_any_transaction')or public.has_permission('finance.update_transaction'));
end $$;
create or replace function public.supply_list(p_venue uuid,p_from date,p_to date,p_search text default '',p_paid text default '',p_provider bigint default null,p_store bigint default null,p_missing boolean default false,p_page integer default 0,p_size integer default 25,p_sort text default 'date',p_desc boolean default true)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid:=private.supply_scope(p_venue);result jsonb;providers jsonb;stores jsonb;source private.supply_sources;j private.supply_jobs;begin
 perform pg_advisory_xact_lock_shared(hashtextextended('supply-publish:'||p_venue,0));
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 or length(p_search)>120 or p_paid not in('','paid','unpaid','draft','review')or p_page not between 0 and 100000 or p_size not in(25,50,100)or p_sort not in('date','number','provider','amount','paid')then raise exception 'Проверьте фильтры поставок';end if;
 with selected as(
 select d.*,private.supply_payment_summary(d.id) payment from private.supply_documents d where d.account_id=a and d.venue_id=p_venue and (p_missing or not d.source_missing) and(d.data->>'invoiceDate')::date between p_from and p_to and(p_search=''or position(lower(trim(p_search))in lower(coalesce(d.data->>'number','')||' '||coalesce(d.data->>'providerName','')))>0)and(p_provider is null or(d.data->>'providerId')::bigint=p_provider)and(p_store is null or(d.data->>'storeId')::bigint=p_store)and(p_paid=''or(p_paid='paid'and private.supply_payment_summary(d.id)->>'state'='paid')or(p_paid='unpaid'and private.supply_payment_summary(d.id)->>'state'in('unlinked','partial'))or(p_paid='draft'and not(d.data->>'processed')::boolean)or(p_paid='review'and(jsonb_array_length(d.data->'issues')>0 or private.supply_payment_summary(d.id)->>'state'='review' or (private.supply_payment_summary(d.id)->>'sourceMismatch')::boolean)))
 ),ordered as(select *,row_number()over(order by
 case when not p_desc and p_sort='date'then data->>'invoiceAt'end asc nulls last,case when p_desc and p_sort='date'then data->>'invoiceAt'end desc nulls last,
 case when not p_desc and p_sort='number'then lower(data->>'number')end asc nulls last,case when p_desc and p_sort='number'then lower(data->>'number')end desc nulls last,
 case when not p_desc and p_sort='provider'then lower(data->>'providerName')end asc nulls last,case when p_desc and p_sort='provider'then lower(data->>'providerName')end desc nulls last,
 case when not p_desc and p_sort='amount'then(data->>'amountCents')::bigint end asc nulls last,case when p_desc and p_sort='amount'then(data->>'amountCents')::bigint end desc nulls last,
 case when not p_desc and p_sort='paid'then payment->>'state' end asc nulls last,case when p_desc and p_sort='paid'then payment->>'state' end desc nulls last,id)rn from selected)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'data',data,'missing',source_missing,'payment',payment)order by rn)from ordered where rn>p_page*p_size and rn<=(p_page+1)*p_size),'[]'::jsonb),'total',(select count(*)from selected),'amountCents',(select coalesce(sum((data->>'amountCents')::bigint),0)from selected),'paidCents',(select coalesce(sum((payment->>'paidCents')::bigint),0)from selected),'unpaidCents',(select coalesce(sum((payment->>'remainingCents')::bigint),0)from selected),'reviewCount',(select count(*)from selected where payment->>'state'='review'))into result;
 select coalesce(jsonb_agg(x order by x->>'name'),'[]')into providers from(select distinct jsonb_build_object('id',(data->>'providerId')::bigint,'name',coalesce(data->>'providerName','Поставщик №'||(data->>'providerId')))x from private.supply_documents where account_id=a and venue_id=p_venue and data->>'providerId'is not null)s;
 select coalesce(jsonb_agg(x order by x->>'name'),'[]')into stores from(select distinct jsonb_build_object('id',(data->>'storeId')::bigint,'name',data->>'storeTitle')x from private.supply_documents where account_id=a and venue_id=p_venue)s;
 select *into source from private.supply_sources where account_id=a and venue_id=p_venue;select *into j from private.supply_jobs where account_id=a and venue_id=p_venue order by created_at desc,id desc limit 1;
 return result||jsonb_build_object('venueId',p_venue,'providers',providers,'stores',stores,'canConfigure',public.is_account_owner(a),'configured',exists(select 1 from private.supply_read_rules where venue_id=p_venue),'months',coalesce((select jsonb_agg(period_key order by period_key)from(select distinct left(data->>'invoiceDate',7)as period_key from private.supply_documents where account_id=a and venue_id=p_venue and not source_missing)periods),'[]'::jsonb),'timezone',coalesce((select timezone from public.sales_settings where venue_id=p_venue),'Europe/Moscow'),'checkedAt',source.checked_at,'sourceVersion',source.version,'job',case when j.id is null then null else jsonb_build_object('state',j.state,'phase',j.phase,'cursor',j.cursor,'error',j.last_error)end);
end $$;
commit;
