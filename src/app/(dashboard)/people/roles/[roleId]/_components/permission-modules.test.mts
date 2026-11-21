import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUSTOM_LEVEL,
  NO_ACCESS_LEVEL,
  PERMISSION_GROUPS,
  PERMISSION_SECTIONS,
  codeOrder,
  detectLevel,
} from "./permission-modules.ts";

/**
 * Снимок справочника прав из локальной БД. Обновлять, когда миграция
 * добавляет, переносит или удаляет право:
 *
 *   docker exec supabase_db_crm psql -U postgres -At -c "select '  \"'||module||'\": ['||string_agg('\"'||code||'\"', ', ' order by code)||'],' from permissions group by module order by module"
 *
 * Новое право нужно ещё и положить в уровень раздела (permission-modules.ts),
 * иначе тест ниже упадёт: раздел с таким правом показывался бы «Своим
 * набором», а выбор «Полного доступа» молча снимал бы новое право.
 */
const DB_PERMISSIONS: Record<string, string[]> = {
  "crm": ["crm.adjust_loyalty_balance", "crm.cancel_reservation", "crm.manage_guests", "crm.manage_loyalty", "crm.manage_reservations", "crm.view_guest_details", "crm.view_guests", "crm.view_loyalty", "crm.view_reservations"],
  "finance": ["finance.create_transaction", "finance.delete_attachments", "finance.delete_bank_account", "finance.delete_category", "finance.delete_counterparty", "finance.delete_transaction", "finance.export", "finance.manage_bank_accounts", "finance.manage_categories", "finance.manage_counterparties", "finance.manage_posting_rules", "finance.update_any_transaction", "finance.update_transaction", "finance.upload_attachments", "finance.view_all_legal_entities", "finance.view_all_venues", "finance.view_attachments", "finance.view_bank_accounts", "finance.view_categories", "finance.view_counterparties", "finance.view_dashboard", "finance.view_transactions"],
  "inventory_documents": ["inventory.adjust_results", "inventory.assign_writeoff_pool", "inventory.comment_results", "inventory.fill_assigned_documents", "inventory.finalize_results", "inventory.manage_documents", "inventory.post_deductions", "inventory.recount_documents", "inventory.use_ai_suggestions", "inventory.view_documents", "inventory.view_results"],
  "inventory_integration": ["inventory.sync_quickresto"],
  "inventory_products": ["inventory.manage_products", "inventory.view_products"],
  "inventory_scope": ["inventory.view_all_venues"],
  "inventory_stores": ["inventory.manage_stores", "inventory.view_stores"],
  "kb": ["kb.ask_ai", "kb.comment_pages", "kb.create_pages", "kb.delete_pages", "kb.edit_any_page", "kb.edit_own_pages", "kb.export_pages", "kb.import_pages", "kb.lock_pages", "kb.manage_attachments", "kb.manage_required_reading", "kb.manage_templates", "kb.use_ai", "kb.view_analytics", "kb.view_pages", "kb.view_version_history"],
  "org": ["org.delete_legal_entity", "org.delete_venue", "org.manage_account", "org.manage_legal_entities", "org.manage_venues", "org.view_account", "org.view_audit", "org.view_legal_entities", "org.view_venues"],
  "payroll": ["payroll.approve", "payroll.configure", "payroll.pay", "payroll.review", "payroll.sync", "payroll.view"],
  "people": ["people.delete_department", "people.delete_role", "people.delete_staff", "people.edit_staff", "people.invite_staff", "people.manage_candidates", "people.manage_roles", "people.terminate_staff", "people.view_roles", "people.view_staff", "people.view_staff_details"],
  "sales": ["sales.adjust_shifts", "sales.configure_shifts", "sales.export_shifts", "sales.sync_shifts", "sales.view_shifts"],
  "schedule_checklists": ["schedule.checklist_archive", "schedule.checklist_create", "schedule.checklist_edit", "schedule.checklist_publish", "schedule.review"],
  "schedule_shifts": ["schedule.qualifications", "schedule.shift_assign", "schedule.shift_copy", "schedule.shift_create", "schedule.shift_delete", "schedule.shift_edit", "schedule.shift_publish", "schedule.view_all"],
  "schedule_templates": ["schedule.template_archive", "schedule.template_copy", "schedule.template_create", "schedule.template_edit"],
  "settings": ["settings.manage_billing", "settings.manage_integrations", "settings.manage_notifications", "settings.use_dadata"],
};

const sectionCodes = (modules: readonly string[]) =>
  new Set(modules.flatMap((m) => DB_PERMISSIONS[m] ?? []));

test("каждый модуль БД входит ровно в один раздел", () => {
  const seen = new Map<string, string>();
  for (const s of PERMISSION_SECTIONS) {
    for (const m of s.modules) {
      assert.ok(!seen.has(m), `модуль ${m} сразу в «${seen.get(m)}» и «${s.label}»`);
      seen.set(m, s.label);
    }
  }
  for (const m of Object.keys(DB_PERMISSIONS)) {
    assert.ok(seen.has(m), `модуль ${m} не разложен ни в один раздел`);
  }
});

test("id разделов и групп уникальны, уровни внутри раздела тоже", () => {
  const sectionIds = PERMISSION_SECTIONS.map((s) => s.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length);
  const groupIds = PERMISSION_GROUPS.map((g) => g.id);
  assert.equal(new Set(groupIds).size, groupIds.length);
  for (const s of PERMISSION_SECTIONS) {
    const ids = s.levels.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, s.label);
    assert.ok(!ids.includes(NO_ACCESS_LEVEL.id) && !ids.includes(CUSTOM_LEVEL.id), s.label);
    assert.ok(s.levels.length > 0, s.label);
  }
});

test("коды уровней существуют в справочнике и принадлежат модулям раздела", () => {
  for (const s of PERMISSION_SECTIONS) {
    const own = sectionCodes(s.modules);
    for (const level of s.levels) {
      for (const code of level.codes) {
        assert.ok(own.has(code), `«${s.label}» / «${level.label}»: ${code} нет среди прав раздела`);
      }
      assert.equal(new Set(level.codes).size, level.codes.length, `${s.label}: дубли в «${level.label}»`);
    }
  }
});

test("каждый уровень — строгое подмножество следующего", () => {
  for (const s of PERMISSION_SECTIONS) {
    for (let i = 1; i < s.levels.length; i++) {
      const prev = s.levels[i - 1];
      const next = new Set(s.levels[i].codes);
      for (const code of prev.codes) {
        assert.ok(next.has(code), `${s.label}: ${code} из «${prev.label}» нет в «${s.levels[i].label}»`);
      }
      assert.ok(next.size > prev.codes.length, `${s.label}: «${s.levels[i].label}» ничего не добавляет`);
    }
  }
});

test("последний уровень раздела — все его права", () => {
  for (const s of PERMISSION_SECTIONS) {
    const top = new Set(s.levels[s.levels.length - 1].codes);
    assert.deepEqual([...top].sort(), [...sectionCodes(s.modules)].sort(), s.label);
  }
});

test("уровень определяется по набору: точное совпадение, пусто, свой набор", () => {
  for (const s of PERMISSION_SECTIONS) {
    for (const level of s.levels) {
      assert.equal(detectLevel(s.levels, new Set(level.codes)), level.id, `${s.label} / ${level.label}`);
    }
    assert.equal(detectLevel(s.levels, new Set()), NO_ACCESS_LEVEL.id);
    const top = s.levels[s.levels.length - 1].codes;
    if (top.length > 1) {
      // Полный набор без одного права, не совпадающий с промежуточным уровнем.
      const partial = new Set(top);
      partial.delete(top[0]);
      assert.equal(detectLevel(s.levels, partial), CUSTOM_LEVEL.id, s.label);
    }
  }
});

test("уровень узнаётся, даже если части прав ещё нет в БД", () => {
  const acts = PERMISSION_SECTIONS.find((s) => s.id === "inventory_acts");
  assert.ok(acts);
  const full = acts.levels[acts.levels.length - 1];
  const available = new Set(full.codes.filter((c) => c !== "inventory.post_deductions"));
  assert.equal(detectLevel(acts.levels, available, available), "full");
  assert.equal(detectLevel(acts.levels, available), CUSTOM_LEVEL.id);
});

test("акты: удержания — только «Полный доступ», разнос списаний — уже у «Редактора»", () => {
  const acts = PERMISSION_SECTIONS.find((s) => s.id === "inventory_acts");
  assert.ok(acts);
  const level = (id: string) => new Set(acts.levels.find((l) => l.id === id)?.codes);
  assert.ok(level("full").has("inventory.post_deductions"));
  assert.ok(!level("editor").has("inventory.post_deductions"));
  assert.ok(level("editor").has("inventory.assign_writeoff_pool"));
});

test("опасные права — только на верхнем уровне", () => {
  const dangerous = [
    "people.manage_roles",
    "people.delete_staff",
    "org.delete_legal_entity",
    "finance.delete_bank_account",
    "settings.manage_billing",
  ];
  for (const s of PERMISSION_SECTIONS) {
    s.levels.slice(0, -1).forEach((level) => {
      for (const code of dangerous) {
        assert.ok(!level.codes.includes(code), `${code} не должно быть в «${s.label} / ${level.label}»`);
      }
    });
  }
});

test("порядок прав в «Отдельных правах» идёт от младшего уровня", () => {
  const crm = PERMISSION_SECTIONS.find((s) => s.id === "crm");
  assert.ok(crm);
  const order = codeOrder(crm);
  assert.ok(order.get("crm.view_guests")! < order.get("crm.adjust_loyalty_balance")!);
  assert.equal(order.size, sectionCodes(crm.modules).size);
});
