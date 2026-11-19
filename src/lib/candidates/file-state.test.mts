import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateFileProblem } from "./file-state.ts";

test("перенесённый файл — без проблемы", () => {
  assert.equal(candidateFileProblem({ state: "ready", error: null }), null);
});

test("временный сбой переноса предлагает повтор и удаление", () => {
  const p = candidateFileProblem({ state: "error", error: "Не удалось получить исходный файл" });
  assert.equal(p?.title, "Не удалось перенести файл");
  assert.equal(p?.reason, "Источник не отдал файл");
  assert.equal(p?.canRetry, true);
  assert.equal(p?.canRemove, true);
});

test("неизвестная ошибка не показывается как есть, повтор доступен", () => {
  const p = candidateFileProblem({ state: "error", error: "fetch failed" });
  assert.equal(p?.reason, null);
  assert.equal(p?.canRetry, true);
});

test("формат и размер повтором не исправить", () => {
  assert.equal(candidateFileProblem({ state: "error", error: "Неподдерживаемый тип файла" })?.canRetry, false);
  assert.equal(candidateFileProblem({ state: "error", error: "Файл больше 10 МБ" })?.canRetry, false);
  assert.equal(candidateFileProblem({ state: "error", error: "Адрес файла не разрешён" })?.canRetry, false);
});

test("удалённый в источнике файл можно только убрать", () => {
  const p = candidateFileProblem({ state: "missing", error: "Файл недоступен в исходном хранилище" });
  assert.equal(p?.canRetry, false);
  assert.equal(p?.canRemove, true);
});

test("ожидание переноса и папка Google Drive без действий", () => {
  for (const state of ["pending", "external"] as const) {
    const p = candidateFileProblem({ state, error: null });
    assert.equal(p?.canRetry, false);
    assert.equal(p?.canRemove, false);
  }
});
