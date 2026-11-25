import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TOBACCO_SECTIONS,
  batchNetGrams,
  countConfigSchema,
  netKgBySection,
  parseGramsInput,
  sectionNetGrams,
  submitErrors,
  weighingDraftSchema,
  weighingWarnings,
  type CountConfig,
  type Tare,
  type WeighingBatch,
  type WeighingDraft,
} from "./tobacco-weighing.ts";

let seq = 0;
function b(
  grams: number,
  tares: Array<[string, number]>,
  photo: string | null = "p/x.jpg",
): WeighingBatch {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    grams,
    tares: tares.map(([tareKey, count]) => ({ tareKey, count })),
    photo,
  };
}

const STD_TARES: Tare[] = [{ key: "container", title: "Контейнер", grams: 47 }];
const PRM_TARES: Tare[] = [
  { key: "container", title: "Контейнер", grams: 47 },
  { key: "bonche30", title: "Bonche (30)", grams: 80 },
  { key: "bonche60", title: "Bonche (60)", grams: 100 },
  { key: "bonche80", title: "Bonche (80)", grams: 118 },
  { key: "bonche120", title: "Bonche (120)", grams: 165 },
  { key: "dogma_old80", title: "Старая Dogma (80)", grams: 125 },
  { key: "dogma_new80", title: "Новая Dogma (80)", grams: 165 },
  { key: "wto20", title: "WTO (20)", grams: 52 },
];
const PRF_TARES: Tare[] = [
  { key: "container", title: "Контейнер", grams: 47 },
  { key: "jar", title: "Баночка", grams: 125 },
];

const cfg: CountConfig = {
  mode: "tobacco_weighing",
  storeId: "store-1",
  telegramChatId: null,
  sections: [
    { key: "standard", title: "Стандарт", hint: "h", productId: "p1", tares: STD_TARES },
    { key: "premium", title: "Премиум", hint: "h", productId: "p2", tares: PRM_TARES },
    { key: "parfum", title: "Парфюм", hint: "h", productId: "p3", tares: PRF_TARES },
  ],
};
const dupCfg: CountConfig = {
  ...cfg,
  sections: [cfg.sections[0]!, { ...cfg.sections[1]!, key: "standard" }],
};

const parfumDraft: WeighingDraft = {
  startedAt: null,
  sections: {
    standard: { empty: true, batches: [] },
    premium: { empty: true, batches: [] },
    parfum: {
      empty: false,
      batches: [b(332, [["container", 2]]), b(146, [["jar", 1]])],
    },
  },
};
const badDraft: WeighingDraft = {
  startedAt: null,
  sections: {
    standard: {
      empty: false,
      batches: [b(100, [["container", 5]]), b(1000, [["container", 1]], null)],
    },
    premium: { empty: true, batches: [] },
    parfum: { empty: false, batches: [] },
  },
};
const kgLikeDraft: WeighingDraft = {
  startedAt: null,
  sections: {
    standard: { empty: false, batches: [b(6, [["container", 30]])] },
    premium: { empty: true, batches: [] },
    parfum: { empty: true, batches: [] },
  },
};

test("нетто партии стандарта: 7458 г − 30×47", () => {
  assert.equal(batchNetGrams(b(7458, [["container", 30]]), STD_TARES), 6048);
});
test("премиум со смешанной тарой", () => {
  assert.equal(batchNetGrams(b(1240, [["bonche80", 2], ["wto20", 3]]), PRM_TARES), 848);
});
test("парфюм: контейнеры и баночки в кг", () => {
  assert.equal(netKgBySection(parfumDraft, cfg).parfum, 0.259);
  assert.equal(sectionNetGrams(parfumDraft.sections.parfum!, PRF_TARES), 259);
});
test("пустой раздел даёт 0 кг", () => {
  assert.equal(netKgBySection(parfumDraft, cfg).standard, 0);
});
test("parseGramsInput отвергает точку и запятую", () => {
  assert.deepEqual(parseGramsInput("6.666"), { error: "Вводите вес в граммах, без точки и запятой" });
  assert.deepEqual(parseGramsInput("6,666"), { error: "Вводите вес в граммах, без точки и запятой" });
  assert.deepEqual(parseGramsInput(" 7458 "), { grams: 7458 });
  assert.ok("error" in parseGramsInput("abc"));
  assert.ok("error" in parseGramsInput("0"));
  assert.ok("error" in parseGramsInput(""));
});
test("submitErrors: отрицательное нетто, нет фото, пустой раздел без отметки", () => {
  assert.deepEqual(submitErrors(badDraft, cfg), [
    "Стандарт, партия 1: вес меньше тары",
    "Стандарт, партия 2: нет фото",
    "Парфюм: добавьте партию или отметьте «В разделе ничего нет»",
  ]);
});
test("submitErrors: корректный черновик без ошибок", () => {
  assert.deepEqual(submitErrors(parfumDraft, cfg), []);
});
test("weighingWarnings: 6 г при 30 контейнерах похоже на килограммы", () => {
  assert.deepEqual(weighingWarnings(kgLikeDraft, cfg), [
    "Стандарт, партия 1: 6 г при 30 шт. тары — похоже на килограммы. Вес вводится в граммах",
  ]);
  assert.deepEqual(weighingWarnings(parfumDraft, cfg), []);
});
test("countConfigSchema отвергает повтор ключа раздела", () => {
  assert.equal(countConfigSchema.safeParse(dupCfg).success, false);
  assert.equal(countConfigSchema.safeParse(cfg).success, true);
});
test("countConfigSchema: граммы тары целые 1–5000", () => {
  const bad = {
    ...cfg,
    sections: [{ ...cfg.sections[0]!, tares: [{ key: "c", title: "C", grams: 0 }] }],
  };
  assert.equal(countConfigSchema.safeParse(bad).success, false);
  assert.equal(countConfigSchema.safeParse({ ...cfg, sections: [] }).success, false);
});
test("weighingDraftSchema принимает черновик", () => {
  assert.equal(weighingDraftSchema.safeParse(parfumDraft).success, true);
});
test("DEFAULT_TOBACCO_SECTIONS: три раздела с нужной тарой", () => {
  assert.deepEqual(
    DEFAULT_TOBACCO_SECTIONS.map((s) => s.key),
    ["standard", "premium", "parfum"],
  );
  assert.equal(DEFAULT_TOBACCO_SECTIONS[1]!.tares.length, 8);
});
