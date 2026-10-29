#!/usr/bin/env python3
"""Prepare an incremental, exact-ID payroll import; never execute SQL or call providers.

Inputs are private snapshots: source.json, server-state.json (employee identities),
server-ledger-current.json (full rows), verified-payments.json (Adesk UI matches),
and adesk-affected-balances.json. Output is a reviewable manifest and guarded SQL.
The SQL can be rehearsed with ROLLBACK. COMMIT is a separate approved operation.
"""
import argparse
import collections
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("history", Path(__file__).with_name("import-payroll-history.py"))
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


def instant(value):
    return dt.datetime.fromisoformat(history.timestamp(value))


def build(directory, account, venue, owner):
    def read(name):
        return json.loads((directory / name).read_text())

    source = read("source.json")
    state = read("server-ledger-current.json")
    employees = read("server-state.json")["employees"]
    verified = read("verified-payments.json")
    balances = read("adesk-affected-balances.json")
    rows = {r["Row ID"]: r for r in history.rows(source, "Transactions")}
    assert len(rows) == len(history.rows(source, "Transactions")), "Duplicate source Row ID"
    records = verified["payments"]
    assert records and len({r["row_id"] for r in records}) == len(records), "Duplicate approved payout"
    assert len({str(r["adesk_id"]) for r in records}) == len(records), "Duplicate Adesk operation"
    banks = {}
    bank_changes = []
    for balance in balances["accounts"]:
        matches = [b for b in state["bank_accounts"] if b.get("adesk_id") == balance["adesk_id"] and b["account_id"] == account]
        assert len(matches) == 1, "Bank must match one Adesk ID"
        bank = matches[0]
        assert bank["name"] == balance["name"] and bank["currency"] == "RUB", "Bank identity/currency changed"
        assert bank["balance_anchor_at"] and instant(bank["balance_anchor_at"]) < instant(balances["read_at"]), "Balance anchor is not older than source snapshot"
        assert not any(t["deleted_at"] is None and (t["bank_account_id"] == bank["id"] or t.get("to_bank_account_id") == bank["id"])
                       and instant(t["date"]) >= instant(bank["balance_anchor_at"])
                       for t in state["transactions"]), "Unreconciled operations after the previous balance anchor"
        banks[bank["name"]] = bank
        bank_changes.append({"id": bank["id"], "name": bank["name"], "adesk_id": balance["adesk_id"],
                             "before": bank["balance"], "after": balance["balance"], "anchor": balances["read_at"]})

    scoped = {"account_id": account, "venue_id": venue}
    statements = []
    manifest = []
    expected = collections.defaultdict(lambda: history.D(0))
    for match in records:
        row = rows[match["row_id"]]
        assert row["Категория"] == "Выплата" and history.truth(row["Создание / Статус"]) and not history.truth(row["Удаление / Статус"]), "Source payout is not posted"
        assert row["Заведение / ID"] == history.SOURCE_VENUE, "Source belongs to another venue"
        assert str(int(history.number(row["Adesk / ID"]))) == str(match["adesk_id"]), "Adesk identity mismatch"
        amount = history.number(row["Сумма / Значение"])
        assert amount > 0 and amount == history.number(match["amount"]), "Amount mismatch"
        assert row["Сотрудник / ФИО"] == match["employee"], "Employee mismatch"
        assert history.day(row["Создание / Дата"]) == match["source_date"] > history.CUTOFF, "Payout date/cutoff mismatch"
        assert int(history.number(row["Месяц / Номер"])) == int(match["month"]) and match["month"] in (9, 10), "Allocation month mismatch"
        actual = match["raw_ui"]
        assert str(actual["id"]) == str(match["adesk_id"]) and actual["project"] == "/project/268648", "Adesk project mismatch"
        assert row["Сотрудник / ФИО"] in actual["cells"][3].splitlines(), "Adesk employee mismatch"
        ui_amount = history.number("".join(c for c in actual["cells"][2] if c.isdigit() or c == ","))
        assert actual["cells"][2].lstrip().startswith(("–", "−", "-")), "Adesk operation must be an expense"
        assert ui_amount == amount, "Adesk UI amount mismatch"
        bank_name = actual["cells"][6].splitlines()[0]
        assert bank_name == match["actual_bank_name"] and bank_name in banks, "Adesk account not reconciled"
        ui_date_text = actual["cells"][1].splitlines()[0]
        # Resolve the rendered label at the time of capture, never at plan execution.
        ui_date = verified["read_at"][:10] if ui_date_text == "Сегодня" else history.day(ui_date_text)
        assert ui_date == match["adesk_date"], "Adesk date mismatch"
        if ui_date != match["source_date"]:
            assert match["date_choice"] == "owner_confirmed_glide_2026-10-21", "A date conflict needs an explicit owner decision"
            assert match["adesk_id"] in (145881098, 145881100) and match["source_date"] == "2026-10-21" and ui_date == "2026-10-22", "Unexpected date conflict"

        staff = [e for e in employees if e["name"] == match["employee"]]
        assert len(staff) == 1, "Employee must match exactly once"
        employee = staff[0]
        categories = [c for c in state["finance_categories"] if c.get("payroll_role_id") == employee["role_id"] and c["account_id"] == account and c["type"] == "expense" and c["archived_at"] is None]
        assert len(categories) == 1, "Employee role needs one FOT category"
        bank = banks[bank_name]
        key = history.uid("payment:" + match["row_id"])
        transaction = history.uid("transaction:" + match["row_id"])
        assert not any(p["id"] == key or int(history.number(p.get("input_snapshot", {}).get("row", {}).get("Adesk / ID"))) == int(match["adesk_id"]) for p in state["payroll_payments"]), "Payment/Adesk ID already imported"
        assert not any(t["id"] == transaction or t.get("source_external_id") == "fees:" + match["row_id"] for t in state["transactions"]), "Transaction already imported"
        occurred = history.timestamp(row["Создание / Дата"])
        assert instant(occurred) < instant(balances["read_at"]), "Payout is not covered by the balance snapshot"
        month = f"2026-{int(match['month']):02d}-01"
        evidence = {"source": "Fees/Transactions", "row": row, "source_precision": "day", "imported_at": state["read_at"],
                    "adesk_verified": {"id": match["adesk_id"], "bank_id": bank["adesk_id"], "bank_name": bank_name,
                                       "date": ui_date, "category": actual["cells"][3].splitlines()[0], "project_id": 268648,
                                       "read_at": verified["read_at"]}, "date_choice": match.get("date_choice", "sources_agree")}
        actor = owner if row["Создание / Ответственный"] == "Павел Оплочко" else None
        statements.extend([
            history.insert("transactions", dict(id=transaction, **scoped, legal_entity_id=bank["legal_entity_id"], bank_account_id=bank["id"],
                category_id=categories[0]["id"], type="expense", amount=amount, currency="RUB", description="Выплата · " + employee["name"] + (" · " + row["Комментарий"] if row.get("Комментарий") else ""),
                date=occurred, source="import", balance_covered_by_import=True, source_external_id="fees:" + match["row_id"], created_by=actor, created_at=occurred)),
            history.insert("payroll_payments", dict(id=key, **scoped, request_key=key, transaction_id=transaction, kind="salary", amount=amount,
                occurred_at=occurred, note=row["Комментарий"] or "", created_by=owner, input_snapshot=evidence, created_at=occurred)),
            history.insert("payroll_allocations", dict(id=history.uid("allocation:" + match["row_id"]), **scoped, payment_id=key, employee_id=employee["id"], month=month, amount=amount, settled_amount=amount)),
            history.insert("audit_logs", dict(id=history.uid("payment-history:" + match["row_id"]), **scoped, legal_entity_id=bank["legal_entity_id"], user_id=actor,
                action_code="finance.transaction.created", entity_type="transaction", entity_id=transaction, created_at=occurred,
                details={"type": "expense", "amount": amount, "currency": "RUB", "source": "Fees/Transactions", "source_author": row["Создание / Ответственный"],
                         "employee_name": employee["name"], "source_id": match["row_id"], "adesk_id": match["adesk_id"], "source_precision": "day", "imported_at": state["read_at"]})),
            history.insert("payroll_events", dict(id=history.uid("event:payment:" + match["row_id"]), **scoped, employee_id=employee["id"], entity_id=key, action="payment", actor_id=owner,
                details={"amount": amount, "kind": "salary", "source": "Fees/Transactions", "source_created_at": occurred, "source_precision": "day",
                         "source_author": row["Создание / Ответственный"], "adesk_id": match["adesk_id"]})),
        ])
        expected[(employee["id"], month)] += amount
        manifest.append({"source_id": match["row_id"], "adesk_id": match["adesk_id"], "employee": employee["name"], "employee_id": employee["id"], "payment_id": key, "transaction_id": transaction,
                         "date": match["source_date"], "adesk_date": ui_date, "month": month, "amount": amount, "bank": bank_name, "bank_id": bank["id"], "category": categories[0]["name"]})

    digest = hashlib.sha256(history.dumps({"payments": manifest, "balances": bank_changes, "source": source}).encode()).hexdigest()
    audit_id = history.uid("payroll-tail:" + digest)
    q = history.sql
    guards = []
    # Exact snapshots make drift a reviewable failure, rather than an overwrite.
    for table in ("bank_accounts", "transactions", "payroll_payments", "payroll_allocations", "finance_categories", "payroll_transfers", "payroll_qualifications"):
        where = "account_id=" + q(account) + (" and venue_id=" + q(venue) if table.startswith("payroll_") else "")
        guards.append("if coalesce((select jsonb_agg(to_jsonb(t) order by id) from public." + table + " t where " + where + "),'[]'::jsonb) is distinct from " + q(state[table]) + " then raise exception 'Snapshot changed: " + table + "'; end if;")
    for employee in {m["employee_id"]: m for m in manifest}.values():
        role = next(e["role_id"] for e in employees if e["id"] == employee["employee_id"])
        guards.append("if not exists(select 1 from public.payroll_employees where id=" + q(employee["employee_id"]) + " and account_id=" + q(account) + " and venue_id=" + q(venue) + " and role_id=" + q(role) + ") then raise exception 'Employee identity changed'; end if;")
    values = ",".join("(" + ",".join([q(e) + "::uuid", q(m) + "::date", q(n)]) + ")" for (e, m), n in expected.items())
    body = ["set local lock_timeout='10s';", "set local statement_timeout='60s';",
        "select set_config('request.jwt.claim.sub'," + q(owner) + ",true),set_config('app.ctx_ready','0',true);",
        "lock table public.bank_accounts,public.transactions,public.payroll_payments,public.payroll_allocations,public.payroll_employees,public.finance_categories,public.payroll_accruals,public.payroll_transfers,public.payroll_qualifications in share row exclusive mode;",
        "do $tail$ begin",
        "if public.get_active_account_id() is distinct from " + q(account) + "::uuid or public.get_active_venue_id() is distinct from " + q(venue) + "::uuid or auth.uid() is distinct from " + q(owner) + "::uuid then raise exception 'Account/venue/owner context changed';end if;",
        "perform pg_advisory_xact_lock(hashtextextended(" + q(venue) + ",0));",
        "if exists(select 1 from public.audit_logs where id=" + q(audit_id) + " and details->>'source_digest'=" + q(digest) + ") then return; end if;",
        *guards,
        "create temporary table tail_expected on commit drop as select x.*,private.payroll_month_balance(x.employee_id,x.month) as before_balance from (values " + values + ") x(employee_id,month,paid);",
    ]
    for bank in bank_changes:
        body.append("perform public.apply_transaction_balance_delta(" + q(bank["id"]) + "::uuid," + q(history.number(bank["after"]) - history.number(bank["before"])) + ");")
        body.append(history.update("bank_accounts", {"balance_anchor_amount": bank["after"], "balance_anchor_at": bank["anchor"]}, "id=" + q(bank["id"])))
    body.extend(statements)
    body.extend([
        "if exists(select 1 from tail_expected e where private.payroll_month_balance(e.employee_id,e.month)<>e.before_balance-e.paid) then raise exception 'Payroll debt delta mismatch';end if;",
        *["if not exists(select 1 from public.bank_accounts where id=" + q(b["id"]) + " and balance=" + q(b["after"]) + ") then raise exception 'Payout affected covered cash balance';end if;" for b in bank_changes],
        history.insert("audit_logs", dict(id=audit_id, **scoped, user_id=owner, action_code="payroll.data.imported", entity_type="payroll_import", entity_id=audit_id,
            details={"source": "Fees/Transactions + Adesk", "source_digest": digest, "payments": len(manifest), "amount": sum(expected.values()), "balance_changes": bank_changes,
                     "date_conflicts": [{k: p[k] for k in ("employee", "amount", "date", "adesk_date", "source_id")} for p in manifest if p["date"] != p["adesk_date"]]})),
        "end $tail$;",
    ])
    sql = "\n".join(body) + "\n"
    return {"source_digest": digest, "payments": manifest, "balances": bank_changes,
            "payment_count": len(manifest), "total": sum(expected.values()), "audit_id": audit_id,
            "sql_sha256": hashlib.sha256(sql.encode()).hexdigest()}, sql


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--account", required=True)
    parser.add_argument("--venue", required=True)
    parser.add_argument("--owner", required=True)
    args = parser.parse_args()
    plan, sql = build(args.directory, args.account, args.venue, args.owner)
    history.save(args.directory / "tail-plan.json", plan)
    history.save(args.directory / "tail-apply.sql", sql)
    print(history.dumps({k: plan[k] for k in ("payment_count", "total", "balances", "sql_sha256")}))
