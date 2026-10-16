#!/usr/bin/env python3
"""One-shot, server-local Fees -> Sheerly migration.

Sources, generated plan, database snapshots and reports stay in --directory.
plan never mutates the database; apply requires the exact printed plan SHA256.
No provider API calls and no Quick Resto loyalty writes are made.
"""
import argparse
import collections
import datetime as dt
import decimal
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid
from zoneinfo import ZoneInfo

D = decimal.Decimal
NAMESPACE = uuid.UUID('77ac71e1-4e99-4fe1-83a2-2a689405f499')
CUTOFF = '2026-10-15'
START = '2026-06-01'
SOURCE_VENUE = 'U053tGTsSCKUtJebumKzWQ'
BANK_ALIASES = {
    'Кэшбокс - CHILLING': 46913, 'Сейф - CHILLING': 46914,
    'СБЕР - CHILLING': 112657, 'Точка Банк - CHILLING': 133134,
    'СберЧаевые - CHILLING': 165207, 'НетМонет - CHILLING': 165207,
    'Альфа Банк - Павел Андреевич О.': 219418,
}
EXCLUDED_BANKS = {'Сотрудники', 'Павел Оплочко', 'Депозит'}
TABLES = ['payroll_employees', 'payroll_accruals', 'payroll_adjustments',
          'payroll_payments', 'payroll_allocations', 'payroll_transfers',
          'payroll_settings', 'payroll_periods', 'payroll_events',
          'payroll_adjustment_comments', 'payroll_adjustment_history',
          'bank_accounts', 'legal_entities', 'bank_account_groups', 'finance_categories',
          'transactions', 'sales_days']


def uid(value):
    return str(uuid.uuid5(NAMESPACE, value))


def number(value):
    return D(str(value or '0').replace(' ', '').replace('\xa0', '').replace(',', '.'))


def truth(value):
    return str(value or '').lower() in ('true', 'истина', '1')


def day(value):
    if not value:
        return None
    text = str(value).strip()
    if text[4:5] == '-':
        return dt.date.fromisoformat(text[:10]).isoformat()
    return dt.datetime.strptime(text.split(' ')[0], '%d.%m.%Y').date().isoformat()


def timestamp(value, fallback=None):
    """Keep source instants; date-only data is midnight Moscow with explicit precision."""
    if not value:
        if fallback is None:
            return None
        value = fallback
    text = str(value).strip()
    if text[4:5] == '-' and ('T' in text or ' ' in text):
        parsed = dt.datetime.fromisoformat(text.replace('Z', '+00:00'))
    elif ' ' in text:
        parsed = dt.datetime.strptime(text, '%d.%m.%Y %H:%M:%S')
    else:
        parsed = dt.datetime.combine(dt.date.fromisoformat(day(text)), dt.time())
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo('Europe/Moscow'))
    return parsed.isoformat()


def rows(source, name):
    a = source['sheets'][name]
    return [dict(zip(a[0], list(r) + [None] * max(0, len(a[0]) - len(r))), sourceRow=i + 2)
            for i, r in enumerate(a[1:]) if any(v not in ('', None) for v in r)]


def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=lambda n: float(n) if isinstance(n, D) else str(n))


def save(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(value if isinstance(value, str) else dumps(value))


def sql(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float, D)):
        return str(value)
    if isinstance(value, (dict, list)):
        return "'" + dumps(value).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def insert(table, row, conflict=''):
    return 'insert into public.' + table + '(' + ','.join(row) + ') values(' + ','.join(map(sql, row.values())) + ')' + conflict + ';'


def update(table, row, where):
    return 'update public.' + table + ' set ' + ','.join(k + '=' + sql(v) for k, v in row.items()) + ' where ' + where + ';'


class Database:
    def __init__(self, args):
        self.args = args

    def query(self, query):
        # Error details may contain personal data. Keep them in a server-only file.
        p = subprocess.run(['docker', 'exec', '-i', self.args.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                            '-U', 'postgres', '-d', self.args.database], input=query.encode(), capture_output=True)
        if p.returncode:
            save(Path(self.args.directory) / ('error-' + self.args.database + '.log'), p.stderr.decode())
            raise RuntimeError('Database operation failed; inspect server-local error log')
        return p.stdout.decode().strip()

    def snapshot(self):
        parts = []
        for t in TABLES:
            predicate = 'account_id=' + sql(self.args.account)
            if t.startswith('payroll_') or t == 'sales_days':
                predicate += ' and venue_id=' + sql(self.args.venue)
            parts.extend([sql(t), "coalesce((select jsonb_agg(to_jsonb(t) order by id) from public." + t + ' t where ' + predicate + "),'[]'::jsonb)"
                          if t != 'payroll_settings' else "coalesce((select jsonb_agg(to_jsonb(t)) from public." + t + ' t where ' + predicate + "),'[]'::jsonb)"])
        parts.extend(["'actors'", "coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',trim(concat_ws(' ',p.first_name,p.last_name)))) from public.profiles p where p.id in (select user_id from public.user_venue_roles where venue_id=" + sql(self.args.venue) + ")),'[]'::jsonb)"])
        return json.loads(self.query('select jsonb_build_object(' + ','.join(parts) + ');'))


def state_query(args):
    parts = []
    for table in TABLES:
        if table in ('payroll_events', 'payroll_adjustment_history', 'payroll_adjustment_comments', 'sales_days'):
            continue
        where = 'account_id=' + sql(args.account)
        if table.startswith('payroll_'):
            where += ' and venue_id=' + sql(args.venue)
        if table in ('payroll_accruals', 'payroll_adjustments'):
            where += ' and business_date<=' + sql(CUTOFF)
        order = '' if table == 'payroll_settings' else ' order by id'
        parts.extend([sql(table), "coalesce((select jsonb_agg(to_jsonb(t)" + order + ') from public.' + table + ' t where ' + where + "),'[]'::jsonb)"])
    return 'select md5(jsonb_build_object(' + ','.join(parts) + ')::text)'


def fingerprint(snapshot):
    """Only the historical records this import replaces; ongoing new-day sync is independent."""
    result = {}
    for table in TABLES:
        if table in ('payroll_events', 'payroll_adjustment_history', 'payroll_adjustment_comments', 'sales_days'):
            continue
        r = snapshot[table]
        if table in ('payroll_accruals', 'payroll_adjustments'):
            r = [x for x in r if x['business_date'] <= CUTOFF]
        result[table] = r
    return hashlib.sha256(dumps(result).encode()).hexdigest()


def build(args, before, source, bank_source):
    a, v, owner = args.account, args.venue, args.owner
    scoped = {'account_id': a, 'venue_id': v}
    events = []
    statements = []
    insertions = collections.Counter()
    employees = collections.defaultdict(list)
    for e in before['payroll_employees']:
        employees[e['name']].append(e)

    def employee(name):
        assert len(employees[name]) == 1, 'Employee must match exactly once: ' + str(name)
        return employees[name][0]

    actors = {x['name']: x['id'] for x in before['actors']}
    source_names = {e['Row ID']: e['Имя Фамилия'] for e in source['employees']}

    def actor(name):
        return actors.get(str(name).strip())

    def emit(table, record, conflict=''):
        statements.append(insert(table, record, conflict))
        insertions[table] += 1

    def event(key, action, entity, details, emp=None):
        record = dict(id=uid('event:' + key), **scoped, employee_id=emp, entity_id=entity,
                      action=action, actor_id=owner, details=details)
        events.append(record)

    # Accounts share one legal entity, preserving both source aliases in the import manifest.
    banks = bank_source['accounts']
    assert len(banks) == 44 and not any(b['name'] in EXCLUDED_BANKS for b in banks)
    legal = next(b['legalEntity'] for b in banks if b['legalEntity']['id'] == 111153)
    assert all(b['legalEntity']['inn'] == legal['inn'] for b in banks)
    matches = [r for r in before['legal_entities'] if r['inn'] == legal['inn']]
    assert len(matches) <= 1, 'Several server legal entities have the source INN'
    le = matches[0]['id'] if matches else uid('adesk:legal:111153')
    le_data = dict(name='ООО «ЧИЛИНГ»', short_name='ООО «ЧИЛИНГ»', legal_form='OOO', adesk_id=111153)
    if not matches:
        emit('legal_entities', dict(id=le, account_id=a, inn=legal['inn'], kpp=legal.get('kpp') or None,
                                   legal_address=legal.get('address') or None, created_by=owner, **le_data))
    else:
        statements.append(update('legal_entities', le_data, 'id=' + sql(le)))
    bank_ids = {}
    bank_groups = {}
    # Actual observed Adesk account-read instant (execution 15031), not a guessed midnight.
    anchor = dt.datetime.fromtimestamp(1792147967925 / 1000, dt.timezone.utc).isoformat()
    for b in banks:
        key = uid('adesk:bank:' + str(b['id']))
        bank_ids[b['id']] = key
        assert not any(r['adesk_id'] == b['id'] for r in before['bank_accounts']), 'Adesk account already imported'
        category = b.get('category') or {}
        group = None
        if category.get('id'):
            group = uid('adesk:bank-group:' + str(category['id']))
            if group not in bank_groups:
                bank_groups[group] = category
                emit('bank_account_groups', dict(id=group, account_id=a, name=category['name']), ' on conflict(id) do nothing')
        typ = ('safe' if 'сейф' in b['name'].lower() else 'cash') if b['type'] == 1 else 'checking'
        if b['id'] in (165206, 219230, 219408, 219409, 219415, 219416, 219418, 249595):
            typ = 'debit_card'
        if b['id'] in (165207, 273585) or b['type'] == 4:
            typ = 'fund'
        archived = b['status'] == 'closed'
        emit('bank_accounts', dict(id=key, account_id=a, venue_id=v, legal_entity_id=le, adesk_id=b['id'],
                                  name=b['name'], type=typ, currency='RUB' if b['currency'] == 'RUR' else b['currency'],
                                  group_id=group, is_active=not archived, deleted_at=anchor if archived else None,
                                  deleted_by=owner if archived else None, created_by=owner, bank_name=b.get('bankName'),
                                  bik=b.get('bankCode'), account_number=b.get('number'),
                                  correspondent_account=b.get('correspondentAccount'),
                                  balance_anchor_at=anchor, balance_anchor_amount=number(b['amount']),
                                  excluded_from_balance=b['isExcludedFromBusinessMoney'],
                                  description='Перенос Adesk. Исходное юрлицо: ' + str(b['legalEntity']['id']) + ' · ' + b['legalEntity']['name']))
        statements.append('select public.apply_transaction_balance_delta(' + sql(key) + ',' + sql(number(b['amount'])) + ');')
    event('accounts', 'legacy_accounts_imported', le, {'source': 'Adesk', 'source_legal_ids': [21994, 111153],
          'account_ids': sorted(bank_ids), 'balance_anchor_at': anchor, 'excluded_account_names': sorted(EXCLUDED_BANKS)})

    salary = [r for r in rows(source, 'Salary') if r.get('Сотрудник / ФИО') and day(r['Дата / Дата']) <= CUTOFF]
    fee_rows = [r for r in rows(source, 'Fees') if r.get('Категория')]
    fees = [r for r in fee_rows if r.get('Номер месяца') and r.get('Заведение / ID') == SOURCE_VENUE and day(r['Дата']) <= CUTOFF]
    excluded = [r for r in fee_rows if not r.get('Номер месяца') or r.get('Заведение / ID') != SOURCE_VENUE]
    periods = {p['month']: p['id'] for p in before['payroll_periods']}
    for month in range(6, 11):
        date = f'2026-{month:02d}-01'
        if date not in periods:
            periods[date] = uid('period:' + date)
            emit('payroll_periods', dict(id=periods[date], **scoped, month=date))
    statements.append(update('payroll_settings', {'starts_on': START, 'historical_through': CUTOFF}, 'account_id=' + sql(a) + ' and venue_id=' + sql(v)))
    # All source history is available from June; no unknown historical payout blocker remains.
    used_names = {r['Сотрудник / ФИО'] for r in salary} | {r['Сотрудник'] for r in fees}
    txs = [r for r in rows(source, 'Transactions') if r.get('Категория') and not str(r.get('Сотрудник / ФИО')).startswith('TEST_')]
    used_names |= {r['Сотрудник / ФИО'] for r in txs}

    transfers = [r for r in txs if r['Категория'] == 'Перенос']
    matched = set()
    pairs, opening = [], []
    for r in transfers:
        if r['Row ID'] in matched:
            continue
        candidates = [t for t in transfers if t['Row ID'] not in matched and t['Row ID'] != r['Row ID']
                      and t['Сотрудник / ФИО'] == r['Сотрудник / ФИО'] and t['Создание / Дата'] == r['Создание / Дата']
                      and number(t['Сумма / Значение']) == -number(r['Сумма / Значение'])
                      and abs(int(t['Месяц / Номер']) - int(r['Месяц / Номер'])) == 1]
        if len(candidates) == 1:
            t = candidates[0]
            matched.update((r['Row ID'], t['Row ID']))
            pairs.append(sorted((r, t), key=lambda x: int(x['Месяц / Номер'])))
        else:
            assert not candidates and int(r['Месяц / Номер']) == 6, 'Unpaired non-opening transfer'
            matched.add(r['Row ID'])
            opening.append(r)
    openings = {r['Сотрудник / ФИО']: -number(r['Сумма / Значение']) for r in opening}
    for name in sorted(used_names):
        e = employee(name)
        statements.append(update('payroll_employees', {'opening_balance': openings.get(name, D(0)), 'opening_confirmed': True}, 'id=' + sql(e['id'])))
        event('opening:' + e['id'], 'opening', e['id'], {'amount': openings.get(name, 0), 'starts_on': START,
              'source': 'Fees/Transactions', 'source_rows': [r for r in opening if r['Сотрудник / ФИО'] == name]}, e['id'])
    for f, t in pairs:
        e = employee(f['Сотрудник / ФИО'])
        key = uid('transfer:' + f['Row ID'])
        emit('payroll_transfers', dict(id=key, **scoped, employee_id=e['id'], from_month=f"2026-{int(f['Месяц / Номер']):02d}-01",
                                     to_month=f"2026-{int(t['Месяц / Номер']):02d}-01", amount=number(f['Сумма / Значение']),
                                     reason=f['Комментарий'] or 'Перенос из прежней ведомости', request_key=key,
                                     input_snapshot={'source': 'Fees/Transactions', 'rows': [f, t]}, created_by=owner))
        event('transfer:' + f['Row ID'], 'transfer_created', key, {'source': 'Fees/Transactions',
              'source_created_at': timestamp(f['Создание / Дата']), 'source_precision': 'day',
              'source_author': f['Создание / Ответственный'], 'source_rows': [f['Row ID'], t['Row ID']]}, e['id'])

    # Reuse existing mapped journal IDs; keep old revisions/events instead of deleting them.
    old_fees = {}
    for r in before['payroll_adjustments']:
        snap = r.get('rule_snapshot') or {}
        candidates = [r.get('source_ref', ''), snap.get('legacy_id', ''), snap.get('source_id', '')]
        for original in fee_rows:
            rid = original['🔒 Row ID']
            if rid and any(str(x).endswith(rid) for x in candidates):
                assert rid not in old_fees or old_fees[rid]['id'] == r['id'], 'Duplicate mapped Fee'
                old_fees[rid] = r
    retained_ids, fee_ids = set(), {}
    for r in fees:
        rid = r['🔒 Row ID']
        e = employee(r['Сотрудник'])
        old = old_fees.get(rid)
        if old is None:
            legacy_kind = {'Премия': 'bonus', 'Штраф': 'deduction', 'Предупреждение': 'warning'}[r['Категория']]
            legacy_amount = abs(number(r['Сумма'])) * (-1 if legacy_kind == 'deduction' else 1)
            same = [o for o in before['payroll_adjustments'] if o['id'] not in retained_ids
                    and str(o.get('source_ref') or '').startswith('initial-migration:adjustment:')
                    and o['employee_id'] == e['id'] and o['business_date'] == day(r['Дата'])
                    and o['kind'] == legacy_kind and number(o['amount']) == legacy_amount
                    and o['reason'].strip() == str(r['Комментарий'] or r['Категория']).strip()]
            if len(same) == 1:
                old = same[0]
            elif len(same) > 1:
                raise AssertionError('Ambiguous existing Fee; server-side review required')
        key = old['id'] if old else uid('fee:' + rid)
        retained_ids.add(key)
        fee_ids[rid] = key
        kind = {'Премия': 'bonus', 'Штраф': 'deduction', 'Предупреждение': 'warning'}[r['Категория']]
        medium = 'none' if kind == 'warning' else 'bonus' if r['Тип'] == 'Бонусы' else 'money'
        amount = D(0) if kind == 'warning' else abs(number(r['Сумма'])) * (-1 if kind == 'deduction' else 1)
        deleted = truth(r['Удаление / Статус'])
        assert int(r['Номер месяца']) == int(day(r['Дата'])[5:7]), 'Fee accounting month differs from date'
        new = dict(**scoped, employee_id=e['id'], business_date=day(r['Дата']), kind=kind, medium=medium,
                   amount=amount, reason=(r['Комментарий'] or r['Категория']).strip(), source_ref='payroll-entry:' + key,
                   approved=True, managed=True, origin='glide', rule_snapshot={'source': 'Fees/Fees', 'legacy_id': rid, 'row': r},
                   external_state='done' if medium == 'bonus' and r.get('ID операции') else 'review' if medium == 'bonus' else 'not_required',
                   external_ref=str(r['ID операции']) if r.get('ID операции') else None,
                   deleted_at=timestamp(r.get('Удаление / Дата'), r['Дата']) if deleted else None,
                   deleted_by=actor(r.get('Удаление / Ответственный')) if deleted else None,
                   delete_reason=(r.get('Удаление / Причина') or 'Удалено в прежней системе') if deleted else None)
        if old:
            statements.append(update('payroll_adjustments', new, 'id=' + sql(key)))
            event('superseded-fee:' + rid, 'legacy_record_reconciled', key, {'previous_record': old, 'source_row': rid}, e['id'])
        else:
            emit('payroll_adjustments', dict(id=key, created_by=actor(r.get('Создание / Ответственный')), **new))
        emit('payroll_adjustment_history', dict(id=uid('fee-created:' + rid), **scoped, employee_id=e['id'], adjustment_id=key,
                                              actor_id=actor(r['Создание / Ответственный']), actor_name=r['Создание / Ответственный'] or 'Прежний учёт',
                                              action='created', created_at=timestamp(r['Создание / Дата'], r['Дата']),
                                              details={'source': 'Fees/Fees', 'source_precision': 'day', 'reason': new['reason'], 'amount': amount, 'medium': medium}))
        if deleted:
            emit('payroll_adjustment_history', dict(id=uid('fee-deleted:' + rid), **scoped, employee_id=e['id'], adjustment_id=key,
                                                  actor_id=new['deleted_by'], actor_name=r.get('Удаление / Ответственный') or 'Прежний учёт',
                                                  action='deleted', created_at=new['deleted_at'], details={'source': 'Fees/Fees',
                                                  'source_precision': 'instant' if 'T' in str(r.get('Удаление / Дата')) else 'day', 'delete_reason': new['delete_reason']}))
    superseded = []
    for old in before['payroll_adjustments']:
        if old['id'] in retained_ids or old['business_date'] > CUTOFF or old['deleted_at']:
            continue
        # Every pre-cutover adjustment was part of the preceding verified migration.
        source_salary = [r for r in salary if employee(r['Сотрудник / ФИО'])['id'] == old['employee_id'] and day(r['Дата / Дата']) == old['business_date']]
        previous_day = next((r for r in before['payroll_accruals'] if r['employee_id'] == old['employee_id'] and r['business_date'] == old['business_date']), None)
        previous_base = sum((number(c['amount']) for c in previous_day['components'] if c.get('kind') not in ('correction', 'bonus', 'deduction', 'allowance', 'monthly')), D(0)) if previous_day else None
        known_historical_correction = (old['kind'] == 'correction' and old['managed'] and len(source_salary) == 1 and previous_base is not None
                                       and number(source_salary[0]['Зарплата / Чистая']) - previous_base == number(old['amount']))
        assert str(old.get('source_ref') or '').startswith('initial-migration:') or known_historical_correction or old.get('origin') in ('glide', 'missing_clockin', 'lateness', 'warning_threshold'), 'Unmapped manual record; review before replacing'
        statements.append(update('payroll_adjustments', {'deleted_at': args.imported_at, 'deleted_by': owner,
                                'delete_reason': 'Сверка с Fees: отсутствует в согласованном пакете либо уже включено в дневной расчёт'}, 'id=' + sql(old['id'])))
        event('superseded:' + old['id'], 'legacy_record_reconciled', old['id'], {'previous_record': old, 'reason': 'Replaced by authoritative Fees snapshot'}, old['employee_id'])
        superseded.append(old['id'])

    # Replace historical worker calculations; preserve every old row in immutable scoped events.
    existing = {(r['employee_id'], r['business_date']): r for r in before['payroll_accruals']}
    targets = {}
    components = [('base', 'Выход', 'Выход'), ('percent', 'Процент от продаж', 'Процент'),
                  ('extra', 'Дополнительные продажи', 'Дополнительные продажи'), ('experience', 'Стаж', 'Надбавка за стаж'),
                  ('knowledge', 'Знания', 'Надбавка за знания'), ('food', 'Питание', 'Питание')]
    for r in salary:
        e = employee(r['Сотрудник / ФИО'])
        date = day(r['Дата / Дата'])
        key = (e['id'], date)
        assert key not in targets, 'Duplicate daily Salary row'
        parts = [dict(kind=kind, label=label, amount=number(r[field]), source='fees:salary:' + r['Row ID'], basis='Сохранённый расчёт Glide')
                 for kind, label, field in components if number(r[field])]
        assert sum((p['amount'] for p in parts), D(0)) == number(r['Зарплата / Чистая']), 'Daily salary components differ'
        targets[key] = dict(components=parts, salary=number(r['Зарплата / Чистая']), tips=number(r['Чаевые']),
                            calculation_snapshot={'kind': 'shift', 'source': 'Fees/Salary', 'source_id': r['Row ID'],
                                                  'position_name': r['Должность'], 'legacy': r, 'historical': True})
    for key, old in existing.items():
        if key[1] <= CUTOFF and key not in targets:
            targets[key] = dict(components=[], salary=0, tips=0, calculation_snapshot={'kind': 'adjustment', 'source': 'Fees', 'historical': True})
    for (emp, date), data in targets.items():
        old = existing.get((emp, date))
        key = old['id'] if old else uid('salary:' + emp + ':' + date)
        # Database trigger overlays valid managed Fees; Salary itself contains shift pay only.
        new = dict(**scoped, employee_id=emp, business_date=date, period_id=periods[date[:7] + '-01'],
                   rule_version_id=None, status='ready', issues='{}', **data)
        if old:
            event('accrual-before:' + key, 'historical_calculation_replaced', key, {'previous_record': old, 'source': 'Fees/Salary'}, emp)
        emit('payroll_accruals', dict(id=key, **new), ' on conflict(employee_id,business_date) do update set ' +
             ','.join(f'{k}=excluded.{k}' for k in new if k not in scoped and k not in ('employee_id', 'business_date')))
    # Fee-only days are already created by the adjustment trigger and get the same live overlay.
    for r in rows(source, 'Shifts'):
        if not r.get('Дата') or day(r['Дата']) > CUTOFF:
            continue
        date = day(r['Дата'])
        legacy = {k: number(r[f]) for k, f in [('turnover', 'Оборот'), ('hookah', 'Кальянная касса'), ('bar', 'Барная касса'), ('tips', 'Чаевые'), ('taxi', 'Такси')]}
        emit('sales_days', dict(id=uid('sales:' + r['Row ID']), **scoped, business_date=date, status='imported',
                               calculated=legacy, legacy=legacy, legacy_source_id=r['Row ID'], source_summary={'source': 'Fees/Shifts', 'row': r}, method_version='fees-historical'),
             ' on conflict(venue_id,business_date) do update set legacy=excluded.legacy,legacy_source_id=excluded.legacy_source_id')
    date = dt.date.fromisoformat(START)
    while date.isoformat() <= CUTOFF:
        emit('payroll_source_days', dict(**scoped, business_date=date.isoformat(), state='complete',
                                        source={'source': 'Fees', 'historical_through': CUTOFF}, synced_at=args.imported_at),
             " on conflict(venue_id,business_date) do update set state='complete',source=excluded.source,error=null,synced_at=excluded.synced_at")
        date += dt.timedelta(days=1)

    comment_count = 0
    for r in rows(source, 'Comments'):
        if r.get('Тема') not in fee_ids:
            continue
        source_key = hashlib.sha256(dumps(r).encode()).hexdigest()
        parent = next(f for f in fees if f['🔒 Row ID'] == r['Тема'])
        e = employee(parent['Сотрудник'])
        name = source_names.get(r['Сотрудник / ID'], 'Прежний учёт')
        emit('payroll_adjustment_comments', dict(id=uid('comment:' + source_key), **scoped, employee_id=e['id'], adjustment_id=fee_ids[r['Тема']],
                                               author_id=actor(name), source_author_name=name, body=r['Комментарий'],
                                               created_at=timestamp(r.get('Отметка времени'), r.get('Дата')), request_key=uid('comment:' + source_key), source_ref='fees:' + source_key))
        emit('payroll_adjustment_history', dict(id=uid('comment-history:' + source_key), **scoped, employee_id=e['id'], adjustment_id=fee_ids[r['Тема']],
                                              actor_id=actor(name), actor_name=name, action='commented', created_at=timestamp(r.get('Отметка времени'), r.get('Дата')),
                                              details={'source': 'Fees/Comments', 'comment_id': uid('comment:' + source_key)}))
        comment_count += 1

    # Historical financial payouts use current-balance anchors, one transaction per employee.
    payments = [r for r in txs if r['Категория'] == 'Выплата' and truth(r['Создание / Статус']) and not truth(r['Удаление / Статус'])]
    for r in payments:
        e = employee(r['Сотрудник / ФИО'])
        bank_id = BANK_ALIASES[r['Счет списания / Название']]
        key, tx = uid('payment:' + r['Row ID']), uid('transaction:' + r['Row ID'])
        category = next((c['id'] for c in before['finance_categories'] if c['payroll_role_id'] == e['role_id']), None)
        assert category, 'No salary category for ' + e['name']
        occurred = timestamp(r['Создание / Дата'])
        amount = number(r['Сумма / Значение'])
        assert dt.datetime.fromisoformat(occurred) < dt.datetime.fromisoformat(anchor)
        emit('transactions', dict(id=tx, **scoped, legal_entity_id=le, bank_account_id=bank_ids[bank_id], category_id=category,
                                 type='expense', amount=amount, currency='RUB', description='Выплата · ' + e['name'] + (' · ' + r['Комментарий'] if r.get('Комментарий') else ''),
                                 date=occurred, source='import', source_external_id='fees:' + r['Row ID'], created_by=actor(r['Создание / Ответственный']), created_at=occurred))
        emit('audit_logs', dict(id=uid('payment-history:' + r['Row ID']), **scoped, legal_entity_id=le,
                               user_id=actor(r['Создание / Ответственный']), action_code='finance.transaction.created',
                               entity_type='transaction', entity_id=tx, created_at=occurred,
                               details={'type': 'expense', 'amount': amount, 'currency': 'RUB', 'source': 'Fees/Transactions',
                                        'source_author': r['Создание / Ответственный'], 'source_precision': 'day',
                                        'employee_name': e['name'], 'source_id': r['Row ID'], 'adesk_id': r.get('Adesk / ID')}))
        month = f"2026-{int(r['Месяц / Номер']):02d}-01"
        emit('payroll_payments', dict(id=key, **scoped, request_key=key, transaction_id=tx, kind='salary', amount=amount,
                                     occurred_at=occurred, note=r['Комментарий'] or '', created_by=owner,
                                     input_snapshot={'source': 'Fees/Transactions', 'row': r, 'source_precision': 'day', 'imported_at': args.imported_at},
                                     created_at=occurred))
        emit('payroll_allocations', dict(id=uid('allocation:' + r['Row ID']), **scoped, payment_id=key, employee_id=e['id'], month=month, amount=amount, settled_amount=amount))
        event('payment:' + r['Row ID'], 'payment', key, {'amount': amount, 'kind': 'salary', 'source': 'Fees/Transactions',
              'source_created_at': occurred, 'source_precision': 'day', 'source_author': r['Создание / Ответственный'], 'adesk_id': r.get('Adesk / ID')}, e['id'])
    # Unprocessed and removed attempts do not become posted payments or expenses.
    for r in txs:
        if r['Категория'] == 'Выплата' and r not in payments:
            event('unposted:' + r['Row ID'], 'legacy_unposted_payment', uid('unposted:' + r['Row ID']), {'source': 'Fees/Transactions', 'row': r}, employee(r['Сотрудник / ФИО'])['id'])
    for record in events:
        emit('payroll_events', record)
    summary = {'salary_days': len(salary), 'fees': len(fees), 'excluded_incomplete_fees': len(excluded),
               'comments': comment_count, 'transfers': len(pairs), 'opening_transfers': len(opening),
               'payments': len(payments), 'paid_total': sum(number(r['Сумма / Значение']) for r in payments),
               'bank_accounts': len(banks), 'bank_accounts_open': sum(b['status'] == 'open' for b in banks),
               'legal_entities': 1, 'superseded_adjustments': len(superseded), 'historical_through': CUTOFF,
               'inventory': 'excluded per user decision', 'insertions': dict(insertions)}
    # Whole-snapshot guard plus table locks prevents an intervening financial write from being overwritten.
    header = ['begin;', "set local lock_timeout='15s';", 'select pg_advisory_xact_lock(hashtextextended(' + sql(v) + '::text,0));',
              'lock table ' + ','.join('public.' + t for t in TABLES if t != 'sales_days') + ' in share row exclusive mode;',
              'do $guard$begin if (' + state_query(args) + ')<>' + sql(args.state_hash) + ' then raise exception \'Database changed after plan; replan required\';end if;end $guard$;',
              'select set_config(\'request.jwt.claim.sub\',' + sql(owner) + ',true);', "select set_config('app.ctx_ready','0',true);"]
    sql_text = '\n'.join(header + statements + [insert('audit_logs', dict(id=uid('import:' + args.import_id), **scoped, user_id=owner,
                action_code='payroll.history.imported', entity_type='payroll_import', entity_id=uid('import:' + args.import_id),
                details={'source_hash': hashlib.sha256(dumps(source).encode()).hexdigest(), 'summary': summary})), 'commit;'])
    return sql_text, summary


def verify(args, database, source, bank_source):
    actual = database.snapshot()
    assert next(s for s in actual['payroll_settings'] if s['venue_id'] == args.venue)['historical_through'] == CUTOFF
    expected = collections.defaultdict(lambda: {'salary': D(0), 'tips': D(0), 'paid': D(0), 'carry': D(0)})
    for r in rows(source, 'Salary'):
        if r.get('Сотрудник / ФИО') and day(r['Дата / Дата']) <= CUTOFF:
            k = (r['Сотрудник / ФИО'], day(r['Дата / Дата'])[:7])
            expected[k]['salary'] += number(r['Зарплата / Чистая'])
            expected[k]['tips'] += number(r['Чаевые'])
    for r in rows(source, 'Fees'):
        if r.get('Категория') and r.get('Номер месяца') and r.get('Заведение / ID') == SOURCE_VENUE and not truth(r['Удаление / Статус']) and r['Тип'] == 'Деньги' and r['Категория'] != 'Предупреждение':
            k = (r['Сотрудник'], day(r['Дата'])[:7])
            expected[k]['salary'] += abs(number(r['Сумма'])) * (-1 if r['Категория'] == 'Штраф' else 1)
    for r in rows(source, 'Transactions'):
        if not r.get('Категория') or str(r.get('Сотрудник / ФИО')).startswith('TEST_'):
            continue
        k = (r['Сотрудник / ФИО'], f"2026-{int(r['Месяц / Номер']):02d}")
        if r['Категория'] == 'Выплата' and truth(r['Создание / Статус']) and not truth(r['Удаление / Статус']):
            expected[k]['paid'] += number(r['Сумма / Значение'])
        elif r['Категория'] == 'Перенос':
            expected[k]['carry'] -= number(r['Сумма / Значение'])
    names = {e['id']: e['name'] for e in actual['payroll_employees']}
    measured = collections.defaultdict(lambda: {'salary': D(0), 'tips': D(0), 'paid': D(0), 'carry': D(0)})
    for r in actual['payroll_accruals']:
        if r['business_date'] <= CUTOFF:
            k = (names[r['employee_id']], r['business_date'][:7])
            measured[k]['salary'] += number(r['salary'])
            measured[k]['tips'] += number(r['tips'])
    pay_by_id = {r['id']: r for r in actual['payroll_payments']}
    for r in actual['payroll_allocations']:
        if pay_by_id[r['payment_id']]['state'] == 'posted' and pay_by_id[r['payment_id']]['kind'] != 'tips':
            measured[(names[r['employee_id']], r['month'][:7])]['paid'] += number(r['settled_amount'])
    for r in actual['payroll_transfers']:
        if r['state'] == 'posted':
            measured[(names[r['employee_id']], r['from_month'][:7])]['carry'] -= number(r['amount'])
            measured[(names[r['employee_id']], r['to_month'][:7])]['carry'] += number(r['amount'])
    for e in actual['payroll_employees']:
        measured[(e['name'], START[:7])]['carry'] += number(e['opening_balance'])
    differences = []
    report = []
    for k in sorted(set(expected) | set(measured)):
        ex, got = expected[k], measured[k]
        if any(ex[f] != got[f] for f in ex):
            differences.append({'employee': k[0], 'month': k[1], 'expected': ex, 'actual': got})
        if any(ex.values()) or any(got.values()):
            report.append(dict(employee=k[0], month=k[1], **got, remaining=got['salary'] + got['carry'] - got['paid']))
    daily_differences = []
    accrual_by_key = {(r['employee_id'], r['business_date']): r for r in actual['payroll_accruals']}
    employee_ids = {e['name']: e['id'] for e in actual['payroll_employees']}
    for r in rows(source, 'Salary'):
        if not r.get('Сотрудник / ФИО') or day(r['Дата / Дата']) > CUTOFF:
            continue
        got = accrual_by_key[(employee_ids[r['Сотрудник / ФИО']], day(r['Дата / Дата']))]
        base = sum(number(c['amount']) for c in got['components'] if not str(c.get('source', '')).startswith('payroll-entry:'))
        if base != number(r['Зарплата / Чистая']) or number(got['tips']) != number(r['Чаевые']):
            daily_differences.append(r['Row ID'])
    valid_fees = [r for r in rows(source, 'Fees') if r.get('Категория') and r.get('Номер месяца') and r.get('Заведение / ID') == SOURCE_VENUE]
    journal_differences = []
    for r in valid_fees:
        found = [f for f in actual['payroll_adjustments'] if f.get('rule_snapshot', {}).get('legacy_id') == r['🔒 Row ID']]
        expected_amount = D(0) if r['Категория'] == 'Предупреждение' else abs(number(r['Сумма'])) * (-1 if r['Категория'] == 'Штраф' else 1)
        if len(found) != 1 or number(found[0]['amount']) != expected_amount or bool(found[0]['deleted_at']) != truth(r['Удаление / Статус']):
            journal_differences.append(r['🔒 Row ID'])
    bank_differences = []
    for b in bank_source['accounts']:
        found = [r for r in actual['bank_accounts'] if r.get('adesk_id') == b['id']]
        if len(found) != 1 or number(found[0]['balance']) != number(b['amount']):
            bank_differences.append(b['id'])
    save(Path(args.directory) / ('verification-' + args.database + '.json'), {'differences': differences, 'bank_differences': bank_differences, 'daily_differences': daily_differences, 'journal_differences': journal_differences, 'employees': report})
    print(dumps({'database': args.database, 'monthly_differences': len(differences), 'bank_differences': len(bank_differences), 'daily_differences': len(daily_differences), 'journal_differences': len(journal_differences), 'october': [r for r in report if r['month'] == '2026-10']}))
    assert not differences and not bank_differences and not daily_differences and not journal_differences, 'Source reconciliation failed; inspect server-only verification report'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['plan', 'apply', 'verify'])
    p.add_argument('--directory', required=True)
    p.add_argument('--database', required=True)
    p.add_argument('--container', required=True)
    p.add_argument('--account', required=True)
    p.add_argument('--venue', required=True)
    p.add_argument('--owner', required=True)
    p.add_argument('--import-id', default='fees-20261016-v1')
    p.add_argument('--plan-sha256')
    p.add_argument('--imported-at', default=dt.datetime.now(dt.timezone.utc).isoformat())
    args = p.parse_args()
    root = Path(args.directory)
    source = json.loads((root / 'fees-source-20261016.json').read_text())
    bank_source = json.loads((root / 'adesk-accounts-source-20261016.json').read_text())
    db = Database(args)
    plan_file = root / ('plan-' + args.database + '.json')
    sql_file = root / ('apply-' + args.database + '.sql')
    if args.mode == 'verify':
        verify(args, db, source, bank_source)
    elif args.mode == 'plan':
        before = db.snapshot()
        args.state_hash = db.query(state_query(args) + ';')
        save(root / ('snapshot-' + args.database + '.json'), before)
        assert not before['payroll_payments'] and not before['payroll_transfers'], 'Existing payments/transfers require explicit deduplication'
        query, summary = build(args, before, source, bank_source)
        digest = hashlib.sha256(query.encode()).hexdigest()
        save(sql_file, query)
        save(plan_file, {'fingerprint': fingerprint(before), 'sql_sha256': digest, 'summary': summary})
        print(dumps({'plan_sha256': digest, 'summary': summary}))
    else:
        plan = json.loads(plan_file.read_text())
        query = sql_file.read_text()
        assert args.plan_sha256 == plan['sql_sha256'] == hashlib.sha256(query.encode()).hexdigest(), 'Exact plan hash is required'
        previous = db.query('select count(*) from public.audit_logs where id=' + sql(uid('import:' + args.import_id)) + ';')
        if previous == '1':
            print('Import already committed; verifying without replaying writes')
        else:
            assert fingerprint(db.snapshot()) == plan['fingerprint'], 'Database changed after plan; regenerate and review'
            db.query(query)
            print('Import committed')
        verify(args, db, source, bank_source)


if __name__ == '__main__':
    main()
