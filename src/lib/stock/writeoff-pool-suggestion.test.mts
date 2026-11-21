import { test } from "node:test";
import assert from "node:assert/strict";

import {
  masterDepartmentIds,
  suggestWriteoffPool,
  type WriteoffSuggestionTargets,
} from "./writeoff-pool-suggestion.ts";

const targets: WriteoffSuggestionTargets = {
  departments: [
    { id: "bar", name: "Бар", archived: false },
    { id: "hookah", name: "Кальянные мастера", archived: false },
    { id: "old", name: "Кухня", archived: true },
  ],
  employees: [
    { id: "e1", name: "Иван Петров", active: true, quickrestoId: 10 },
    { id: "e2", name: "Анна Смирнова", active: true, quickrestoId: null },
    { id: "e3", name: "Пётр Сидоров", active: false, quickrestoId: 30 },
  ],
};

const doc = (kind: Parameters<typeof suggestWriteoffPool>[0]["kind"], operatorId: number | null = null, operatorName: string | null = null) => ({
  kind,
  operatorId,
  operatorName,
});

test("личное потребление и «за счёт заведения» → «Не удерживать»", () => {
  assert.deepEqual(suggestWriteoffPool(doc("personal", 10, "Иван Петров"), targets), { pool: "excluded", key: null });
  assert.deepEqual(suggestWriteoffPool(doc("business"), targets), { pool: "excluded", key: null });
});

test("«Вся команда» → «Вся команда»", () => {
  assert.deepEqual(suggestWriteoffPool(doc("team"), targets), { pool: "shared", key: null });
});

test("«Нужно уточнить» → без подсказки", () => {
  assert.equal(suggestWriteoffPool(doc("unknown", 10, "Иван Петров"), targets), null);
});

test("сотрудник по ID в Quick Resto", () => {
  assert.deepEqual(suggestWriteoffPool(doc("employee", 10, "Кто-то другой"), targets), { pool: "personal", key: "e1" });
});

test("сотрудник по имени, если ID не сопоставлен: порядок слов, регистр и ё не важны", () => {
  assert.deepEqual(suggestWriteoffPool(doc("employee", 99, "смирнова  анна"), targets), { pool: "personal", key: "e2" });
  assert.deepEqual(
    suggestWriteoffPool(doc("employee", null, "Иван Петров"), {
      ...targets,
      employees: [{ id: "e9", name: "Иван Пётров", active: true }],
    }),
    { pool: "personal", key: "e9" },
  );
});

test("уволенного сотрудника не подставляем, даже если ID совпал", () => {
  assert.equal(suggestWriteoffPool(doc("employee", 30, "Пётр Сидоров"), targets), null);
});

test("тёзки или два сотрудника с одним ID → без подсказки", () => {
  const twins: WriteoffSuggestionTargets = {
    departments: [],
    employees: [
      { id: "a", name: "Анна Смирнова", active: true },
      { id: "b", name: "Смирнова Анна", active: true },
    ],
  };
  assert.equal(suggestWriteoffPool(doc("employee", null, "Анна Смирнова"), twins), null);
  const sameId: WriteoffSuggestionTargets = {
    departments: [],
    employees: [
      { id: "a", name: "Анна", active: true, quickrestoId: 5 },
      { id: "b", name: "Борис", active: true, quickrestoId: 5 },
    ],
  };
  // Неоднозначный ID - не повод подбирать по имени.
  assert.equal(suggestWriteoffPool(doc("employee", 5, "Анна"), sameId), null);
});

test("сотрудник без имени и без совпадения → без подсказки", () => {
  assert.equal(suggestWriteoffPool(doc("employee", 77, null), targets), null);
  assert.equal(suggestWriteoffPool(doc("employee", 77, "Нет Такого"), targets), null);
});

test("мастера: подразделение из правил удержаний", () => {
  assert.deepEqual(suggestWriteoffPool(doc("masters"), targets, { masterDepartmentIds: ["bar"] }), {
    pool: "department",
    key: "bar",
  });
});

test("мастера: правила назвали только архивное или несколько подразделений → без подсказки", () => {
  assert.equal(suggestWriteoffPool(doc("masters"), targets, { masterDepartmentIds: ["old"] }), null);
  assert.equal(suggestWriteoffPool(doc("masters"), targets, { masterDepartmentIds: ["bar", "hookah"] }), null);
});

test("мастера без правил: единственное подразделение «Кальянные мастера»", () => {
  assert.deepEqual(suggestWriteoffPool(doc("masters"), targets), { pool: "department", key: "hookah" });
  assert.equal(
    suggestWriteoffPool(doc("masters"), {
      ...targets,
      departments: [{ id: "x", name: "Кальянная", archived: false }],
    }),
    null,
  );
});

test("группа мастеров в правилах: по ID группы или названию, версия на дату акта", () => {
  const versions = [
    { version: 1, valid_from: "2026-01-01", groups: [{ id: "masters", name: "Мастера", departmentIds: ["d1"] }] },
    { version: 2, valid_from: "2026-11-01", groups: [{ id: "g7", name: "Кальянные  мастера", departmentIds: ["d2"] }, { id: "bar", name: "Бар", departmentIds: ["d3"] }] },
    { version: 3, valid_from: "2027-01-01", groups: [] },
  ];
  assert.deepEqual(masterDepartmentIds(versions, "2026-10-31"), ["d1"]);
  assert.deepEqual(masterDepartmentIds(versions, "2026-11-15"), ["d2"]);
  assert.deepEqual(masterDepartmentIds(versions, "2027-02-01"), []);
  assert.deepEqual(masterDepartmentIds(versions, "2025-12-31"), []);
});
