import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanNotionPropertyValue,
  inferKbPropertiesFromPairs,
} from "./notion-properties.ts";

test("cleanNotionPropertyValue strips relative .md links", () => {
  assert.equal(
    cleanNotionPropertyValue(
      "Авторский чай (../../../../%D0%90%D0%B2%D1%82.md)",
    ),
    "Авторский чай",
  );
});

test("cleanNotionPropertyValue strips notion.so links", () => {
  assert.equal(
    cleanNotionPropertyValue(
      "Гефест (https://www.notion.so/90f22d4a3b034033aace74743f196656?pvs=21)",
    ),
    "Гефест",
  );
});

test("cleanNotionPropertyValue keeps plain text", () => {
  assert.equal(cleanNotionPropertyValue("Осень"), "Осень");
});

test("cleanNotionPropertyValue: pure md-link → decoded filename, no hash", () => {
  assert.equal(
    cleanNotionPropertyValue("(%D0%93%D1%80%D0%B0%D1%84 0123456789abcdef0123456789abcdef.md)"),
    "Граф",
  );
});

test("infer: number with unit → number", () => {
  const p = inferKbPropertiesFromPairs([{ key: "Объём", value: "800 мл" }]);
  assert.equal(p.length, 1);
  assert.equal(p[0].type, "number");
  assert.equal((p[0] as { value: number }).value, 800);
});

test("infer: comma list → multi-select", () => {
  const p = inferKbPropertiesFromPairs([
    { key: "Вкус", value: "Кислый, Травянистый, Фруктовый, Ягодный" },
  ]);
  assert.equal(p[0].type, "multi-select");
  assert.deepEqual((p[0] as { value: string[] }).value, [
    "Кислый",
    "Травянистый",
    "Фруктовый",
    "Ягодный",
  ]);
});

test("infer: url", () => {
  const p = inferKbPropertiesFromPairs([
    { key: "Ссылка", value: "https://example.com/x" },
  ]);
  assert.equal(p[0].type, "url");
});

test("infer: checkbox да/нет", () => {
  const p = inferKbPropertiesFromPairs([
    { key: "Готово", value: "Да" },
    { key: "Архив", value: "нет" },
  ]);
  assert.equal(p[0].type, "checkbox");
  assert.equal((p[0] as { value: boolean }).value, true);
  assert.equal((p[1] as { value: boolean }).value, false);
});

test("infer: ISO and dotted date", () => {
  const p = inferKbPropertiesFromPairs([
    { key: "Дата", value: "2026-05-18" },
    { key: "Срок", value: "01.06.2026" },
  ]);
  assert.equal(p[0].type, "date");
  assert.equal((p[0] as { value: string }).value, "2026-05-18");
  assert.equal((p[1] as { value: string }).value, "2026-06-01");
});

test("infer: plain scalar → text; empty skipped; dup name skipped", () => {
  const p = inferKbPropertiesFromPairs([
    { key: "Категория", value: "Авторский чай" },
    { key: "Пусто", value: "" },
    { key: "Категория", value: "дубликат" },
  ]);
  assert.equal(p.length, 1);
  assert.equal(p[0].type, "text");
  assert.equal((p[0] as { value: string }).value, "Авторский чай");
});
