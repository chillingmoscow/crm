import { z } from "zod";

export type Tare = { key: string; title: string; grams: number };

export type CountSection = {
  key: "standard" | "premium" | "parfum";
  title: string;
  hint: string;
  /** ingredients.id */
  productId: string;
  tares: Tare[];
};

export type CountConfig = {
  mode: "tobacco_weighing";
  storeId: string;
  telegramChatId: string | null;
  sections: CountSection[];
};

export type WeighingBatch = {
  /** uuid */
  id: string;
  grams: number;
  tares: Array<{ tareKey: string; count: number }>;
  /** storage path */
  photo: string | null;
};

export type WeighingDraft = {
  /** ISO, время первой партии */
  startedAt: string | null;
  sections: Record<string, { empty: boolean; batches: WeighingBatch[] }>;
};

const tareSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  grams: z.number().int().min(1).max(5000),
});

const sectionSchema = z.object({
  key: z.enum(["standard", "premium", "parfum"]),
  title: z.string().min(1),
  hint: z.string(),
  productId: z.string().min(1),
  tares: z.array(tareSchema).max(20),
});

export const countConfigSchema: z.ZodType<CountConfig> = z
  .object({
    mode: z.literal("tobacco_weighing"),
    storeId: z.string().min(1),
    telegramChatId: z.string().nullable(),
    sections: z.array(sectionSchema).min(1),
  })
  .refine(
    (c) => new Set(c.sections.map((s) => s.key)).size === c.sections.length,
    { message: "Ключи разделов должны быть уникальны" },
  );

const batchSchema = z.object({
  id: z.string().uuid(),
  grams: z.number().int().min(1),
  tares: z.array(
    z.object({ tareKey: z.string().min(1), count: z.number().int().min(0) }),
  ),
  photo: z.string().nullable(),
});

export const weighingDraftSchema: z.ZodType<WeighingDraft> = z.object({
  startedAt: z.string().nullable(),
  sections: z.record(
    z.string(),
    z.object({ empty: z.boolean(), batches: z.array(batchSchema) }),
  ),
});

function tareCount(batch: WeighingBatch): number {
  return batch.tares.reduce((s, t) => s + t.count, 0);
}

export function batchNetGrams(batch: WeighingBatch, tares: Tare[]): number {
  const byKey = new Map(tares.map((t) => [t.key, t.grams]));
  const tare = batch.tares.reduce(
    (s, t) => s + t.count * (byKey.get(t.tareKey) ?? 0),
    0,
  );
  return batch.grams - tare;
}

export function sectionNetGrams(
  section: WeighingDraft["sections"][string],
  tares: Tare[],
): number {
  if (section.empty) return 0;
  return section.batches.reduce((s, b) => s + batchNetGrams(b, tares), 0);
}

export function parseGramsInput(
  raw: string,
): { grams: number } | { error: string } {
  const s = raw.trim();
  if (/[.,]/.test(s)) {
    return { error: "Вводите вес в граммах, без точки и запятой" };
  }
  if (!/^\d+$/.test(s)) {
    return { error: "Введите вес целым числом граммов" };
  }
  const grams = Number(s);
  if (grams < 1 || grams > 1_000_000) {
    return { error: "Вес должен быть от 1 г до 1 000 000 г" };
  }
  return { grams };
}

export function weighingWarnings(
  draft: WeighingDraft,
  config: CountConfig,
): string[] {
  const out: string[] = [];
  for (const section of config.sections) {
    const s = draft.sections[section.key];
    if (!s || s.empty) continue;
    s.batches.forEach((batch, i) => {
      const n = tareCount(batch);
      if (batch.grams < 100 && n > 0) {
        out.push(
          `${section.title}, партия ${i + 1}: ${batch.grams} г при ${n} шт. тары — похоже на килограммы. Вес вводится в граммах`,
        );
      }
    });
  }
  return out;
}

export function submitErrors(
  draft: WeighingDraft,
  config: CountConfig,
): string[] {
  const out: string[] = [];
  for (const section of config.sections) {
    const s = draft.sections[section.key];
    if (s?.empty) continue;
    if (!s || s.batches.length === 0) {
      out.push(
        `${section.title}: добавьте партию или отметьте «В разделе ничего нет»`,
      );
      continue;
    }
    s.batches.forEach((batch, i) => {
      const label = `${section.title}, партия ${i + 1}`;
      const known = new Set(section.tares.map((t) => t.key));
      if (batch.tares.some((t) => !known.has(t.tareKey))) {
        out.push(`${label}: неизвестная тара`);
      } else if (batchNetGrams(batch, section.tares) < 0) {
        out.push(`${label}: вес меньше тары`);
      }
      if (!batch.photo) out.push(`${label}: нет фото`);
    });
  }
  return out;
}

export function netKgBySection(
  draft: WeighingDraft,
  config: CountConfig,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const section of config.sections) {
    const s = draft.sections[section.key];
    out[section.key] = s
      ? Math.round(sectionNetGrams(s, section.tares)) / 1000
      : 0;
  }
  return out;
}

const CONTAINER: Tare = { key: "container", title: "Контейнер", grams: 47 };

export const DEFAULT_TOBACCO_SECTIONS: Omit<CountSection, "productId">[] = [
  {
    key: "standard",
    title: "Стандарт",
    hint: "Взвешивайте по 20–30 контейнеров. Контейнеры могут стоять на стеллаже и под ним, над шкафом со шлангами и под ним — учитывайте все.",
    tares: [CONTAINER],
  },
  {
    key: "premium",
    title: "Премиум",
    hint: "Kraken, Dogma, Bonche и Naш (сигарная линейка). Контейнеры могут стоять на стеллаже и под ним, над шкафом со шлангами и под ним — учитывайте все.",
    tares: [
      CONTAINER,
      { key: "bonche30", title: "Bonche (30)", grams: 80 },
      { key: "bonche60", title: "Bonche (60)", grams: 100 },
      { key: "bonche80", title: "Bonche (80)", grams: 118 },
      { key: "bonche120", title: "Bonche (120)", grams: 165 },
      { key: "dogma_old80", title: "Старая Dogma (80)", grams: 125 },
      { key: "dogma_new80", title: "Новая Dogma (80)", grams: 165 },
      { key: "wto20", title: "WTO (20)", grams: 52 },
    ],
  },
  {
    key: "parfum",
    title: "Парфюм",
    hint: "Только парфюмная линейка DEUS.",
    tares: [CONTAINER, { key: "jar", title: "Баночка", grams: 125 }],
  },
];
