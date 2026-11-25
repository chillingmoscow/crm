import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { affectedMonths, classifyImportCandidate, dayInZone, isResumableImport, parseProductIds } from "./import-plan.ts";

const TOBACCO = [417, 420, 1892];
const base = { processed: true, deleted: false, invoiceDate: "2026-10-07", productIds: [417, 420, 1892] };
const opts = (over: Partial<Parameters<typeof classifyImportCandidate>[1]> = {}) => ({
  from: "2026-10-01",
  allowedProductIds: TOBACCO,
  knownExternalIds: new Set<number>(),
  externalId: 101,
  ...over,
});

describe("classifyImportCandidate", () => {
  it("акт только с табаком (417/420/1892) загружается", () => {
    assert.deepEqual(classifyImportCandidate(base, opts()), { import: true });
  });

  it("часть табачных позиций — тоже загружается", () => {
    assert.deepEqual(classifyImportCandidate({ ...base, productIds: [417, 1892] }, opts()), { import: true });
  });

  it("акт ровно в первый день периода загружается", () => {
    assert.deepEqual(classifyImportCandidate({ ...base, invoiceDate: "2026-10-01" }, opts()), { import: true });
  });

  it("непроведённый — «не проведён»", () => {
    assert.deepEqual(classifyImportCandidate({ ...base, processed: false }, opts()), {
      import: false,
      reason: "не проведён",
    });
  });

  it("удалённый — «удалён», даже если проведён", () => {
    assert.deepEqual(classifyImportCandidate({ ...base, deleted: true }, opts()), {
      import: false,
      reason: "удалён",
    });
  });

  it("раньше начала периода — «раньше даты»", () => {
    assert.deepEqual(classifyImportCandidate({ ...base, invoiceDate: "2026-09-30" }, opts()), {
      import: false,
      reason: "раньше даты",
    });
  });

  it("акт, который Sheerly уже знает, — «уже в Sheerly»", () => {
    assert.deepEqual(
      classifyImportCandidate(base, opts({ knownExternalIds: new Set([101]) })),
      { import: false, reason: "уже в Sheerly" },
    );
  });

  it("акт с другой позицией — «другие позиции»", () => {
    assert.deepEqual(classifyImportCandidate({ ...base, productIds: [417, 555] }, opts()), {
      import: false,
      reason: "другие позиции",
    });
  });

  it("акт без позиций — «другие позиции» (загружать нечего)", () => {
    assert.deepEqual(classifyImportCandidate({ ...base, productIds: [] }, opts()), {
      import: false,
      reason: "другие позиции",
    });
  });

  it("пустой список разрешённых позиций ничего не пропускает", () => {
    assert.deepEqual(classifyImportCandidate(base, opts({ allowedProductIds: [] })), {
      import: false,
      reason: "другие позиции",
    });
  });
});

describe("affectedMonths", () => {
  it("уникальные месяцы по порядку", () => {
    assert.deepEqual(affectedMonths(["2026-11-04", "2026-10-07", "2026-10-28", "2026-11-18"]), [
      "2026-10",
      "2026-11",
    ]);
  });
  it("пустой список — пустой результат", () => {
    assert.deepEqual(affectedMonths([]), []);
  });
});

describe("parseProductIds", () => {
  it("числа через запятую и пробелы", () => {
    assert.deepEqual(parseProductIds("417, 420  1892"), { ids: [417, 420, 1892] });
  });
  it("дубли убираются", () => {
    assert.deepEqual(parseProductIds("417,417"), { ids: [417] });
  });
  it("не число — ошибка", () => {
    assert.ok("error" in parseProductIds("417, abc"));
  });
  it("пусто — ошибка", () => {
    assert.ok("error" in parseProductIds("  "));
  });
});

describe("dayInZone", () => {
  it("00:30 по Москве 1 октября — это 1 октября, хотя в UTC ещё 30 сентября", () => {
    assert.equal(dayInZone(Date.parse("2026-09-30T21:30:00Z"), "Europe/Moscow"), "2026-10-01");
  });
});

describe("isResumableImport", () => {
  const row = {
    status: "processed",
    results_finalized_at: null,
    results_reopened_at: null,
    results_snapshot_at: null,
    archived_at: null,
  };
  it("проведён без зафиксированных итогов — дозагружаем", () => {
    assert.equal(isResumableImport(row), true);
  });
  it("итоги зафиксированы — уже в Sheerly", () => {
    assert.equal(isResumableImport({ ...row, results_finalized_at: "2026-10-08T10:00:00Z" }), false);
  });
  it("итоги переоткрыты — не трогаем", () => {
    assert.equal(isResumableImport({ ...row, results_reopened_at: "2026-10-09T10:00:00Z" }), false);
  });
  it("акт в работе — не трогаем", () => {
    assert.equal(isResumableImport({ ...row, status: "in_progress" }), false);
  });
  it("акт в архиве — не трогаем", () => {
    assert.equal(isResumableImport({ ...row, archived_at: "2026-10-09T10:00:00Z" }), false);
  });
});
