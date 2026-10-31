import { z } from "zod";

export const guestFactSchema = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    name: z.string().trim().min(1).max(500),
    contacts: z.string().max(4000).nullable(),
    groupId: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    groupTitle: z.string().max(500).nullable(),
    discountPercent: z.number().min(0).max(100).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    year: z.number().int().min(1900).max(2100).nullable(),
    issues: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type GuestFact = z.infer<typeof guestFactSchema>;
export const guestGroupSchema = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    title: z.string().min(1).max(500),
    discountPercent: z.number().min(0).max(100),
    promotable: z.boolean(),
    threshold: z.number().min(0).max(1e12),
  })
  .strict();
export type GuestGroup = z.infer<typeof guestGroupSchema>;
export function normalizeGuestGroups(raw: unknown): GuestGroup[] {
  if (!Array.isArray(raw) || raw.length > 500)
    throw Error("Не подтверждён справочник групп гостей");
  const groups = raw.map((v) => {
    const r = object(v);
    if (
      typeof r.deleted !== "boolean" ||
      typeof r.promotable !== "boolean" ||
      typeof r.discountValue !== "number" ||
      typeof r.minTotalAmount !== "number"
    )
      throw Error("Не подтверждены условия группы гостей");
    return {
      ...guestGroupSchema.parse({
        id: identifier(r.id),
        title: optionalText(r.name, 500),
        discountPercent: r.discountValue,
        promotable: r.promotable,
        threshold: r.minTotalAmount,
      }),
      deleted: r.deleted,
    };
  });
  if (new Set(groups.map((g) => g.id)).size !== groups.length)
    throw Error("Повторные ID групп гостей");
  return groups
    .filter((g) => !g.deleted)
    .map((g) =>
      guestGroupSchema.parse({
        id: g.id,
        title: g.title,
        discountPercent: g.discountPercent,
        promotable: g.promotable,
        threshold: g.threshold,
      }),
    )
    .sort((a, b) => a.id - b.id);
}
export function canonicalGuestValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalGuestValue).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalGuestValue((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v);
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Quick Resto не подтвердил данные гостей");
  return v as Record<string, unknown>;
}
function identifier(v: unknown) {
  if (
    v === null ||
    v === "" ||
    typeof v === "boolean" ||
    !Number.isSafeInteger(Number(v)) ||
    Number(v) <= 0
  )
    throw Error("Не подтверждён ID гостя или группы Quick Resto");
  return Number(v);
}
function optionalText(v: unknown, max: number) {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > max)
    throw Error("Некорректное текстовое поле гостя Quick Resto");
  return v.trim() || null;
}
export function birthdayValid(day: number, month: number, year = 2000) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
/** Missing birthday fields are unknown, never January 1. Bad optional dates are
 * held for review; a broken identity or incomplete page stops the whole read. */
export function normalizeGuest(raw: unknown, groups: GuestGroup[]): GuestFact {
  const outer = object(raw),
    row = object(outer.object ?? outer),
    customer = object(row.customer);
  const id = identifier(customer.id),
    issues: string[] = [];
  const group = row.customerGroup == null ? null : object(row.customerGroup);
  const groupId = group ? identifier(group.id) : null,
    condition = groups.find((g) => g.id === groupId);
  if (groupId !== null && !condition)
    throw Error("Группа гостя отсутствует в проверенном справочнике");
  const monthValue =
    typeof row.monthOfBirth === "string" &&
    /^month_\d{2}$/.test(row.monthOfBirth)
      ? Number(row.monthOfBirth.slice(-2))
      : row.monthOfBirth;
  const optionalInteger = (v: unknown, min: number, max: number) =>
    v == null || v === "" || v === 0 || v === "0"
      ? null
      : typeof v !== "boolean" &&
          Number.isInteger(Number(v)) &&
          Number(v) >= min &&
          Number(v) <= max
        ? Number(v)
        : NaN;
  let day = optionalInteger(row.dayOfBirth, 1, 31),
    month = optionalInteger(monthValue, 1, 12),
    year = optionalInteger(row.yearOfBirth, 1900, 2100);
  if (
    [day, month, year].some((v) => v !== null && !Number.isFinite(v)) ||
    (day !== null &&
      month !== null &&
      !birthdayValid(day, month, year ?? 2000)) ||
    (day === null) !== (month === null) ||
    (year !== null && day === null)
  ) {
    issues.push("Проверьте дату рождения в Quick Resto");
    day = null;
    month = null;
    year = null;
  }
  return guestFactSchema.parse({
    id,
    name: optionalText(customer.title, 500) ?? `Гость №${id}`,
    contacts: optionalText(row.allContactValues, 4000),
    groupId,
    groupTitle: condition?.title ?? null,
    discountPercent: condition?.discountPercent ?? null,
    day,
    month,
    year,
    issues,
  });
}
export type GuestReaderJob = {
  phase: "first" | "verify";
  cursor: number;
  payload: {
    first: GuestFact[];
    second: GuestFact[];
    provider?: string;
    groups?: GuestGroup[];
    verifiedGroups?: GuestGroup[];
  };
};
export type GuestPageSource = {
  guests: (start: number) => Promise<unknown>;
  groups: () => Promise<unknown>;
};
const CAP = 30000;
export async function advanceGuestReader(
  job: GuestReaderJob,
  source: GuestPageSource,
) {
  if (
    !Number.isInteger(job.cursor) ||
    job.cursor < 0 ||
    job.cursor > CAP ||
    !["first", "verify"].includes(job.phase)
  )
    throw Error("Некорректное состояние чтения гостей");
  const previous =
    job.phase === "first" ? job.payload.first : job.payload.second;
  if (previous.length !== job.cursor || previous.length > CAP)
    throw Error("Неполное состояние страницы гостей");
  const payload = { ...job.payload };
  if (!payload.groups)
    payload.groups = normalizeGuestGroups(await source.groups());
  if (job.phase === "verify" && !payload.verifiedGroups) {
    payload.verifiedGroups = normalizeGuestGroups(await source.groups());
    if (
      canonicalGuestValue(payload.groups) !==
      canonicalGuestValue(payload.verifiedGroups)
    )
      throw Error("Условия групп изменились во время чтения гостей");
  }
  const response = object(await source.guests(job.cursor));
  if (!Array.isArray(response.ds) || response.ds.length > 500)
    throw Error("Quick Resto не подтвердил полную страницу гостей");
  const page = response.ds.map((r) => normalizeGuest(r, payload.groups!));
  const ids = new Set(previous.map((r) => r.id));
  for (const row of page) {
    if (ids.has(row.id)) throw Error("Quick Resto повторил гостя или страницу");
    ids.add(row.id);
  }
  if (previous.length + page.length > CAP)
    throw Error("Не подтверждён полный список гостей: превышен предел чтения");
  if (page.length) {
    const combined = [...previous, ...page];
    return {
      phase: job.phase,
      cursor: combined.length,
      payload: {
        ...payload,
        [job.phase === "first" ? "first" : "second"]: combined,
      },
    };
  }
  if (job.phase === "first")
    return {
      phase: "verify" as const,
      cursor: 0,
      payload: {
        ...payload,
        first: [...previous].sort((a, b) => a.id - b.id),
        second: [],
      },
    };
  const verified = [...previous].sort((a, b) => a.id - b.id);
  if (canonicalGuestValue(job.payload.first) !== canonicalGuestValue(verified))
    throw Error(
      "База гостей изменилась во время проверки. Прочитайте её заново",
    );
  return {
    publish: verified,
    groups: payload.groups,
    verifiedGroups: payload.verifiedGroups!,
  };
}
export function formatGuestBirthday(
  g: Pick<GuestFact, "day" | "month" | "year">,
) {
  if (!g.day || !g.month) return "—";
  return `${String(g.day).padStart(2, "0")}.${String(g.month).padStart(2, "0")}${g.year ? `.${g.year}` : ""}`;
}
